// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { listenWindowPointer } from './windowPointer'

const fire = (type: string): void => {
  window.dispatchEvent(new Event(type))
}

describe('listenWindowPointer', () => {
  it('pointermove·pointerup·pointercancel 을 받고, 돌려준 함수를 부르면 셋 다 받지 않는다', () => {
    const move = vi.fn()
    const up = vi.fn()
    const cancel = vi.fn()
    const off = listenWindowPointer(move, up, cancel)
    fire('pointermove')
    fire('pointerup')
    fire('pointercancel')
    expect([move.mock.calls.length, up.mock.calls.length, cancel.mock.calls.length]).toEqual([
      1, 1, 1
    ])
    off()
    fire('pointermove')
    fire('pointerup')
    fire('pointercancel')
    expect([move.mock.calls.length, up.mock.calls.length, cancel.mock.calls.length]).toEqual([
      1, 1, 1
    ])
  })

  it('cancel 을 넘기지 않으면 pointercancel 도 up 이 받고, 떼면 받지 않는다', () => {
    const up = vi.fn()
    const off = listenWindowPointer(vi.fn(), up)
    fire('pointercancel')
    expect(up).toHaveBeenCalledTimes(1)
    off()
    fire('pointercancel')
    fire('pointerup')
    expect(up).toHaveBeenCalledTimes(1)
  })
})
