import { describe, expect, it, vi } from 'vitest'
import type { ProgramStatusRecord, ProgramStatusState } from '../shared/program-status'
import type { PtyNotification, PtyState, PtyStateEntry } from '../shared/pty-state'
import type { StateHandlers } from './pty'
import { createPtyStates } from './pty-state'

function state(over: Partial<PtyState> = {}): PtyState {
  return {
    cwd: '/w',
    cwdReports: 1,
    title: null,
    foregroundCwd: null,
    command: null,
    records: [],
    ...over
  }
}

function setup(live = true) {
  const subs: { id: string; on: StateHandlers; closed: boolean }[] = []
  const emitted: [string, PtyStateEntry | null][] = []
  const notified: [string, PtyNotification][] = []
  const doneWhileViewed: [string, string[]][] = []
  const viewed = { pty: null as string | null }
  let alive = live
  const isLive = vi.fn(async () => alive)
  const states = createPtyStates({
    subscribe: (id, on) => {
      const sub = { id, on, closed: false }
      subs.push(sub)
      return () => void (sub.closed = true)
    },
    isLive,
    emit: (pty, entry) => void emitted.push([pty, entry]),
    notified: (pty, n) => void notified.push([pty, n]),
    viewing: (pty) => viewed.pty === pty,
    doneWhileViewed: (pty, records) => void doneWhileViewed.push([pty, records.map((r) => r.id)])
  })
  return {
    states,
    subs,
    emitted,
    notified,
    doneWhileViewed,
    viewed,
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
    expect(t.states.state('p-1')).toEqual(s)
    expect(t.states.state('p-2')).toBeUndefined()
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
    expect(t.states.state('p-1')).toBeUndefined()
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

  const first = { title: 'Tests', body: '3 failed' }
  const second = { title: '', body: 'done' }

  it('알림을 받을 때마다 알리고, 마지막 알림을 상태와 함께 들며 다음 상태에도 남긴다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state())
    t.last().on.notification(first)
    t.last().on.notification(second)
    expect(t.notified).toEqual([
      ['p-1', first],
      ['p-1', second]
    ])
    expect(t.emitted.at(-1)).toEqual(['p-1', { state: state(), notification: second }])
    t.last().on.state(state({ title: 'next' }))
    expect(t.states.entries()).toEqual({
      'p-1': { state: state({ title: 'next' }), notification: second }
    })
  })

  it('seen 은 읽지 않은 알림을 지워 알리고, 알림이 없으면 알리지 않는다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state())
    t.last().on.notification(first)
    t.states.seen('p-1')
    expect(t.emitted.at(-1)).toEqual(['p-1', { state: state() }])
    const count = t.emitted.length
    t.states.seen('p-1')
    t.states.seen('p-2')
    expect(t.emitted).toHaveLength(count)
    t.last().on.state(state({ title: 'next' }))
    expect(t.states.entries()).toEqual({ 'p-1': { state: state({ title: 'next' }) } })
  })

  it('다시 구독해도 읽지 않은 알림은 남는다', async () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state())
    t.last().on.notification(first)
    t.last().on.closed()
    await vi.waitFor(() => expect(t.subs).toHaveLength(2))
    t.last().on.state(state({ title: 'again' }))
    expect(t.states.entries()).toEqual({
      'p-1': { state: state({ title: 'again' }), notification: first }
    })
  })

  it('상태보다 먼저 온 알림은 들기만 하고 상태가 오면 함께 알린다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.notification(first)
    expect(t.emitted).toEqual([])
    expect(t.notified).toEqual([['p-1', first]])
    t.last().on.state(state())
    expect(t.emitted).toEqual([['p-1', { state: state(), notification: first }]])
  })

  it('다시 구독하려고 살아 있는지 묻는 동안 본 알림은 새 구독으로 옮기지 않는다', async () => {
    const t = setup()
    let answer!: (v: boolean) => void
    t.isLive.mockImplementationOnce(() => new Promise((r) => (answer = r)))
    t.states.watch('p-1')
    t.last().on.state(state())
    t.last().on.notification(first)
    t.last().on.closed()
    t.states.seen('p-1')
    answer(true)
    await vi.waitFor(() => expect(t.subs).toHaveLength(2))
    t.last().on.state(state({ title: 'again' }))
    expect(t.states.entries()).toEqual({ 'p-1': { state: state({ title: 'again' }) } })
  })

  it('forget 한 구독의 알림은 버린다', () => {
    const t = setup()
    t.states.watch('p-1')
    const sub = t.last()
    sub.on.state(state())
    t.states.forget('p-1')
    sub.on.notification(first)
    expect(t.notified).toEqual([])
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

describe('createPtyStates 의 보고 있는 pty', () => {
  const first = { title: 'Tests', body: '3 failed' }
  const record = (id: string, s: ProgramStatusState): ProgramStatusRecord => ({
    id,
    state: s,
    kind: null,
    progress: null,
    app: '',
    title: '',
    message: ''
  })

  it('보고 있는 pty 에 온 알림은 들지 않고 notified 에도 넘기지 않는다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state())
    t.viewed.pty = 'p-1'
    const count = t.emitted.length
    t.last().on.notification(first)
    expect(t.notified).toEqual([])
    expect(t.emitted).toHaveLength(count)
    expect(t.states.entries()).toEqual({ 'p-1': { state: state() } })
  })

  it('다른 pty 를 보고 있으면 알림을 든다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state())
    t.viewed.pty = 'p-2'
    t.last().on.notification(first)
    expect(t.notified).toEqual([['p-1', first]])
    expect(t.states.entries()).toEqual({ 'p-1': { state: state(), notification: first } })
  })

  it('보고 있는 pty 에서 이번에 done 이 된 레코드만 넘기고, 그 전부터 done 이던 것은 넘기지 않는다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state({ records: [record('', 'done'), record('a', 'working')] }))
    t.viewed.pty = 'p-1'
    t.last().on.state(state({ title: 'x', records: [record('', 'done'), record('a', 'working')] }))
    expect(t.doneWhileViewed).toEqual([])
    t.last().on.state(state({ records: [record('', 'done'), record('a', 'done')] }))
    expect(t.doneWhileViewed).toEqual([['p-1', ['a']]])
  })

  it('보고 있지 않은 pty 의 done 은 넘기지 않는다', () => {
    const t = setup()
    t.states.watch('p-1')
    t.viewed.pty = 'p-2'
    t.last().on.state(state({ records: [record('', 'done')] }))
    expect(t.doneWhileViewed).toEqual([])
  })

  it('다시 구독한 첫 상태에 이미 있던 done 은 넘기지 않는다', async () => {
    const t = setup()
    t.states.watch('p-1')
    t.last().on.state(state({ records: [record('', 'done')] }))
    t.viewed.pty = 'p-1'
    t.last().on.closed()
    await vi.waitFor(() => expect(t.subs).toHaveLength(2))
    t.last().on.state(state({ records: [record('', 'done')] }))
    expect(t.doneWhileViewed).toEqual([])
  })

  it('보고 있는 pty 를 처음 구독해 받은 첫 상태의 done 은 넘기지 않는다', () => {
    const t = setup()
    t.viewed.pty = 'p-1'
    t.states.watch('p-1')
    t.last().on.state(state({ records: [record('', 'done')] }))
    expect(t.doneWhileViewed).toEqual([])
    t.last().on.state(state({ records: [record('', 'done'), record('a', 'done')] }))
    expect(t.doneWhileViewed).toEqual([['p-1', ['a']]])
  })
})
