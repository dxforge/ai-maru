import { describe, expect, it } from 'vitest'
import { isPathCandidates, isPathText } from './link'

describe('isPathText', () => {
  it('글자 전체가 절대경로나 상대경로일 때만 참이다', () => {
    for (const text of ['/a/b.md', '/a/b.ts:12:3', 'src/x.vue', './e.vue']) {
      expect(isPathText(text)).toBe(true)
    }
    for (const text of ['/a/b', 'b.md', 'see /a/b.md', 'https://a.io/x.md', '/a/b.md now']) {
      expect(isPathText(text)).toBe(false)
    }
  })
})

describe('isPathCandidates', () => {
  it('글자와 0 이상의 정수 인덱스 배열 둘이 있을 때만 받는다', () => {
    expect(isPathCandidates({ text: '/a/b.md', starts: [0], ends: [3, 7] })).toBe(true)
    for (const v of [
      null,
      '/a/b.md',
      { text: 1, starts: [0], ends: [1] },
      { text: 'x', starts: 0, ends: [1] },
      { text: 'x', starts: [-1], ends: [1] },
      { text: 'x', starts: [0], ends: [1.5] },
      { text: 'x', starts: [0] }
    ]) {
      expect(isPathCandidates(v)).toBe(false)
    }
  })
})
