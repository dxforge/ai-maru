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
  it('열 수 × 글자 칸 폭에 왼쪽 여백 4px 와 스크롤바 8px 를 더한다. 글자 칸 폭의 배수로 올리지 않는다', () => {
    expect(columnWidth(80, 9)).toBe(732)
    expect(columnWidth(80, 7.8)).toBeCloseTo(636)
  })

  it('글자 칸 폭을 모르면 0 이다', () => {
    expect(columnWidth(80, 0)).toBe(0)
  })

  it('그 폭을 다시 열 수로 세어도 같은 열 수다', () => {
    for (const cell of CELL_WIDTHS)
      for (const cols of [20, 80, 110, 144, 500])
        expect(fitCols(columnWidth(cols, cell), cell)).toBe(cols)
  })

  it('pane 여럿의 폭에서는 늘어선 pane 들의 여백·스크롤바 자리까지 열로 센다', () => {
    expect(fitCols(2 * columnWidth(80, 8), 8)).toBe(161)
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
  it('넓히기는 지금 폭보다 큰 가장 작은 정류장으로 간다', () => {
    expect(stepPaneCols(80, 1, 80)).toBe(110)
    expect(stepPaneCols(110, 1, 80)).toBe(144)
    expect(stepPaneCols(100, 1, 80)).toBe(110)
  })

  it('좁히기는 지금 폭보다 작은 가장 큰 정류장으로 간다', () => {
    expect(stepPaneCols(144, -1, 80)).toBe(110)
    expect(stepPaneCols(110, -1, 80)).toBe(80)
    expect(stepPaneCols(100, -1, 80)).toBe(80)
  })

  it('그런 정류장이 없으면 그대로다', () => {
    expect(stepPaneCols(144, 1, 80)).toBe(144)
    expect(stepPaneCols(300, 1, 80)).toBe(300)
    expect(stepPaneCols(80, -1, 80)).toBe(80)
    expect(stepPaneCols(50, -1, 80)).toBe(50)
    expect(stepPaneCols(100, -1, 100)).toBe(100)
    expect(stepPaneCols(200, 1, 200)).toBe(200)
  })

  it('설정 폭이 110·144 와 함께 정류장이고, 80 은 설정 폭이 아니면 정류장이 아니다', () => {
    expect(stepPaneCols(100, 1, 100)).toBe(110)
    expect(stepPaneCols(110, -1, 100)).toBe(100)
    expect(stepPaneCols(200, -1, 200)).toBe(144)
    expect(stepPaneCols(144, -1, 200)).toBe(110)
    expect(stepPaneCols(110, -1, 200)).toBe(110)
    expect(stepPaneCols(144, 1, 200)).toBe(200)
    expect(stepPaneCols(20, 1, 20)).toBe(110)
    expect(stepPaneCols(50, 1, 80)).toBe(80)
  })

  it('설정 폭이 110 이나 144 와 같으면 정류장은 둘이다', () => {
    expect(stepPaneCols(110, -1, 110)).toBe(110)
    expect(stepPaneCols(110, 1, 144)).toBe(144)
    expect(stepPaneCols(144, -1, 144)).toBe(110)
  })
})
