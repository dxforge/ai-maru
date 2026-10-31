import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSeenTracker } from './seen'

const DELAY = 500

function setup() {
  vi.useFakeTimers()
  const seen: string[] = []
  const viewed: (string | null)[] = []
  let delay: number | null = DELAY
  const tracker = createSeenTracker({
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    delay: () => delay,
    viewed: (pty) => void viewed.push(pty),
    seen: (pty) => void seen.push(pty)
  })
  return {
    tracker,
    seen,
    viewed,
    wait: (ms: number) => void vi.advanceTimersByTime(ms),
    setDelay: (ms: number | null) => void (delay = ms)
  }
}

afterEach(() => void vi.useRealTimers())

describe('createSeenTracker', () => {
  it('들어와 delay 만큼 머물면 떠나기 전에 그 자리에서 한 번 알린다', () => {
    const { tracker, seen, wait } = setup()
    tracker.view('p-1')
    wait(DELAY - 1)
    expect(seen).toEqual([])
    wait(1)
    expect(seen).toEqual(['p-1'])
    wait(DELAY * 3)
    expect(seen).toEqual(['p-1'])
  })

  it('delay 보다 짧게 머물고 옮기거나 focus 가 빠지면 알리지 않는다', () => {
    const { tracker, seen, wait } = setup()
    tracker.view('p-1')
    wait(DELAY - 1)
    tracker.view('p-2')
    wait(DELAY - 1)
    tracker.view(null)
    wait(DELAY)
    expect(seen).toEqual([])
  })

  it('같은 pane 을 다시 알려도 들어온 시각은 그대로다', () => {
    const { tracker, seen, viewed, wait } = setup()
    tracker.view('p-1')
    wait(DELAY - 1)
    tracker.view('p-1')
    wait(1)
    expect(seen).toEqual(['p-1'])
    expect(viewed).toEqual(['p-1'])
  })

  it('focus 가 빠졌다 돌아오면 그때부터 다시 잰다', () => {
    const { tracker, seen, wait } = setup()
    tracker.view('p-1')
    wait(DELAY - 1)
    tracker.view(null)
    tracker.view('p-1')
    wait(DELAY - 1)
    expect(seen).toEqual([])
    wait(1)
    expect(seen).toEqual(['p-1'])
  })

  it('focus 를 가진 pane 이 바뀔 때마다 viewed 로 알리고, pane 이 없을 때 null 이 와도 알리지 않는다', () => {
    const { tracker, viewed } = setup()
    tracker.view(null)
    tracker.view('p-1')
    tracker.view('p-2')
    tracker.view(null)
    tracker.view(null)
    expect(viewed).toEqual(['p-1', 'p-2', null])
  })

  it('delay 는 들어올 때 읽는다', () => {
    const { tracker, seen, wait, setDelay } = setup()
    setDelay(0)
    tracker.view('p-1')
    wait(0)
    expect(seen).toEqual(['p-1'])
    setDelay(DELAY)
    tracker.view('p-2')
    wait(DELAY - 1)
    expect(seen).toEqual(['p-1'])
  })

  it('delay 가 null 이면 보고 있는 pane 이 없는 것으로 알리고 재지 않는다', () => {
    const { tracker, seen, viewed, wait, setDelay } = setup()
    setDelay(null)
    tracker.view('p-1')
    wait(DELAY * 10)
    expect(viewed).toEqual([])
    expect(seen).toEqual([])
  })

  it('보는 중에 delay 가 null 이 되거나 null 에서 풀리면 다시 부를 때 따른다', () => {
    const { tracker, seen, viewed, wait, setDelay } = setup()
    tracker.view('p-1')
    setDelay(null)
    tracker.view('p-1')
    wait(DELAY)
    expect(viewed).toEqual(['p-1', null])
    expect(seen).toEqual([])
    setDelay(DELAY)
    tracker.view('p-1')
    wait(DELAY)
    expect(viewed).toEqual(['p-1', null, 'p-1'])
    expect(seen).toEqual(['p-1'])
  })
})
