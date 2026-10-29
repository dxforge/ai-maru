import { describe, expect, it } from 'vitest'
import { columnWidth, fitCols, paneCells, stepPaneCols } from './columns'

const CELL_WIDTHS = [7.82666, 7.8, 7.5, 8, 8.4296875, 9, 10.83]

describe('fitCols', () => {
  it('pane 폭에서 왼쪽 여백 4px 와 스크롤바 8px 를 뺀 폭에 들어가는 열 수다', () => {
    expect(fitCols(720, 7.82666)).toBe(90)
    expect(fitCols(12 + 80 * 9, 9)).toBe(80)
    expect(fitCols(12 + 80 * 9 - 0.01, 9)).toBe(79)
  })

  it('여백과 스크롤바보다 좁으면 0 이다', () => {
    expect(fitCols(10, 9)).toBe(0)
  })
})

describe('columnWidth', () => {
  it('열 수 × 글자 칸 폭에 왼쪽 여백 4px 와 스크롤바 8px 를 더하고, 글자 칸 폭의 배수로 올린다', () => {
    expect(columnWidth(80, 9)).toBe(738)
    expect(columnWidth(80, 7.8)).toBeCloseTo(639.6)
    expect(columnWidth(80, 6)).toBe(492)
  })

  it('글자 칸 폭을 모르면 0 이다', () => {
    expect(columnWidth(80, 0)).toBe(0)
  })

  it('그 폭을 다시 열 수로 세어도 같은 열 수다', () => {
    const cells = [...CELL_WIDTHS, ...Array.from({ length: 1600 }, (_, i) => 4 + i / 100)]
    for (const cell of cells)
      for (const cols of [20, 80, 110, 144, 500])
        expect(fitCols(columnWidth(cols, cell), cell)).toBe(cols)
  })

  it('글자 칸 폭의 배수다', () => {
    for (const cell of CELL_WIDTHS)
      for (const cols of [20, 80, 110, 144, 500]) {
        const n = columnWidth(cols, cell) / cell
        expect(n).toBeCloseTo(Math.round(n), 9)
      }
  })

  it('pane 여럿의 폭에서는 늘어선 pane 들의 여백·스크롤바 자리까지 열로 센다', () => {
    expect(fitCols(2 * columnWidth(80, 8), 8)).toBe(162)
    expect(fitCols(3 * columnWidth(80, 6), 6)).toBe(244)
  })
})

describe('paneCells', () => {
  it('열 수에 여백·스크롤바가 들어가는 글자 칸 수를 더한다', () => {
    expect(paneCells(20, 9)).toBe(22)
    expect(paneCells(20, 7.8)).toBe(22)
  })

  it('여백과 스크롤바가 글자 칸의 배수면 그 수만큼만 더한다', () => {
    expect(paneCells(20, 4)).toBe(23)
    expect(paneCells(20, 6)).toBe(22)
  })

  it('글자 칸 폭을 모르면 0 이다', () => {
    expect(paneCells(20, 0)).toBe(0)
  })
})

describe('stepPaneCols', () => {
  it('넓히기는 지금 폭에 간격을 더하고, 좁히기는 뺀다', () => {
    expect(stepPaneCols(80, 1, 20)).toBe(100)
    expect(stepPaneCols(100, 1, 20)).toBe(120)
    expect(stepPaneCols(120, -1, 20)).toBe(100)
    expect(stepPaneCols(100, -1, 20)).toBe(80)
    expect(stepPaneCols(80, 1, 7)).toBe(87)
  })

  it('간격의 배수에서 벗어난 폭도 그 폭에서 간격만큼 바꾼다', () => {
    expect(stepPaneCols(95, 1, 20)).toBe(115)
    expect(stepPaneCols(115, 1, 20)).toBe(135)
    expect(stepPaneCols(95, -1, 20)).toBe(75)
    expect(stepPaneCols(75, -1, 20)).toBe(55)
  })

  it('다음 폭이 범위 밖이면 그대로 두어, 넓히기·좁히기가 서로를 되돌린다', () => {
    expect(stepPaneCols(30, -1, 20)).toBe(30)
    expect(stepPaneCols(490, 1, 20)).toBe(490)
    expect(stepPaneCols(20, -1, 20)).toBe(20)
    expect(stepPaneCols(500, 1, 20)).toBe(500)
    expect(stepPaneCols(40, -1, 20)).toBe(20)
    expect(stepPaneCols(480, 1, 20)).toBe(500)
    expect(stepPaneCols(20, 1, 480)).toBe(500)
    expect(stepPaneCols(21, 1, 480)).toBe(21)
  })

  it('지금 폭이 범위 밖이면 범위 쪽으로 누를 때만 가까운 끝값으로 옮긴다', () => {
    expect(stepPaneCols(600, -1, 20)).toBe(500)
    expect(stepPaneCols(600, 1, 20)).toBe(600)
    expect(stepPaneCols(10, 1, 20)).toBe(20)
    expect(stepPaneCols(10, -1, 20)).toBe(10)
  })
})
