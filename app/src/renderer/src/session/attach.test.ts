import { describe, expect, it } from 'vitest'
import { replayAlignment } from './attach'

describe('replayAlignment', () => {
  it('잘린 꼬리 빈 행을 맨 아래에서 개행으로 되살리고 커서를 옮긴다', () => {
    expect(replayAlignment({ rows: 24, cursorX: 4, cursorY: 2, trailingBlankRows: 3 }, 24)).toBe(
      '\x1b[24;1H\n\n\n\x1b[3;5H'
    )
  })

  it('꼬리 빈 행이 없으면 커서만 옮긴다', () => {
    expect(replayAlignment({ rows: 24, cursorX: 0, cursorY: 23, trailingBlankRows: 0 }, 24)).toBe(
      '\x1b[24;1H'
    )
  })

  it('빈 행은 화면 높이를 넘겨 더하지 않는다', () => {
    expect(replayAlignment({ rows: 3, cursorX: 0, cursorY: 0, trailingBlankRows: 99 }, 3)).toBe(
      '\x1b[3;1H\n\n\n\x1b[1;1H'
    )
  })

  it('세션과 그리드 높이가 다르면 손대지 않는다', () => {
    expect(replayAlignment({ rows: 30, cursorX: 0, cursorY: 0, trailingBlankRows: 2 }, 24)).toBe('')
  })
})
