import { describe, expect, it } from 'vitest'
import { anchorScroll, bandRows, computePins, goToScrollTop, pinBands } from './streamLayout'

const R = 26
const tall = (n: number): number[] => Array.from({ length: n }, (_, i) => i * 300)
const box = (id: string, top: number, height: number) => ({ id, top, height })

describe('bandRows', () => {
  it('상한까지는 붙은 수만큼, 넘으면 상한 + 「더」 한 줄', () => {
    expect([0, 1, 2, 3, 4, 9].map((k) => bandRows(k))).toEqual([0, 1, 2, 3, 3, 3])
  })
})

describe('computePins', () => {
  it('맨 위에서는 위에 붙는 제목이 없고, 화면 아래로 나간 제목은 아래에 붙는다', () => {
    expect(computePins(tall(5), 0, 400)).toEqual({ above: 0, below: 3 })
  })

  it('묶음이 자라면 제목이 묶음 아래 끝에 닿을 때 붙는다', () => {
    expect(computePins(tall(5), 548, 2000).above).toBe(2)
    expect(computePins(tall(5), 549, 2000).above).toBe(3)
  })

  it('묶음이 이미 상한이면 제목이 묶음 밑으로 다 들어간 뒤에 붙는다', () => {
    // 넷째 제목(900)은 묶음 아래 끝(scrollTop + 3줄)에 닿는 822 가 아니라 한 줄 더 지난 848 을 넘어야 붙는다.
    expect(computePins(tall(5), 840, 2000).above).toBe(3)
    expect(computePins(tall(5), 848, 2000).above).toBe(3)
    expect(computePins(tall(5), 849, 2000).above).toBe(4)
  })

  it('아래쪽도 묶음이 상한이면 제목이 묶음 밑으로 다 들어간 뒤에 붙는다', () => {
    // 600 의 제목은 묶음 위 끝(290 + 400 - 3줄 = 612)에 닿았지만 줄 전체가 들어가지 않아 아직 붙지 않는다.
    expect(computePins(tall(6), 290, 400)).toEqual({ above: 2, below: 3 })
    expect(computePins(tall(6), 270, 400)).toEqual({ above: 1, below: 4 })
  })

  it('한 제목을 위와 아래에 함께 붙이지 않는다', () => {
    expect(computePins([0], 500, 100)).toEqual({ above: 1, below: 0 })
    expect(computePins([0, 300], 0, 100)).toEqual({ above: 0, below: 1 })
  })

  it('항목이 없으면 붙는 것도 없다', () => {
    expect(computePins([], 100, 400)).toEqual({ above: 0, below: 0 })
  })
})

describe('pinBands', () => {
  it('넘친 제목은 화면에서 먼 쪽 「더」 줄로 묶는다', () => {
    expect(pinBands(8, { above: 4, below: 3 })).toEqual({
      top: { more: [0, 1], shown: [2, 3] },
      bottom: { shown: [5, 6], more: [7] }
    })
  })

  it('상한 안이면 묶지 않는다', () => {
    expect(pinBands(5, { above: 1, below: 2 })).toEqual({
      top: { more: [], shown: [0] },
      bottom: { shown: [3, 4], more: [] }
    })
    expect(pinBands(3, { above: 0, below: 0 })).toEqual({
      top: { more: [], shown: [] },
      bottom: { shown: [], more: [] }
    })
  })

  it('항목이 줄었는데 붙은 수가 줄기 전 값이면 남은 항목 안에서만 센다', () => {
    expect(pinBands(2, { above: 3, below: 0 })).toEqual({
      top: { more: [], shown: [0, 1] },
      bottom: { shown: [], more: [] }
    })
    expect(pinBands(2, { above: 1, below: 3 })).toEqual({
      top: { more: [], shown: [0] },
      bottom: { shown: [1], more: [] }
    })
  })

  it('하나만 넘쳐도 묶는다', () => {
    expect(pinBands(6, { above: 3, below: 3 })).toEqual({
      top: { more: [0], shown: [1, 2] },
      bottom: { shown: [3, 4], more: [5] }
    })
  })
})

describe('goToScrollTop', () => {
  it('간 제목이 그 위 제목들로 채운 위쪽 묶음 바로 아래에 온다', () => {
    expect(goToScrollTop(0, 500)).toBe(500)
    expect(goToScrollTop(1, 500)).toBe(500 - R)
    expect(goToScrollTop(2, 500)).toBe(500 - 2 * R)
    expect(goToScrollTop(7, 500)).toBe(500 - 3 * R)
  })

  it('맨 위보다 위로 가지 않는다', () => {
    expect(goToScrollTop(2, 30)).toBe(0)
  })
})

describe('anchorScroll', () => {
  const before = (scrollTop: number) => ({
    scrollTop,
    cards: [box('a', 0, 300), box('b', 300, 300), box('c', 600, 300)]
  })

  it('맨 위에 있었으면 새 문서가 들어와도 맨 위에 둔다', () => {
    const after = [box('n', 0, 200), box('a', 200, 300), box('b', 500, 300), box('c', 800, 300)]
    expect(anchorScroll(before(0), after)).toBe(0)
  })

  it('읽던 중이면 새 문서가 들어온 높이만큼 옮겨 보던 내용이 움직이지 않는다', () => {
    const after = [box('n', 0, 200), box('a', 200, 300), box('b', 500, 300), box('c', 800, 300)]
    expect(anchorScroll(before(350), after)).toBe(550)
  })

  it('위쪽 문서가 접히면 그만큼 끌어올린다', () => {
    const after = [box('a', 0, R), box('b', R, 300), box('c', R + 300, 300)]
    expect(anchorScroll(before(350), after)).toBe(350 - 300 + R)
  })

  it('누른 제목이 기준이면 맨 위에서도 그 제목을 제자리에 둔다', () => {
    const b = { scrollTop: 0, cards: [box('a', 0, 300), box('b', 300, 300)] }
    expect(anchorScroll(b, [box('a', 0, R), box('b', R, 300)], 'b')).toBe(0)
    const c = { scrollTop: 100, cards: [box('a', 0, 300), box('b', 300, 300)] }
    expect(anchorScroll(c, [box('a', 0, 600), box('b', 600, 300)], 'b')).toBe(400)
  })

  it('기준 문서가 지워지면 그 뒤에 남은 첫 문서를 기준으로 한다', () => {
    expect(anchorScroll(before(400), [box('a', 0, 300), box('c', 300, 300)])).toBe(100)
  })

  it('기준 문서가 읽던 깊이보다 짧아지면 다음 문서로 넘어가지 않고 그 제목으로 간다', () => {
    const after = [box('a', 0, 300), box('b', 300, 100), box('c', 400, 300)]
    expect(anchorScroll(before(500), after)).toBe(300 - R)
    const collapsed = [box('a', 0, R), box('b', R, R), box('c', 2 * R, R)]
    expect(anchorScroll(before(500), collapsed)).toBe(0)
  })

  it('기준으로 삼을 문서가 없으면 scrollTop 을 그대로 둔다', () => {
    expect(anchorScroll(before(400), [])).toBe(400)
    expect(anchorScroll(before(5000), [box('a', 0, 300)])).toBe(5000)
  })
})
