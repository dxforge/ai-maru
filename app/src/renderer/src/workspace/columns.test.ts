import { describe, expect, it } from 'vitest'
import { columnsWidth } from './columns'

describe('columnsWidth', () => {
  it('칸마다 80열 반과 스크롤바, 경계 1px 를 더하고 소수점은 올린다', () => {
    expect(columnsWidth(1, 9)).toBe(725 + 14 + 1)
    expect(columnsWidth(1, 9.03)).toBe(727 + 14 + 1)
    expect(columnsWidth(3, 9)).toBe(3 * (725 + 14 + 1))
  })
})
