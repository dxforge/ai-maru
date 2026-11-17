// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { overflowOf } from './overlayScroll'

describe('overflowOf', () => {
  it('고른 축만 스크롤하고, both 는 두 축 모두 스크롤한다', () => {
    expect(overflowOf('x')).toEqual({ x: 'scroll', y: 'hidden' })
    expect(overflowOf('y')).toEqual({ x: 'hidden', y: 'scroll' })
    expect(overflowOf('both')).toEqual({ x: 'scroll', y: 'scroll' })
  })
})
