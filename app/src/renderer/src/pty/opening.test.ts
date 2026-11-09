import { describe, expect, it } from 'vitest'
import { openingView } from './opening'

describe('openingView', () => {
  it('1초가 지나기 전에는 보이지 않는다', () => {
    expect(openingView({ elapsedMs: 0, retryable: true })).toEqual({ kind: 'hidden' })
    expect(openingView({ elapsedMs: 999, retryable: true })).toEqual({ kind: 'hidden' })
  })

  it('1초부터 지난 초를 보이고, 5초부터 다시 열기를 더한다', () => {
    expect(openingView({ elapsedMs: 1000, retryable: true })).toEqual({
      kind: 'opening',
      seconds: 1,
      retry: false
    })
    expect(openingView({ elapsedMs: 4999, retryable: true })).toEqual({
      kind: 'opening',
      seconds: 4,
      retry: false
    })
    expect(openingView({ elapsedMs: 5000, retryable: true })).toEqual({
      kind: 'opening',
      seconds: 5,
      retry: true
    })
  })

  it('다시 열 수 없는 pane 은 5초가 지나도 다시 열기가 없다', () => {
    expect(openingView({ elapsedMs: 9000, retryable: false })).toEqual({
      kind: 'opening',
      seconds: 9,
      retry: false
    })
  })

  it('실패하면 지난 시간과 상관없이 이유를 보이고, 다시 열 수 있으면 다시 열기를 둔다', () => {
    expect(openingView({ elapsedMs: 10, failed: 'no shell', retryable: true })).toEqual({
      kind: 'failed',
      message: 'no shell',
      retry: true
    })
    expect(openingView({ elapsedMs: 10, failed: 'no shell', retryable: false })).toEqual({
      kind: 'failed',
      message: 'no shell',
      retry: false
    })
  })
})
