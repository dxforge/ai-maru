import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLI_PROTOCOL_VERSION, listenCli, type CliServer, type Handlers } from './cli-server'

let release: () => void = () => {}

const handlers: Handlers = {
  ping: (_params, session) => ({ session }),
  boom: () => {
    throw new Error('boom')
  },
  later: async (params) => {
    await new Promise((r) => setTimeout(r, 20))
    return { echo: params.value }
  },
  rejects: async () => {
    throw new Error('async boom')
  },
  nothing: () => undefined,
  bigint: () => ({ n: 1n }),
  hang: () => new Promise<void>((r) => (release = r))
}

let dir: string
let server: CliServer | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maru-cli-'))
})

afterEach(async () => {
  await server?.close()
  server = null
  rmSync(dir, { recursive: true, force: true })
})

function sockPath(): string {
  return join(dir, 's', 'app.sock')
}

async function start(opts: { maxLine?: number; idleMs?: number } = {}): Promise<string> {
  server = await listenCli(sockPath(), handlers, opts)
  return sockPath()
}

function exchange(
  path: string,
  raw: string | Buffer | (string | Buffer)[],
  end = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const sock = createConnection(path, async () => {
      for (const part of Array.isArray(raw) ? raw : [raw]) {
        if (!sock.writable) break
        sock.write(part)
        await new Promise((r) => setTimeout(r, 10))
      }
      if (end) sock.end()
    })
    sock.on('data', (c) => chunks.push(c))
    sock.on('close', () => resolve(Buffer.concat(chunks).toString()))
    // 앱이 먼저 닫으면 남은 쓰기가 EPIPE 로 실패한다.
    sock.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EPIPE' && e.code !== 'ECONNRESET') reject(e)
    })
  })
}

function req(method: string, params: object, id: number | null = 1): string {
  const body: Record<string, unknown> = { jsonrpc: '2.0', method, params }
  if (id !== null) body.id = id
  return JSON.stringify(body) + '\n'
}

const common = { protocol_version: CLI_PROTOCOL_VERSION, session: 's-test' }

type Reply = {
  jsonrpc: string
  id: unknown
  result?: unknown
  error: { code: number; message: string; data: Record<string, unknown> }
}

async function call(
  path: string,
  raw: Parameters<typeof exchange>[1],
  end = false
): Promise<Reply> {
  const out = await exchange(path, raw, end)
  expect(out.endsWith('\n')).toBe(true)
  expect(out.trimEnd().includes('\n')).toBe(false)
  return JSON.parse(out)
}

