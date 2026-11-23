import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHostLink, type HostLinkDeps, type HostProcess } from './host-link'
import type { HostEvent, KillRequest, OpenRequest } from './pty-host'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

type FakeHost = HostProcess & {
  received: string[]
  exit(): void
  emit(msg: HostEvent): void
}

function fakeHost(pid: number, log: string[]): FakeHost {
  const exits: (() => void)[] = []
  const listeners: ((msg: HostEvent) => void)[] = []
  const received: string[] = []
  return {
    pid,
    received,
    postMessage(msg) {
      const { type } = msg as { type: string }
      received.push(type)
      log.push(`host:${type}`)
    },
    on(_event, listener) {
      listeners.push(listener)
    },
    once(_event, listener) {
      exits.push(listener)
    },
    exit: () => exits.splice(0).forEach((f) => f()),
    emit: (msg) => listeners.forEach((f) => f(msg))
  }
}

function setup(ready: Promise<unknown> = Promise.resolve()) {
  const log: string[] = []
  const hosts: FakeHost[] = []
  const deps = {
    ready,
    fork: vi.fn(() => {
      const h = fakeHost(100 + hosts.length, log)
      hosts.push(h)
      return h
    }),
    onEvent: vi.fn(),
    onExit: vi.fn(),
    quitTimeoutMs: 7000,
    kill: vi.fn()
  } satisfies HostLinkDeps
  return { link: createHostLink(deps), deps, log, hosts }
}

const openReq = { type: 'open', id: 'p-1', dir: '/tmp/s' } as OpenRequest
const killReq: KillRequest = { type: 'kill', id: 'p-1', dir: '/tmp/s' }
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createHostLink', () => {
  afterEach(() => vi.useRealTimers())

  it('포트를 renderer 에 먼저 보내고 host 에는 ready 가 풀린 뒤 넘긴다', async () => {
    const ready = deferred()
    const { link, log } = setup(ready.promise)
    link.open(openReq, 'port1', () => log.push('renderer'))
    await settle()
    expect(log).toEqual(['renderer'])
    ready.resolve()
    await settle()
    expect(log).toEqual(['renderer', 'host:open'])
  })

  it('ready 전에 받은 open·kill 뒤에 quit 을 보낸다', async () => {
    const ready = deferred()
    const { link, hosts } = setup(ready.promise)
    link.open(openReq, 'port1', () => {})
    link.kill(killReq)
    const stopped = link.stop(true)
    ready.resolve()
    await settle()
    expect(hosts.map((h) => h.received)).toEqual([['open', 'kill', 'quit']])
    hosts[0].exit()
    await stopped
  })

  it('host 가 상한 안에 끝나지 않으면 kill 한 뒤 stop 이 풀린다', async () => {
    vi.useFakeTimers()
    const { link, deps, hosts } = setup()
    link.kill(killReq)
    await vi.advanceTimersByTimeAsync(0)
    let done = false
    void link.stop(false).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(6999)
    expect(done).toBe(false)
    expect(deps.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(deps.kill).toHaveBeenCalledWith(hosts[0].pid)
    expect(done).toBe(true)
  })

  it('host 가 상한 안에 끝나면 stop 이 풀리고, 상한이 지나도 kill 하지 않는다', async () => {
    vi.useFakeTimers()
    const { link, deps, hosts } = setup()
    link.kill(killReq)
    await vi.advanceTimersByTimeAsync(0)
    let done = false
    void link.stop(false).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(100)
    hosts[0].exit()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    await vi.advanceTimersByTimeAsync(7000)
    expect(deps.kill).not.toHaveBeenCalled()
  })

  it('상한에서 host 를 끄지 못해도 stop 은 풀린다', async () => {
    vi.useFakeTimers()
    const { link, deps } = setup()
    deps.kill.mockImplementation(() => {
      throw new Error('ESRCH')
    })
    link.kill(killReq)
    await vi.advanceTimersByTimeAsync(0)
    let done = false
    void link.stop(false).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(7000)
    expect(deps.kill).toHaveBeenCalledOnce()
    expect(done).toBe(true)
  })

  it('띄운 host 가 없으면 stop 은 host 를 띄우지 않고 풀린다', async () => {
    const { link, deps } = setup()
    await link.stop(true)
    expect(deps.fork).not.toHaveBeenCalled()
  })

  it('host 가 끝나면 알리고, 다음 요청은 새로 띄운 host 에 보낸다', async () => {
    const { link, deps, hosts } = setup()
    link.open(openReq, 'port1', () => {})
    await settle()
    hosts[0].emit({ type: 'live', id: 'p-1' })
    expect(deps.onEvent).toHaveBeenCalledWith({ type: 'live', id: 'p-1' })
    hosts[0].exit()
    expect(deps.onExit).toHaveBeenCalledOnce()
    link.kill(killReq)
    await settle()
    expect(hosts.map((h) => h.received)).toEqual([['open'], ['kill']])
  })
})
