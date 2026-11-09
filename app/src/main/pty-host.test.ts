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
  protocolOf: async () => 4,
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

function open(
  id: string,
  attach = false,
  keep?: boolean,
  extra: Partial<OpenRequest> = {}
): ReturnType<typeof fakePort> {
  const port = fakePort()
  const req: OpenRequest = {
    type: 'open',
    id,
    attach,
    keep,
    ...extra,
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

function quit(keepPtys = true): void {
  send({ data: { type: 'quit', keepPtys }, ports: [] })
}

/** `spawnPty` 처럼 signal 을 abort 하면 실패하는 가짜. 그 전에는 뜨지 않는다. */
function spawnUntilAborted(): void {
  pty.spawnPty.mockImplementation(
    (...args: unknown[]) =>
      new Promise((_, reject) => {
        const { signal } = args[6] as { signal?: AbortSignal }
        signal?.addEventListener('abort', () => reject(new Error('stopped')))
      })
  )
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

  it('붙을 pty 가 없으면 gone 을 알리고, 같은 id 로 cwd 에서 명령 없이 셸을 띄워 이어 준다', async () => {
    pty.connect.mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce({})
    pty.spawnPty.mockResolvedValue('live')
    const port = open('p-00000001', true, true, { cwd: '/w', command: ['claude'] })
    await vi.waitFor(() =>
      expect(port.messages).toContainEqual({ type: 'spawned', id: 'p-00000001', cwd: '/w' })
    )
    expect(port.messages[0]).toEqual({ type: 'gone' })
    expect(port.messages).not.toContain(null)
    expect(pty.spawnPty).toHaveBeenCalledWith(
      'maru-pty',
      dir,
      {},
      'p-00000001',
      '/w',
      undefined,
      expect.objectContaining({ keep: undefined })
    )
    expect(toMain).toEqual([{ type: 'live', id: 'p-00000001' }])
  })

  it('붙는 중에 온 kill 은 gone 뒤 띄운 셸의 띄우기가 끝난 뒤에 끈다', async () => {
    let refuse!: (err: Error) => void
    pty.connect
      .mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)))
      .mockReturnValue(new Promise(() => {}))
    pty.spawnPty.mockResolvedValue('live')
    open('p-00000001', true, undefined, { cwd: '/w' })
    kill('p-00000001')
    await new Promise((r) => setTimeout(r, 20))
    expect(pty.killPty).not.toHaveBeenCalled()
    refuse(new Error('refused'))
    await vi.waitFor(() => expect(pty.spawnPty).toHaveBeenCalled())
    await vi.waitFor(() => expect(pty.killPty).toHaveBeenCalledWith(dir, 'p-00000001'))
  })

  it('keep 으로 연 pty 만 --keep 으로 띄운다', async () => {
    pty.spawnPty.mockResolvedValue('ended')
    const kept = open('p-00000001', false, true)
    const plain = open('p-00000002')
    await vi.waitFor(() => expect(kept.messages).toContain(null))
    await vi.waitFor(() => expect(plain.messages).toContain(null))
    expect(pty.spawnPty.mock.calls.map((c) => c[6].keep)).toEqual([true, undefined])
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

  it('뜨는 중인 pty 의 kill 은 멈추기 전에 뜬 pty 도 뜬 뒤에 끈다', async () => {
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

  it('뜨는 중인 pty 의 kill 은 띄우기를 멈추고 끈다', async () => {
    spawnUntilAborted()
    const port = open('p-00000001')
    await vi.waitFor(() => expect(pty.spawnPty).toHaveBeenCalled())
    kill('p-00000001')
    await vi.waitFor(() => expect(pty.killPty).toHaveBeenCalledWith(dir, 'p-00000001'))
    expect(port.messages).toContainEqual(expect.objectContaining({ type: 'error' }))
  })

  it('붙는 중에 온 kill 은 붙지 못해 띄우기 시작한 셸을 멈춘다', async () => {
    let refuse!: (err: Error) => void
    pty.connect.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)))
    spawnUntilAborted()
    open('p-00000001', true)
    kill('p-00000001')
    refuse(new Error('refused'))
    await vi.waitFor(() => expect(pty.killPty).toHaveBeenCalledWith(dir, 'p-00000001'))
  })

  it('pty 를 끄고 끝내는 quit 은 뜨는 중인 pty 를 멈추고 끝난다', async () => {
    const exit = spyExit()
    try {
      spawnUntilAborted()
      open('p-00000001')
      await vi.waitFor(() => expect(pty.spawnPty).toHaveBeenCalled())
      quit(false)
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    } finally {
      exit.mockRestore()
    }
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

  it('quit 은 그 앞뒤로 받은 kill 과 붙지 못해 끄는 pty 가 끝난 뒤에 끝난다', async () => {
    const exit = spyExit()
    try {
      const killed = deferred<void>()
      pty.killPty.mockReturnValue(killed.promise)
      pty.spawnPty.mockResolvedValue('live')
      pty.connect.mockRejectedValue(new Error('refused'))
      const port = open('p-00000001')
      await vi.waitFor(() => expect(port.messages).toContain(null))
      kill('p-00000002')
      await vi.waitFor(() => expect(pty.killPty).toHaveBeenCalledTimes(2))
      quit()
      await new Promise((r) => setTimeout(r, 20))
      const late = deferred<void>()
      pty.killPty.mockReturnValue(late.promise)
      kill('p-00000003')
      await vi.waitFor(() => expect(pty.killPty).toHaveBeenCalledTimes(3))
      killed.resolve()
      await new Promise((r) => setTimeout(r, 20))
      expect(exit).not.toHaveBeenCalled()
      late.resolve()
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    } finally {
      exit.mockRestore()
    }
  })

  it('끄기에 실패한 pty 가 있어도 quit 은 끝난다', async () => {
    const exit = spyExit()
    try {
      pty.killPty.mockRejectedValue(new Error('boom'))
      kill('p-00000001')
      quit()
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
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
