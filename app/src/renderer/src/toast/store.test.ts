import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToasts, type Toast } from './store'

const A: Toast = { level: 'error', title: 'A', lines: ['a'] }
const B: Toast = { level: 'warning', title: 'B', lines: ['b'], detail: 'b.toml' }

describe('createToasts', () => {
  it('put 한 토스트가 목록에 있다', () => {
    const t = createToasts()
    t.put('a', A)
    expect(t.list.value).toEqual([{ id: 'a', ...A }])
  })

  it('같은 id 로 다시 put 하면 자리를 지키고 내용만 바뀐다', () => {
    const t = createToasts()
    t.put('a', A)
    t.put('b', B)
    t.put('a', { ...A, title: 'A2' })
    expect(t.list.value.map((x) => [x.id, x.title])).toEqual([
      ['a', 'A2'],
      ['b', 'B']
    ])
  })

  it('close 하면 빠지고, 그 뒤 같은 id 로 put 하면 다시 들어간다', () => {
    const t = createToasts()
    t.put('a', A)
    t.close('a')
    expect(t.list.value).toEqual([])
    t.put('a', A)
    expect(t.list.value).toEqual([{ id: 'a', ...A }])
  })

  it('없는 id 를 close 해도 아무것도 바뀌지 않는다', () => {
    const t = createToasts()
    t.put('a', A)
    t.close('b')
    expect(t.list.value.map((x) => x.id)).toEqual(['a'])
  })
})

describe('createToasts 의 버튼과 시간', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const undo = (run: () => void, timeout?: number): Toast => ({
    level: 'info',
    title: 'U',
    lines: [],
    action: { label: 'Undo', run },
    timeout
  })

  it('act 는 토스트를 닫고 그 action 을 한 번 부른다', () => {
    const t = createToasts()
    const run = vi.fn()
    t.put('u', undo(run))
    t.act('u')
    expect(run).toHaveBeenCalledTimes(1)
    expect(t.list.value).toEqual([])
    t.act('u')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('action 이 없는 토스트에 act 하면 아무것도 바뀌지 않는다', () => {
    const t = createToasts()
    t.put('a', A)
    t.act('a')
    expect(t.list.value.map((x) => x.id)).toEqual(['a'])
  })

  it('timeout 이 지나면 닫히고, timeout 이 없으면 남는다', () => {
    const t = createToasts()
    t.put('u', undo(vi.fn(), 1000))
    t.put('a', A)
    vi.advanceTimersByTime(999)
    expect(t.list.value.map((x) => x.id)).toEqual(['u', 'a'])
    vi.advanceTimersByTime(1)
    expect(t.list.value.map((x) => x.id)).toEqual(['a'])
  })

  it('같은 id 로 다시 put 하면 시간을 처음부터 다시 잰다', () => {
    const t = createToasts()
    t.put('u', undo(vi.fn(), 1000))
    vi.advanceTimersByTime(600)
    t.put('u', undo(vi.fn(), 1000))
    vi.advanceTimersByTime(600)
    expect(t.list.value.map((x) => x.id)).toEqual(['u'])
    vi.advanceTimersByTime(400)
    expect(t.list.value).toEqual([])
  })

  it('시간이 지나기 전에 닫고 같은 id 로 timeout 없이 다시 put 하면 앞의 시간에 닫히지 않는다', () => {
    const t = createToasts()
    t.put('u', undo(vi.fn(), 1000))
    t.close('u')
    t.put('u', A)
    vi.advanceTimersByTime(2000)
    expect(t.list.value.map((x) => x.id)).toEqual(['u'])
  })
})