describe('listenCli', () => {
  it('ping 에 받은 세션 id 로 답한다', async () => {
    const path = await start()
    expect(await call(path, req('ping', common, 7))).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { session: 's-test' }
    })
  })

  it('줄바꿈 없이 끝난 요청도 받는다', async () => {
    const path = await start()
    const res = await call(path, req('ping', common).trimEnd(), true)
    expect(res.result).toEqual({ session: 's-test' })
  })

  it('JSON 이 아니면 parse_error', async () => {
    const path = await start()
    const res = await call(path, '{nope\n')
    expect(res.id).toBeNull()
    expect(res.error.code).toBe(-32700)
    expect(res.error.data.code).toBe('parse_error')
  })

  it.each([
    ['jsonrpc 가 없음', { id: 1, method: 'ping', params: common }],
    ['method 가 문자열이 아님', { jsonrpc: '2.0', id: 1, method: 3, params: common }],
    ['객체가 아님', 'ping'],
    ['batch', [{ jsonrpc: '2.0', id: 1, method: 'ping', params: common }]],
    ['params 가 null', { jsonrpc: '2.0', id: 1, method: 'ping', params: null }],
    ['params 가 배열', { jsonrpc: '2.0', id: 1, method: 'ping', params: [1, 's-test'] }],
    ['params 가 문자열', { jsonrpc: '2.0', id: 1, method: 'ping', params: 'x' }],
    ['id 가 객체', { jsonrpc: '2.0', id: {}, method: 'ping', params: common }],
    ['id 가 boolean', { jsonrpc: '2.0', id: true, method: 'ping', params: common }]
  ])('요청 모양이 아니면 invalid_request — %s', async (_, body) => {
    const path = await start()
    const res = await call(path, JSON.stringify(body) + '\n')
    expect(res.error.code).toBe(-32600)
    expect(res.error.data.code).toBe('invalid_request')
  })

  it('버전이 다르면 메서드를 찾기 전에 protocol_mismatch 와 앱의 버전을 돌려준다', async () => {
    const path = await start()
    const res = await call(path, req('no-such', { ...common, protocol_version: 999 }))
    expect(res.id).toBe(1)
    expect(res.error.code).toBe(-32000)
    expect(res.error.data).toEqual({
      code: 'protocol_mismatch',
      protocol_version: CLI_PROTOCOL_VERSION
    })
  })

  it('버전이 없어도 protocol_mismatch', async () => {
    const path = await start()
    const res = await call(path, req('ping', { session: 's-test' }))
    expect(res.error.data.code).toBe('protocol_mismatch')
  })

  it('모르는 메서드면 unknown_method', async () => {
    const path = await start()
    const res = await call(path, req('no-such', common))
    expect(res.error.code).toBe(-32601)
    expect(res.error.data.code).toBe('unknown_method')
  })

  it('Object.prototype 의 이름도 모르는 메서드다', async () => {
    const path = await start()
    const res = await call(path, req('toString', common))
    expect(res.error.data.code).toBe('unknown_method')
  })

  it('세션 id 가 없으면 invalid_params', async () => {
    const path = await start()
    const res = await call(path, req('ping', { protocol_version: CLI_PROTOCOL_VERSION }))
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.code).toBe('invalid_params')
  })

  it('처리 중에 던지면 internal_error', async () => {
    const path = await start()
    const res = await call(path, req('boom', common))
    expect(res.error.code).toBe(-32603)
    expect(res.error.data.code).toBe('internal_error')
  })

  it('id 가 없으면 답 없이 닫는다', async () => {
    const path = await start()
    expect(await exchange(path, req('ping', common, null))).toBe('')
  })

  it('id 가 없으면 실패해도 답 없이 닫는다', async () => {
    const path = await start()
    const notification = req('ping', { ...common, protocol_version: 999 }, null)
    expect(await exchange(path, notification)).toBe('')
  })

  it('async 처리기의 결과로 답한다', async () => {
    const path = await start()
    expect((await call(path, req('later', { ...common, value: 3 }))).result).toEqual({ echo: 3 })
  })

  it('async 처리기가 거절하면 internal_error', async () => {
    const path = await start()
    const res = await call(path, req('rejects', common))
    expect(res.error.data.code).toBe('internal_error')
    expect(res.error.message).toBe('async boom')
  })

  it('처리기가 아무것도 돌려주지 않으면 result 는 null', async () => {
    const path = await start()
    const res = await call(path, req('nothing', common))
    expect('result' in res && res.result === null).toBe(true)
  })

  it('결과를 JSON 으로 만들 수 없으면 internal_error 로 답하고 닫는다', async () => {
    const path = await start()
    const res = await call(path, req('bigint', common, 4))
    expect(res.id).toBe(4)
    expect(res.error.data.code).toBe('internal_error')
  })

  it('여러 조각으로 나뉘어 온 요청을 이어 붙인다 — 한글이 조각 경계에서 잘려도', async () => {
    const path = await start()
    const line = Buffer.from(req('later', { ...common, value: '한글' }))
    const cut = line.indexOf(Buffer.from('한')) + 1
    const res = await call(path, [line.subarray(0, cut), line.subarray(cut)])
    expect(res.result).toEqual({ echo: '한글' })
  })

  it('줄바꿈 뒤에 온 것은 무시한다', async () => {
    const path = await start()
    const res = await call(path, req('ping', common) + req('no-such', common))
    expect(res.result).toEqual({ session: 's-test' })
  })

  it('줄바꿈 전에 상한을 넘으면 too_large 로 답하고 닫는다', async () => {
    const path = await start({ maxLine: 64 })
    const res = await call(path, 'x'.repeat(65))
    expect(res.error.code).toBe(-32600)
    expect(res.error.data.code).toBe('too_large')
  })

  it('조각마다는 상한 안이어도 합쳐서 넘으면 too_large', async () => {
    const path = await start({ maxLine: 64 })
    const res = await call(path, ['x'.repeat(40), 'x'.repeat(40)])
    expect(res.error.data.code).toBe('too_large')
  })

  it('상한 안의 요청은 받는다', async () => {
    const path = await start({ maxLine: 256 })
    const res = await call(path, req('ping', common))
    expect(res.result).toEqual({ session: 's-test' })
  })

  it('요청을 다 보내지 않고 멈춘 연결은 끊는다', async () => {
    const path = await start({ idleMs: 50 })
    expect(await exchange(path, '{"jsonrpc"')).toBe('')
  })

  it('남은 소켓 파일이 있어도 연다', async () => {
    mkdirSync(join(dir, 's'))
    writeFileSync(sockPath(), '')
    const path = await start()
    expect((await call(path, req('ping', common))).result).toEqual({ session: 's-test' })
  })

  it('남은 것이 유닉스 소켓이어도 연다', async () => {
    mkdirSync(join(dir, 's'))
    const leftover = createServer()
    await new Promise<void>((r) => leftover.listen(sockPath(), r))
    try {
      const path = await start()
      expect((await call(path, req('ping', common))).result).toEqual({ session: 's-test' })
    } finally {
      leftover.close()
    }
  })

  it('닫으면 소켓 파일을 지운다', async () => {
    const path = await start()
    await server!.close()
    server = null
    expect(existsSync(path)).toBe(false)
  })

  it('처리 중인 연결이 있어도 닫히고, 그 연결은 답 없이 끊긴다', async () => {
    const path = await start()
    const pending = exchange(path, req('hang', common))
    await new Promise((r) => setTimeout(r, 30))
    await server!.close()
    server = null
    expect(await pending).toBe('')
    release()
  })

  it('열지 못하면 거절한다', async () => {
    writeFileSync(join(dir, 's'), '')
    await expect(start()).rejects.toThrow()
  })
})
