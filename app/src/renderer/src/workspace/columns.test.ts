import { describe, expect, it } from 'vitest'
import { columnsWidth } from './columns'

describe('columnsWidth', () => {
  it('칸마다 80열과 여백·스크롤바·0.5px 가 들어가는 가장 적은 셀 수만큼 잡는다', () => {
    expect(columnsWidth(1, 9)).toBe(82 * 9)
    expect(columnsWidth(3, 9)).toBe(3 * 82 * 9)
  })

  it('셀 폭이 소수면 여백을 올린 정수로 계산하고, 칸 폭은 셀 폭의 배수다', () => {
    expect(columnsWidth(1, 7.8)).toBeCloseTo(83 * 7.8)
  })

  it('셀 폭을 모르면 0 이다', () => {
    expect(columnsWidth(2, 0)).toBe(0)
  })
})
