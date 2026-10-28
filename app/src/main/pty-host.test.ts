import type { MessagePortMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KillRequest, OpenRequest } from './pty-host'

const pty = vi.hoisted(() => ({
  connect: vi.fn(),
  killPty: vi.fn(),
  spawnPty: vi.fn()
}))
vi.mock('./pty', () => ({
  ...pty,
  socketPath: (dir: string, id: string) => `${dir}/${id}.sock`,
  startDir: async (cwd?: string) => cwd ?? '/'
}))
vi.mock('./bridge', () => ({ bridge: () => {} }))

type Listener = (e: { data: unknown; ports: MessagePortMain[] }) => void
let send: Listener
let toMain: unknown[]

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

function open(id: string, attach = false, keep?: boolean): ReturnType<typeof fakePort> {
  const port = fakePort()
  const req: OpenRequest = {
    type: 'open',
    id,
    attach,
    keep,
    dir,
    bin: 'maru-pty',
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
  pty.killPty.mockResolvedValue(undefined)
  toMain = []
  Object.assign(process, {
    parentPort: {
      on: (_event: string, fn: Listener) => (send = fn),
      postMessage: (msg: unknown) => toMain.push(msg)
    }
  })
  await import('./pty-host')
})

describe('pty host', () => {
  it('띄운 pty 에 붙으면 main 에 live 를 알리고, 붙지 못했거나 다시 붙은 pty 는 알리지 않는다', async () => {
    pty.spawnPty.mockResolvedValue('live')
    pty.connect.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('refused'))
    const port = open('p-00000001')
    await vi.waitFor(() =>
      expect(port.messages).toContainEqual(expect.objectContaining({ type: 'spawned' }))
    )
    expect(toMain).toEqual([{ type: 'live', id: 'p-00000001' }])
    const failed = open('p-00000002')
    await vi.waitFor(() => expect(failed.messages).toContain(null))
    pty.connect.mockResolvedValueOnce({})
    const again = open('p-00000003', true)
    await vi.waitFor(() => expect(again.messages).toHaveLength(1))
    expect(toMain).toEqual([{ type: 'live', id: 'p-00000001' }])
  })

  it('띄웠는데 붙지 못한 pty 는 pane 에 끝났다고 알리고 끈다', async () => {
    pty.spawnPty.mockResolvedValue('live')
    pty.connect.mockRejectedValue(new Error('refused'))
    const port = open('p-00000001')
    await vi.waitFor(() => expect(port.messages).toContain(null))
    expect(port.messages).toContainEqual({ type: 'exit', code: null, signal: null })
    expect(pty.killPty).toHaveBeenCalledWith(dir, 'p-00000001')
  })

  it('keep 으로 연 pty 만 --keep 으로 띄운다', async () => {
    pty.spawnPty.mockResolvedValue('ended')
    const kept = open('p-00000001', false, true)
    const plain = open('p-00000002')
    await vi.waitFor(() => expect(kept.messages).toContain(null))
    await vi.waitFor(() => expect(plain.messages).toContain(null))
    expect(pty.spawnPty.mock.calls.map((c) => c[6])).toEqual([{ keep: true }, { keep: undefined }])
  })

  it('띄우자마자 끝난 pty 는 끄지 않는다', async () => {
    pty.spawnPty.mockResolvedValue('ended')
    const port = open('p-00000001')
    await vi.waitFor(() => expect(port.messages).toContain(null))
    expect(pty.killPty).not.toHaveBeenCalled()
  })

  it('host 가 띄우지 않은 pty 도 kill 로 끈다', async () => {
    kill('p-00000002')
    await vi.waitFor(() => expect(pty.killPty).toHaveBeenCalledWith(dir, 'p-00000002'))
  })

  it('뜨는 중인 pty 의 kill 은 pty 가 뜬 뒤에 끈다', async () => {
    const spawned = deferred<string>()
    pty.spawnPty.mockReturnValue(spawned.promise)
    pty.connect.mockReturnValue(new Promise(() => {}))
    open('p-00000001')
    kill('p-00000001')
    await new Promise((r) => setTimeout(r, 20))
    expect(pty.killPty).not.toHaveBeenCalled()
    spawned.resolve('live')
    await vi.waitFor(() => expect(pty.killPty).toHaveBeenCalledWith(dir, 'p-00000001'))
  })

  it('quit 은 뜨는 중인 pty 가 다 뜬 뒤에 끝나고, 그 뒤의 open 은 pty 를 띄우거나 붙지 않는다', async () => {
    const exit = spyExit()
    try {
      const spawned = deferred<string>()
      pty.spawnPty.mockReturnValue(spawned.promise)
      pty.connect.mockReturnValue(new Promise(() => {}))
      open('p-00000001')
      quit()
      const late = open('p-00000002')
      const lateAttach = open('p-00000003', true)
      await new Promise((r) => setTimeout(r, 20))
      expect(exit).not.toHaveBeenCalled()
      expect(late.messages).toEqual([null])
      expect(lateAttach.messages).toEqual([null])
      spawned.resolve('live')
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      expect(pty.spawnPty).toHaveBeenCalledTimes(1)
      expect(pty.connect).not.toHaveBeenCalledWith(`${dir}/p-00000003.sock`)
    } finally {
      exit.mockRestore()
    }
  })

  it('뜨는 중인 pty 가 없으면 quit 은 바로 끝난다', async () => {
    const exit = spyExit()
    try {
      quit()
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    } finally {
      exit.mockRestore()
    }
  })

  it('띄우기에 실패한 pty 가 있어도 quit 은 끝난다', async () => {
    const exit = spyExit()
    try {
      const spawned = deferred<string>()
      pty.spawnPty.mockReturnValue(spawned.promise.then(() => Promise.reject(new Error('boom'))))
      const port = open('p-00000001')
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
