import { mkdir, rename, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { dirname, isAbsolute, join } from 'node:path'

// 계약은 core/crates/maru 의 모듈 doc 에 있다.
export const CLI_PROTOCOL_VERSION = 1

const MAX_LINE = 16 * 1024 * 1024
const IDLE_MS = 10_000

export type Handlers = Record<string, (params: Record<string, unknown>, pty: string) => unknown>
export type CliServer = { close: () => Promise<void> }

export class InvalidParams extends Error {}

export function isCommand(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((a) => typeof a === 'string')
}

export function requireCommand(v: unknown): string[] {
  if (!isCommand(v)) throw new InvalidParams('params.command must be a non-empty array of strings')
  return v
}

export function requireCwd(v: unknown): string {
  if (typeof v !== 'string' || !isAbsolute(v)) {
    throw new InvalidParams('params.cwd must be an absolute path')
  }
  return v
}

export function optionalBoolean(v: unknown, name: string): boolean {
  if (v !== undefined && typeof v !== 'boolean') {
    throw new InvalidParams(`params.${name} must be a boolean`)
  }
  return v ?? false
}

/** handler 가 앱이 정한 이유로 거절할 때 던진다. `data` 의 필드는 `error.data` 에 `code` 와 함께 들어간다. */
export class CliError extends Error {
  constructor(
    readonly code: number,
    readonly reason: string,
    message: string,
    readonly data?: object
  ) {
    super(message)
  }
}

/** handler 가 돌려주면 `result` 로 답을 쓴 뒤에 `run` 을 부른다 — 답하기 전에 앱을 내리면 CLI 가 답을 못 받는다. */
export class AfterReply {
  constructor(
    readonly result: unknown,
    readonly run: () => void
  ) {}
}

/**
 * handler 가 돌려주면 응답 뒤에도 연결을 열어 두고, `start` 가 받은 `notify` 마다 `method` 로
 * notification 한 줄을 보낸다. `notify` 는 연결이 닫혀 보내지 못하면 false 다. `start` 는 구독을
 * 푸는 함수를 돌려준다.
 */
export class Subscription {
  constructor(
    readonly method: string,
    readonly start: (notify: (params: object) => boolean) => () => void
  ) {}
}

type Id = string | number | null
type Reply = { id: Id; result?: unknown; error?: object }

function failure(id: Id, code: number, reason: string, message: string, data?: object): Reply {
  return { id, error: { code, message, data: { code: reason, ...data } } }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isId(v: unknown): v is Id {
  return v === null || typeof v === 'string' || typeof v === 'number'
}

async function dispatch(
  id: Id,
  method: string,
  params: Record<string, unknown>,
  handlers: Handlers
): Promise<Reply> {
  if (params.protocol_version !== CLI_PROTOCOL_VERSION) {
    return failure(id, -32000, 'protocol_mismatch', 'protocol version mismatch', {
      protocol_version: CLI_PROTOCOL_VERSION
    })
  }
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
  if (!handler) {
    return failure(id, -32601, 'unknown_method', `unknown method: ${method}`)
  }
  if (typeof params.pty !== 'string' || params.pty === '') {
    return failure(id, -32602, 'invalid_params', 'params.pty must be a pty id')
  }
  try {
    return { id, result: (await handler(params, params.pty)) ?? null }
  } catch (err) {
    if (err instanceof InvalidParams) return failure(id, -32602, 'invalid_params', err.message)
    if (err instanceof CliError) return failure(id, err.code, err.reason, err.message, err.data)
    const message = err instanceof Error ? err.message : String(err)
    return failure(id, -32603, 'internal_error', message)
  }
}

async function reply(line: string, handlers: Handlers): Promise<Reply | null> {
  let msg: unknown
  try {
    msg = JSON.parse(line)
  } catch {
    return failure(null, -32700, 'parse_error', 'not JSON')
  }
  if (
    !isObject(msg) ||
    msg.jsonrpc !== '2.0' ||
    typeof msg.method !== 'string' ||
    ('id' in msg && !isId(msg.id)) ||
    ('params' in msg && !isObject(msg.params))
  ) {
    return failure(null, -32600, 'invalid_request', 'not a JSON-RPC 2.0 request')
  }
  const params = isObject(msg.params) ? msg.params : {}
  const body = await dispatch((msg.id as Id | undefined) ?? null, msg.method, params, handlers)
  if ('id' in msg) return body
  if (body.result instanceof AfterReply) body.result.run()
  // 답하지 않는 요청으로 구독하면 열린 연결만 남는다.
  return body.result instanceof Subscription
    ? failure(null, -32600, 'invalid_request', `${msg.method} needs an id`)
    : null
}

function encode(body: Reply): string {
  try {
    return JSON.stringify({ jsonrpc: '2.0', ...body }) + '\n'
  } catch (err) {
    const message = `cannot encode the result: ${err instanceof Error ? err.message : String(err)}`
    return encode(failure(body.id, -32603, 'internal_error', message))
  }
}

function serve(sock: Socket, handlers: Handlers, maxLine: number, idleMs: number): void {
  const chunks: Buffer[] = []
  let size = 0
  let done = false

  // 요청을 다 보내지 않고 멈춘 연결이 앱이 끝날 때까지 남지 않게.
  sock.setTimeout(idleMs, () => sock.destroy())
  const send = (body: Reply | null): void => {
    if (body?.result instanceof AfterReply) {
      const after = body.result
      return void sock.end(encode({ id: body.id, result: after.result }), () => after.run())
    }
    const sub = body?.result instanceof Subscription ? body.result : null
    if (body) sock.write(encode(sub ? { id: body.id, result: null } : body))
    if (!sub) return void sock.end()
    // handler 를 기다리는 사이 상대가 쓰기를 닫았으면 구독할 곳이 없다.
    if (sock.readableEnded) return void sock.destroy()
    // 구독 연결은 알림을 기다리는 동안 오가는 것이 없다.
    sock.setTimeout(0)
    const stop = sub.start((params) => {
      if (!sock.writable) return false
      sock.write(JSON.stringify({ jsonrpc: '2.0', method: sub.method, params }) + '\n')
      return true
    })
    sock.once('close', stop)
    sock.once('end', () => sock.destroy())
  }
  const finish = (line: string): void => {
    done = true
    void reply(line, handlers).then(send)
  }

  sock.on('data', (chunk: Buffer) => {
    if (done) return
    const nl = chunk.indexOf(0x0a)
    const take = nl === -1 ? chunk : chunk.subarray(0, nl)
    size += take.length
    if (size > maxLine) {
      done = true
      return send(failure(null, -32600, 'too_large', `request line exceeds ${maxLine} bytes`))
    }
    chunks.push(take)
    if (nl !== -1) finish(Buffer.concat(chunks).toString())
  })
  sock.on('end', () => {
    if (done) return
    if (size === 0) return send(null)
    finish(Buffer.concat(chunks).toString())
  })
  sock.on('error', () => {})
}

/**
 * 같은 userData 로는 앱이 하나만 뜨므로, 남은 소켓 파일은 비정상으로 끝난 지난 실행의 것이다.
 */
export async function listenCli(
  path: string,
  handlers: Handlers,
  { maxLine = MAX_LINE, idleMs = IDLE_MS }: { maxLine?: number; idleMs?: number } = {}
): Promise<CliServer> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // 다른 이름으로 듣기 시작한 뒤 옮긴다 — `maru claude monitor` 는 경로가 보이면 바로 붙어 본다(계약은
  // core/crates/maru 의 모듈 doc). 같은 디렉토리의 짧은 이름이라 소켓 경로 한도를 넘지 않는다.
  const listening = join(dirname(path), '.sock')
  await rm(listening, { force: true })
  const open = new Set<Socket>()
  // 줄바꿈 없이 쓰기를 닫은 요청에도 답해야 한다.
  const server = createServer({ allowHalfOpen: true }, (sock) => {
    open.add(sock)
    sock.on('close', () => open.delete(sock))
    serve(sock, handlers, maxLine, idleMs)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(listening, () => {
      server.off('error', reject)
      resolve()
    })
  })
  await rename(listening, path)
  return {
    close: async () => {
      for (const sock of open) sock.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(path, { force: true })
    }
  }
}
