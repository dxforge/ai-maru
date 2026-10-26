import { describe, expect, it, vi } from 'vitest'
import type { PtyState, PtyStateEntry } from '../shared/pty-state'
import type { StateHandlers } from './pty'
import { createPtyStates } from './pty-state'

function state(over: Partial<PtyState> = {}): PtyState {
  return { cwd: '/w', cwdReports: 1, title: null, foregroundCwd: null, records: [], ...over }
}

function setup(live = true) {
  const subs: { id: string; on: StateHandlers; closed: boolean }[] = []
  const emitted: [string, PtyStateEntry | null][] = []
  let alive = live
  const isLive = vi.fn(async () => alive)
  const states = createPtyStates({
    subscribe: (id, on) => {
      const sub = { id, on, closed: false }
      subs.push(sub)
      return () => void (sub.closed = true)
    },
    isLive,
    emit: (pty, entry) => void emitted.push([pty, entry])
  })
  return {
    states,
    subs,
    emitted,
    isLive,
    last: () => subs[subs.length - 1],
    die: () => void (alive = false)
  }
}

describe('createPtyStates', () => {
  it('구독해 받은 상태를 들고 알리며, 같은 pty 는 한 번만 구독한다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.states.watch('p-1')
    expect(t.subs).toHaveLength(1)
    const root = {
      id: '',
      state: 'working',
      kind: null,
      progress: null,
      app: 'x',
      title: '',
      message: ''
    } as const
    const s = state({ records: [root, { ...root, id: 'sub' }] })
    t.last().on.state(s)
    expect(t.emitted).toEqual([['p-1', { state: s }]])
    expect(t.states.entries()).toEqual({ 'p-1': { state: s } })
    expect(t.states.root('p-1')).toEqual(root)
    expect(t.states.root('p-2')).toBeUndefined()
  })

  it('상태를 받은 구독이 끊기고 pty 가 살아 있으면 마지막 상태를 둔 채 다시 구독한다', async () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state())
    t.last().on.closed()
    await vi.waitFor(() => expect(t.subs).toHaveLength(2))
    expect(t.states.entries()).toEqual({ 'p-1': { state: state() } })
    t.last().on.state(state({ title: 'again' }))
    expect(t.emitted.at(-1)).toEqual(['p-1', { state: state({ title: 'again' }) }])
  })

  it('다시 연 구독이 첫 상태를 받기 전에 끊기면 상태를 지운다', async () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state())
    t.last().on.closed()
    await vi.waitFor(() => expect(t.subs).toHaveLength(2))
    t.last().on.closed()
    await vi.waitFor(() => expect(t.emitted.at(-1)).toEqual(['p-1', null]))
    expect(t.subs).toHaveLength(2)
    expect(t.states.entries()).toEqual({})
  })

  it('pty 가 죽어 끊기면 상태를 지우고 알린다', async () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state())
    t.die()
    t.last().on.closed()
    await vi.waitFor(() => expect(t.emitted.at(-1)).toEqual(['p-1', null]))
    expect(t.subs).toHaveLength(1)
    t.states.watch('p-1')
    expect(t.subs).toHaveLength(2)
  })

  it('상태 없이 끊긴 첫 구독은 살아 있는지 묻지 않고 알릴 것 없이 그만둔다', async () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.closed()
    await Promise.resolve()
    expect(t.isLive).not.toHaveBeenCalled()
    expect(t.emitted).toEqual([])
    t.states.watch('p-1')
    expect(t.subs).toHaveLength(2)
  })

  it('이전 maru-pty 의 pty 는 old 로 든다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.old()
    expect(t.emitted).toEqual([['p-1', { old: true }]])
    expect(t.states.entries()).toEqual({ 'p-1': { old: true } })
    expect(t.states.root('p-1')).toBeUndefined()
  })

  it('forget 은 구독을 닫고 상태를 지우며, 그 뒤에 온 것은 버린다', async () => {
    const t = setup()
    t.states.watch('p-1')
    const sub = t.last()
    sub.on.state(state())
    t.states.forget('p-1')
    expect(sub.closed).toBe(true)
    expect(t.emitted.at(-1)).toEqual(['p-1', null])
    sub.on.state(state({ title: 'late' }))
    sub.on.closed()
    await Promise.resolve()
    expect(t.emitted).toHaveLength(2)
    expect(t.subs).toHaveLength(1)
    expect(t.states.entries()).toEqual({})
  })

  it('살아 있는지 묻는 동안 forget 하면 다시 구독하지 않는다', async () => {
    const t = setup()
    let answer!: (v: boolean) => void
    t.isLive.mockImplementationOnce(() => new Promise((r) => (answer = r)))
    t.states.watch('p-1')
    t.last().on.state(state())
    t.last().on.closed()
    t.states.forget('p-1')
    answer(true)
    await new Promise((r) => setTimeout(r))
    expect(t.subs).toHaveLength(1)
  })
})
