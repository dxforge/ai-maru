import { describe, expect, it } from 'vitest'
import { InvalidParams, Subscription } from './cli-server'
import { createMonitor } from './monitor'

const B = 's-0000000b'
const C = 's-0000000c'

function setup() {
  const monitor = createMonitor({ shellPidOf: async (s) => (s === B ? 42 : null) })
  const subscribe = async (session: string, ancestors: unknown) => {
    const sub = await monitor.handlers['monitor.subscribe']({ ancestors }, session)
    expect(sub).toBeInstanceOf(Subscription)
    const got: object[] = []
    let open = true
    const stop = (sub as Subscription).start((e) => open && got.push(e) > 0)
    return { got, stop, close: () => (open = false), method: (sub as Subscription).method }
  }
  return { monitor, subscribe }
}

describe('monitor.subscribe', () => {
  it.each([[undefined], [null], [{}], ['42'], [[0]], [[1.5]], [['42']]])(
    'ancestors 가 pid 배열이 아니면 거절한다 (%j)',
    async (ancestors) => {
      const { subscribe } = setup()
      await expect(subscribe(B, ancestors)).rejects.toThrow(InvalidParams)
    }
  )

  it('세션의 셸 pid 가 조상에 없으면 거절한다', async () => {
    const { subscribe } = setup()
    await expect(subscribe(B, [7, 8])).rejects.toThrow(`not running under session ${B}'s shell`)
  })

  it('세션 레코드가 없으면 거절한다', async () => {
    const { subscribe } = setup()
    await expect(subscribe(C, [42])).rejects.toThrow(InvalidParams)
  })

  it('세션 id 모양이 아니면 거절한다', async () => {
    const { subscribe } = setup()
    await expect(subscribe('../x', [42])).rejects.toThrow(InvalidParams)
  })

  it('셸 pid 가 조상 어디에 있어도 받고, 알림은 monitor.event 로 간다', async () => {
    const { monitor, subscribe } = setup()
    const s = await subscribe(B, [99, 50, 42, 1])
    expect(s.method).toBe('monitor.event')
    expect(monitor.emit(B, { event: 'x' })).toBe(true)
    expect(s.got).toEqual([{ event: 'x' }])
  })
})

describe('emit', () => {
  it('구독자가 없으면 false', () => {
    const { monitor } = setup()
    expect(monitor.emit(B, { event: 'x' })).toBe(false)
  })

  it('구독자가 여럿이면 모두 받는다', async () => {
    const { monitor, subscribe } = setup()
    const s1 = await subscribe(B, [42])
    const s2 = await subscribe(B, [42])
    monitor.emit(B, { event: 'x' })
    expect(s1.got).toHaveLength(1)
    expect(s2.got).toHaveLength(1)
  })

  it('구독을 풀면 받지 않고, 마지막 구독이 풀리면 false', async () => {
    const { monitor, subscribe } = setup()
    const s = await subscribe(B, [42])
    s.stop()
    expect(monitor.emit(B, { event: 'x' })).toBe(false)
    expect(s.got).toEqual([])
  })

  it('연결이 닫혀 보내지 못한 구독만 있으면 false', async () => {
    const { monitor, subscribe } = setup()
    const closed = await subscribe(B, [42])
    closed.close()
    expect(monitor.emit(B, { event: 'x' })).toBe(false)
    const live = await subscribe(B, [42])
    expect(monitor.emit(B, { event: 'y' })).toBe(true)
    expect(live.got).toEqual([{ event: 'y' }])
  })

  it('해제가 두 번 불려도 그 뒤의 새 구독은 남는다', async () => {
    const { monitor, subscribe } = setup()
    const old = await subscribe(B, [42])
    old.stop()
    const fresh = await subscribe(B, [42])
    old.stop()
    expect(monitor.emit(B, { event: 'x' })).toBe(true)
    expect(fresh.got).toHaveLength(1)
  })
})
