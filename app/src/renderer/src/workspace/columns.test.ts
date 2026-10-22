import { describe, expect, it } from 'vitest'
import { columnsWidth } from './columns'

describe('columnsWidth', () => {
  it('pane 마다 80열과 여백·스크롤바·0.5px 가 들어가는 가장 적은 셀 수만큼 잡는다', () => {
    expect(columnsWidth(1, 9, false)).toBe(82 * 9)
    expect(columnsWidth(3, 9, false)).toBe(3 * 82 * 9)
  })

  it('셀 폭이 소수면 여백을 올린 정수로 계산하고, pane 폭은 셀 폭의 배수다', () => {
    expect(columnsWidth(1, 7.8, false)).toBeCloseTo(83 * 7.8)
  })

  it('셀 폭을 모르면 0 이다', () => {
    expect(columnsWidth(2, 0, false)).toBe(0)
  })

  it('WebGL 의 내림한 셀 폭이면 0.5px 를 더 두지 않아, 여백과 스크롤바가 셀의 배수여도 80열이다', () => {
    expect(columnsWidth(1, 8, true)).toBe(82 * 8)
    expect(columnsWidth(1, 8, false)).toBe(83 * 8)
  })
})
