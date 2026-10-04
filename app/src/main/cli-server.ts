import { mkdir, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { dirname } from 'node:path'

// 계약은 core/crates/maru 의 모듈 doc 에 있다.
export const CLI_PROTOCOL_VERSION = 1

const MAX_LINE = 16 * 1024 * 1024
const IDLE_MS = 10_000

export type Handlers = Record<string, (params: Record<string, unknown>, session: string) => unknown>
export type CliServer = { close: () => Promise<void> }

export class InvalidParams extends Error {}

type Id = string | number | null
type Reply = { id: Id; result?: unknown; error?: object }

function failure(id: Id, code: number, reason: string, message: string, data?: object): Reply {
  return { id, error: { code, message, data: { code: reason, ...data } } }
}

function isObject(v: unknown): v is Record<string, unknown> {
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
  if (typeof params.session !== 'string' || params.session === '') {
    return failure(id, -32602, 'invalid_params', 'params.session must be a session id')
  }
  try {
    return { id, result: (await handler(params, params.session)) ?? null }
  } catch (err) {
    if (err instanceof InvalidParams) return failure(id, -32602, 'invalid_params', err.message)
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
  return 'id' in msg ? body : null
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
    if (body) sock.write(encode(body))
    sock.end()
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
  await rm(path, { force: true })
  const open = new Set<Socket>()
  // 줄바꿈 없이 쓰기를 닫은 요청에도 답해야 한다.
  const server = createServer({ allowHalfOpen: true }, (sock) => {
    open.add(sock)
    sock.on('close', () => open.delete(sock))
    serve(sock, handlers, maxLine, idleMs)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    close: async () => {
      for (const sock of open) sock.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(path, { force: true })
    }
  }
}
