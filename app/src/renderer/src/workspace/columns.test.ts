import { describe, expect, it } from 'vitest'
import { columnsWidth, paneCells, stepPaneCols } from './columns'

describe('paneCells', () => {
  it('열 수에 여백·스크롤바·0.5px 가 들어가는 글자 칸 수를 더한다', () => {
    expect(paneCells(20, 9, false)).toBe(22)
    expect(paneCells(20, 8, false)).toBe(23)
    expect(paneCells(20, 8, true)).toBe(22)
  })

  it('글자 칸 폭을 모르면 0 이다', () => {
    expect(paneCells(20, 0, false)).toBe(0)
  })
})

describe('columnsWidth', () => {
  it('pane 마다 80열과 여백·스크롤바·0.5px 가 들어가는 가장 적은 글자 칸 수만큼 잡는다', () => {
    expect(columnsWidth(1, 9, false, 80)).toBe(82 * 9)
    expect(columnsWidth(3, 9, false, 80)).toBe(3 * 82 * 9)
  })

  it('글자 칸 폭이 소수면 여백을 올린 정수로 계산하고, pane 폭은 글자 칸 폭의 배수다', () => {
    expect(columnsWidth(1, 7.8, false, 80)).toBeCloseTo(83 * 7.8)
  })

  it('글자 칸 폭을 모르면 0 이다', () => {
    expect(columnsWidth(2, 0, false, 80)).toBe(0)
  })

  it('WebGL 의 내림한 글자 칸 폭이면 0.5px 를 더 두지 않아, 여백과 스크롤바가 글자 칸의 배수여도 80열이다', () => {
    expect(columnsWidth(1, 8, true, 80)).toBe(82 * 8)
    expect(columnsWidth(1, 8, false, 80)).toBe(83 * 8)
  })

  it('pane 폭을 주면 80 대신 그 열 수로 잡고, 내림한 글자 칸 폭이면 그 열 수에 한 열을 더 붙이지 않는다', () => {
    expect(columnsWidth(1, 9, false, 110)).toBe(112 * 9)
    expect(columnsWidth(2, 8, true, 144)).toBe(2 * 146 * 8)
    expect(columnsWidth(1, 8, true, 110)).toBe(112 * 8)
    expect(columnsWidth(1, 8, false, 110)).toBe(113 * 8)
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
