import { describe, expect, it } from 'vitest'
import { createSeenTracker, SEEN_MS } from './seen'

function setup() {
  let now = 0
  const seen: string[] = []
  const tracker = createSeenTracker({ now: () => now, seen: (pty) => void seen.push(pty) })
  return { tracker, seen, wait: (ms: number) => void (now += ms) }
}

describe('createSeenTracker', () => {
  it('SEEN_MS 이상 머문 뒤 다른 pane 으로 옮기거나 focus 가 빠지면 떠난 pane 을 알린다', () => {
    const { tracker, seen, wait } = setup()
    tracker.view('p-1')
    wait(SEEN_MS)
    tracker.view('p-2')
    wait(SEEN_MS)
    tracker.view(null)
    expect(seen).toEqual(['p-1', 'p-2'])
  })

  it('SEEN_MS 보다 짧게 머물렀으면 알리지 않는다', () => {
    const { tracker, seen, wait } = setup()
    tracker.view('p-1')
    wait(SEEN_MS - 1)
    tracker.view('p-2')
    wait(SEEN_MS - 1)
    tracker.view(null)
    expect(seen).toEqual([])
  })

  it('같은 pane 을 다시 알려도 들어온 시각은 그대로다', () => {
    const { tracker, seen, wait } = setup()
    tracker.view('p-1')
    wait(SEEN_MS - 1)
    tracker.view('p-1')
    wait(1)
    tracker.view(null)
    expect(seen).toEqual(['p-1'])
  })

  it('focus 가 빠졌다 돌아오면 그때부터 다시 잰다', () => {
    const { tracker, seen, wait } = setup()
    tracker.view('p-1')
    wait(SEEN_MS - 1)
    tracker.view(null)
    wait(SEEN_MS)
    tracker.view('p-1')
    wait(SEEN_MS - 1)
    tracker.view('p-2')
    expect(seen).toEqual([])
  })

  it('pane 이 없을 때 null 이 와도 알리지 않는다', () => {
    const { tracker, seen, wait } = setup()
    wait(SEEN_MS)
    tracker.view(null)
    expect(seen).toEqual([])
  })
})
