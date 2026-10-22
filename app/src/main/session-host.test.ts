import type { MessagePortMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KillRequest, OpenRequest } from './session-host'

const session = vi.hoisted(() => ({
  connect: vi.fn(),
  killSession: vi.fn(),
  spawnSession: vi.fn()
}))
vi.mock('./session', () => ({
  ...session,
  socketPath: (dir: string, id: string) => `${dir}/${id}.sock`,
  startDir: async (cwd?: string) => cwd ?? '/'
}))
vi.mock('./bridge', () => ({ bridge: () => {} }))

type Listener = (e: { data: unknown; ports: MessagePortMain[] }) => void
let send: Listener

function fakePort(): MessagePortMain & { messages: unknown[] } {
  const messages: unknown[] = []
  return Object.assign(Object.create(null), {
    messages,
    postMessage: (msg: string | null) => messages.push(msg === null ? null : JSON.parse(msg)),
    close: () => {},
    on: () => {}
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const dir = '/tmp/s'

function open(id: string, attach = false): ReturnType<typeof fakePort> {
  const port = fakePort()
  const req: OpenRequest = {
    type: 'open',
    id,
    attach,
    dir,
    bin: 'maru-session',
    setup: {} as never
  }
  send({ data: req, ports: [port] })
  return port
}

function kill(id: string): void {
  const req: KillRequest = { type: 'kill', id, dir }
  send({ data: req, ports: [] })
}

function quit(): void {
  send({ data: { type: 'quit' }, ports: [] })
}

function spyExit() {
  return vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  session.killSession.mockResolvedValue(undefined)
  Object.assign(process, {
    parentPort: { on: (_event: string, fn: Listener) => (send = fn) }
  })
  await import('./session-host')
})

describe('session host', () => {
  it('띄웠는데 붙지 못한 세션은 pane 에 끝났다고 알리고 끈다', async () => {
    session.spawnSession.mockResolvedValue('live')
    session.connect.mockRejectedValue(new Error('refused'))
    const port = open('s-00000001')
    await vi.waitFor(() => expect(port.messages).toContain(null))
    expect(port.messages).toContainEqual({ type: 'exit', code: null, signal: null })
    expect(session.killSession).toHaveBeenCalledWith(dir, 's-00000001')
  })

  it('띄우자마자 끝난 세션은 끄지 않는다', async () => {
    session.spawnSession.mockResolvedValue('ended')
    const port = open('s-00000001')
    await vi.waitFor(() => expect(port.messages).toContain(null))
    expect(session.killSession).not.toHaveBeenCalled()
  })

  it('host 가 띄우지 않은 세션도 kill 로 끈다', async () => {
    kill('s-00000002')
    await vi.waitFor(() => expect(session.killSession).toHaveBeenCalledWith(dir, 's-00000002'))
  })

  it('뜨는 중인 세션의 kill 은 세션이 뜬 뒤에 끈다', async () => {
    const spawned = deferred<string>()
    session.spawnSession.mockReturnValue(spawned.promise)
    session.connect.mockReturnValue(new Promise(() => {}))
    open('s-00000001')
    kill('s-00000001')
    await new Promise((r) => setTimeout(r, 20))
    expect(session.killSession).not.toHaveBeenCalled()
    spawned.resolve('live')
    await vi.waitFor(() => expect(session.killSession).toHaveBeenCalledWith(dir, 's-00000001'))
  })

  it('quit 은 뜨는 중인 세션이 다 뜬 뒤에 끝나고, 그 뒤의 open 은 세션을 띄우거나 붙지 않는다', async () => {
    const exit = spyExit()
    try {
      const spawned = deferred<string>()
      session.spawnSession.mockReturnValue(spawned.promise)
      session.connect.mockReturnValue(new Promise(() => {}))
      open('s-00000001')
      quit()
      const late = open('s-00000002')
      const lateAttach = open('s-00000003', true)
      await new Promise((r) => setTimeout(r, 20))
      expect(exit).not.toHaveBeenCalled()
      expect(late.messages).toEqual([null])
      expect(lateAttach.messages).toEqual([null])
      spawned.resolve('live')
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      expect(session.spawnSession).toHaveBeenCalledTimes(1)
      expect(session.connect).not.toHaveBeenCalledWith(`${dir}/s-00000003.sock`)
    } finally {
      exit.mockRestore()
    }
  })

  it('뜨는 중인 세션이 없으면 quit 은 바로 끝난다', async () => {
    const exit = spyExit()
    try {
      quit()
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    } finally {
      exit.mockRestore()
    }
  })

  it('띄우기에 실패한 세션이 있어도 quit 은 끝난다', async () => {
    const exit = spyExit()
    try {
      const spawned = deferred<string>()
      session.spawnSession.mockReturnValue(
        spawned.promise.then(() => Promise.reject(new Error('boom')))
      )
      const port = open('s-00000001')
      quit()
      spawned.resolve('')
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      await vi.waitFor(() =>
        expect(port.messages).toContainEqual(expect.objectContaining({ type: 'error' }))
      )
    } finally {
      exit.mockRestore()
    }
  })
})
