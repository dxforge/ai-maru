import { describe, expect, it } from 'vitest'
import { paneMin, snapRects, type Size } from './grid'
import type { Layout, Widths } from './layout'
import {
  dividers,
  equalizeAll,
  equalizeLine,
  keyResize,
  moveDivider,
  type ResizeContext,
  type Target
} from './resize'

const cell = { width: 8, height: 18 }
const min = paneMin(cell)
const area: Size = { width: 100 * 8, height: 30 * 18 }

function ctxOf(layout: Layout, widths: Widths = 'even', maxCols = 500): ResizeContext {
  const size = widths === 'even' ? area : { width: 2000, height: area.height }
  return { boxes: snapRects(layout, size, cell, widths, min), cell, min, widths, maxCols }
}

const cellsWide = (layout: Layout) =>
  [...snapRects(layout, area, cell, 'even', min)].map(([p, b]) => [p, b.width / 8])

const ab: Layout = { split: 'right', first: { pane: 1 }, second: { pane: 2 } }
const between: Target = { kind: 'line', path: [], index: 0, split: 'right' }

// A | (B1 / B2) | C
const grouped: Layout = {
  split: 'right',
  first: { pane: 1, weight: 10 },
  second: {
    split: 'right',
    first: {
      split: 'down',
      first: { pane: 2, weight: 20 },
      second: { pane: 3, weight: 10 },
      weight: 30
    },
    second: { pane: 4, weight: 20 }
  }
}

describe('moveDivider', () => {
  it('비율로 나눈 줄은 이웃한 두 항목만 바뀌고, 몫을 글자 칸 수로 적는다', () => {
    const next = moveDivider(ab, between, 5, ctxOf(ab))
    expect(next).toEqual({
      split: 'right',
      first: { pane: 1, weight: 55 },
      second: { pane: 2, weight: 45 }
    })
    expect(cellsWide(next)).toEqual([
      [1, 55],
      [2, 45]
    ])
  })

  it('하한에서 멈춘다', () => {
    expect(cellsWide(moveDivider(ab, between, 100, ctxOf(ab)))).toEqual([
      [1, 78],
      [2, 22]
    ])
    const down: Layout = { split: 'down', first: { pane: 1 }, second: { pane: 2 } }
    const up = moveDivider(down, { ...between, split: 'down' }, -100, ctxOf(down))
    expect(up).toMatchObject({ first: { weight: 6 }, second: { weight: 24 } })
  })

  it('옮길 거리가 0 이면 같은 layout 을 돌려준다', () => {
    expect(moveDivider(ab, between, 0, ctxOf(ab))).toBe(ab)
    const tight = moveDivider(ab, between, 100, ctxOf(ab))
    expect(moveDivider(tight, between, 1, ctxOf(tight))).toBe(tight)
  })

  it('세 항목 줄에서 가운데 경계를 옮기면 첫 항목은 그대로다', () => {
    const three: Layout = {
      split: 'right',
      first: { pane: 1 },
      second: { split: 'right', first: { pane: 2 }, second: { pane: 3 } }
    }
    const next = moveDivider(three, { ...between, index: 1 }, 4, ctxOf(three))
    expect(cellsWide(next)).toEqual([
      [1, 33],
      [2, 38],
      [3, 29]
    ])
  })
})

describe('columns 의 좌우 밀기', () => {
  const cols = { cols: 80 }

  it('경계 왼쪽 pane 의 열 수만 바뀐다', () => {
    expect(moveDivider(ab, between, 10, ctxOf(ab, cols))).toEqual({
      split: 'right',
      first: { pane: 1, cols: 90 },
      second: { pane: 2 }
    })
  })

  it('20열과 보이는 폭의 열 수에서 멈춘다', () => {
    expect(moveDivider(ab, between, -100, ctxOf(ab, cols))).toMatchObject({
      first: { cols: 20 }
    })
    expect(moveDivider(ab, between, 100, ctxOf(ab, cols, 120))).toMatchObject({
      first: { cols: 120 }
    })
  })

  it('보이는 폭보다 이미 넓은 pane 은 좁히기만 된다', () => {
    const wide: Layout = { ...ab, first: { pane: 1, cols: 200 } }
    expect(moveDivider(wide, between, 5, ctxOf(wide, cols, 120))).toBe(wide)
    expect(moveDivider(wide, between, -5, ctxOf(wide, cols, 120))).toMatchObject({
      first: { cols: 195 }
    })
  })

  it('cell 의 열 수로 돌아오면 열 수를 지운다', () => {
    const wide: Layout = { ...ab, first: { pane: 1, cols: 90 } }
    expect(moveDivider(wide, between, -10, ctxOf(wide, cols))).toEqual(ab)
  })

  it('왼쪽 항목이 위아래로 나뉘었으면 경계에 닿는 pane 들이 같이 넓어진다', () => {
    const layout: Layout = {
      split: 'right',
      first: { split: 'down', first: { pane: 1 }, second: { pane: 2 } },
      second: { pane: 3 }
    }
    expect(moveDivider(layout, between, 4, ctxOf(layout, cols))).toEqual({
      split: 'right',
      first: { split: 'down', first: { pane: 1, cols: 84 }, second: { pane: 2, cols: 84 } },
      second: { pane: 3 }
    })
  })

  it('cell 의 오른쪽 끝은 그 끝에 닿는 pane 을 넓힌다', () => {
    // (A | B) / C 에서 A 가 100열이면 끝에 닿는 것은 B 다. C 는 남는 폭을 채울 뿐이다.
    const layout: Layout = {
      split: 'down',
      first: { split: 'right', first: { pane: 1, cols: 100 }, second: { pane: 2 } },
      second: { pane: 3 }
    }
    expect(moveDivider(layout, { kind: 'edge', split: 'right' }, 6, ctxOf(layout, cols))).toEqual({
      split: 'down',
      first: { split: 'right', first: { pane: 1, cols: 100 }, second: { pane: 2, cols: 86 } },
      second: { pane: 3 }
    })
  })

  it('위아래로 나눈 왼쪽 항목을 좁은 pane 보다 좁히면 좁은 pane 도 새 끝까지 줄인다', () => {
    // (A 120열 / B 80열) | C. B 는 A 폭으로 그려지므로, B 의 열 수를 그대로 두면 저장한 열 수가 보이는 폭보다 작아진다.
    const layout: Layout = {
      split: 'right',
      first: { split: 'down', first: { pane: 1, cols: 120 }, second: { pane: 2 } },
      second: { pane: 3 }
    }
    expect(moveDivider(layout, between, -30, ctxOf(layout, cols))).toMatchObject({
      first: { first: { pane: 1, cols: 90 }, second: { pane: 2 } }
    })
    expect(moveDivider(layout, between, -50, ctxOf(layout, cols))).toMatchObject({
      first: { first: { pane: 1, cols: 70 }, second: { pane: 2, cols: 70 } }
    })
    expect(moveDivider(layout, between, -200, ctxOf(layout, cols))).toMatchObject({
      first: { first: { pane: 1, cols: 20 }, second: { pane: 2, cols: 20 } }
    })
  })

  it('cell 의 오른쪽 끝을 좁은 줄보다 왼쪽으로 끌면 좁은 줄의 pane 도 줄인다', () => {
    // (A | B) / C 에서 C 가 150열이면 위 줄이 12글자 칸 넓다(pane 마다 여백 2글자 칸). 끝을 20글자 칸 당기면 C 는 8열 줄어든다.
    const layout: Layout = {
      split: 'down',
      first: { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      second: { pane: 3, cols: 150 }
    }
    expect(moveDivider(layout, { kind: 'edge', split: 'right' }, -20, ctxOf(layout, cols))).toEqual(
      {
        split: 'down',
        first: { split: 'right', first: { pane: 1 }, second: { pane: 2, cols: 60 } },
        second: { pane: 3, cols: 142 }
      }
    )
  })

  it('위아래 경계는 비율로 옮긴다', () => {
    const down: Layout = { split: 'down', first: { pane: 1 }, second: { pane: 2 } }
    expect(moveDivider(down, { ...between, split: 'down' }, 3, ctxOf(down, cols))).toEqual({
      split: 'down',
      first: { pane: 1, weight: 18 },
      second: { pane: 2, weight: 12 }
    })
  })
})

describe('dividers', () => {
  it('줄마다 항목 사이의 경계와, columns 면 cell 오른쪽 끝을 준다', () => {
    const layout: Layout = {
      split: 'right',
      first: { pane: 1 },
      second: { split: 'down', first: { pane: 2 }, second: { pane: 3 } }
    }
    expect(dividers(layout, ctxOf(layout).boxes, 'even')).toEqual([
      { kind: 'line', path: [], index: 0, split: 'right', pos: 50 * 8, start: 0, end: 30 * 18 },
      {
        kind: 'line',
        path: ['second'],
        index: 0,
        split: 'down',
        pos: 15 * 18,
        start: 50 * 8,
        end: 100 * 8
      }
    ])
    const cols = dividers(ab, ctxOf(ab, { cols: 80 }).boxes, { cols: 80 })
    expect(cols.map((d) => [d.kind, d.pos])).toEqual([
      ['line', 82 * 8],
      ['edge', 2000]
    ])
  })
})

describe('keyResize', () => {
  const three: Layout = {
    split: 'right',
    first: { pane: 1 },
    second: { split: 'right', first: { pane: 2 }, second: { pane: 3 } }
  }

  it('그 방향의 경계를 그 방향으로 한 글자 칸 옮긴다', () => {
    expect(cellsWide(keyResize(three, 1, 'right', ctxOf(three)))).toEqual([
      [1, 34],
      [2, 33],
      [3, 33]
    ])
    expect(cellsWide(keyResize(three, 2, 'left', ctxOf(three)))).toEqual([
      [1, 32],
      [2, 35],
      [3, 33]
    ])
  })

  it('그 방향에 경계가 없으면 반대쪽 경계를 그 방향으로 옮긴다', () => {
    expect(cellsWide(keyResize(three, 3, 'right', ctxOf(three)))).toEqual([
      [1, 33],
      [2, 35],
      [3, 32]
    ])
  })

  it('안쪽 줄에 그 방향 경계가 없으면 바깥 줄의 경계를 옮긴다', () => {
    // A | (B / (C | D)) 에서 D 의 오른쪽 경계는 없고, 바깥 줄에도 없다 → 안쪽 줄의 왼쪽 경계.
    const layout: Layout = {
      split: 'right',
      first: { pane: 1 },
      second: {
        split: 'down',
        first: { pane: 2 },
        second: { split: 'right', first: { pane: 3 }, second: { pane: 4 } }
      }
    }
    expect(keyResize(layout, 4, 'right', ctxOf(layout))).toMatchObject({
      second: { second: { first: { weight: 26 }, second: { weight: 24 } } }
    })
    // C 의 왼쪽에는 안쪽 줄의 경계가 없으므로 바깥 줄 A | (…) 의 경계를 옮긴다.
    expect(keyResize(layout, 3, 'left', ctxOf(layout))).toMatchObject({
      first: { weight: 49 },
      second: { weight: 51 }
    })
  })

  it('그 축으로 나눈 줄이 없으면 그대로다', () => {
    expect(keyResize(ab, 1, 'up', ctxOf(ab))).toBe(ab)
  })

  it('columns 에서 위 pane 보다 좁은 pane 은 그려진 오른쪽 끝이 한 글자 칸 움직인다', () => {
    const layout: Layout = {
      split: 'right',
      first: { split: 'down', first: { pane: 1, cols: 120 }, second: { pane: 2 } },
      second: { pane: 3 }
    }
    const right = (l: Layout) => {
      const b = snapRects(l, { width: 2000, height: area.height }, cell, { cols: 80 }, min).get(2)!
      return b.left + b.width
    }
    const wider = keyResize(layout, 2, 'right', ctxOf(layout, { cols: 80 }))
    expect(right(wider) - right(layout)).toBe(8)
    const narrower = keyResize(layout, 2, 'left', ctxOf(layout, { cols: 80 }))
    expect(right(narrower) - right(layout)).toBe(-8)
  })

  it('columns 에서 남는 폭을 채우는 pane 은 cell 오른쪽 끝을 옮긴다', () => {
    const layout: Layout = {
      split: 'down',
      first: { split: 'right', first: { pane: 1, cols: 100 }, second: { pane: 2 } },
      second: { pane: 3 }
    }
    expect(keyResize(layout, 3, 'right', ctxOf(layout, { cols: 80 }))).toEqual({
      ...layout,
      first: { ...layout.first, second: { pane: 2, cols: 81 } }
    })
  })

  it('columns 의 좌우는 포커스된 pane 의 열 수를 하나 바꾼다', () => {
    expect(keyResize(ab, 2, 'right', ctxOf(ab, { cols: 80 }))).toEqual({
      ...ab,
      second: { pane: 2, cols: 81 }
    })
    const narrow: Layout = { ...ab, second: { pane: 2, cols: 20 } }
    expect(keyResize(narrow, 2, 'left', ctxOf(narrow, { cols: 80 }))).toEqual(narrow)
  })
})

describe('균등분할', () => {
  it('A | B 경계를 맞추면 A·B 묶음·C 의 몫만 지우고 B1/B2 는 그대로 둔다', () => {
    expect(equalizeLine(grouped, between, 'even', 8)).toEqual({
      split: 'right',
      first: { pane: 1 },
      second: {
        split: 'right',
        first: {
          split: 'down',
          first: { pane: 2, weight: 20 },
          second: { pane: 3, weight: 10 }
        },
        second: { pane: 4 }
      }
    })
  })

  it('B1/B2 경계를 맞추면 그 둘만 지운다', () => {
    const d: Target = { kind: 'line', path: ['second', 'first'], index: 0, split: 'down' }
    expect(equalizeLine(grouped, d, 'even', 8)).toMatchObject({
      first: { weight: 10 },
      second: { first: { first: { pane: 2 }, second: { pane: 3 }, weight: 30 } }
    })
    expect(equalizeLine(grouped, d, 'even', 8)).not.toHaveProperty('second.first.first.weight')
  })

  it('cell 전체를 맞추면 모든 몫을 지운다', () => {
    expect(equalizeAll(grouped, 'even')).toEqual({
      split: 'right',
      first: { pane: 1 },
      second: {
        split: 'right',
        first: { split: 'down', first: { pane: 2 }, second: { pane: 3 } },
        second: { pane: 4 }
      }
    })
  })

  it('columns 에서는 열 수와 위아래 몫을 지우고, single 의 좌우 몫은 남긴다', () => {
    const layout: Layout = {
      split: 'right',
      first: { pane: 1, weight: 3, cols: 100 },
      second: {
        split: 'down',
        first: { pane: 2, weight: 2, cols: 40 },
        second: { pane: 3 },
        weight: 1
      }
    }
    expect(equalizeAll(layout, { cols: 80 })).toEqual({
      split: 'right',
      first: { pane: 1, weight: 3 },
      second: { split: 'down', first: { pane: 2 }, second: { pane: 3 }, weight: 1 }
    })
    expect(equalizeLine(layout, between, { cols: 80 }, 8)).toMatchObject({
      first: { pane: 1, weight: 3 },
      second: { weight: 1, first: { weight: 2 } }
    })
    expect(equalizeLine(layout, between, { cols: 80 }, 8)).not.toHaveProperty('first.cols')
  })

  it('columns 의 cell 오른쪽 끝은 끌 때와 같은 글자 칸 폭으로 그 끝에 닿는 pane 을 찾는다', () => {
    // 글자 칸 4px 에서 위 줄(80열 둘)과 아래 pane(163열)의 오른쪽 끝이 같다.
    const layout: Layout = {
      split: 'down',
      first: { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      second: { pane: 3, cols: 163 }
    }
    expect(equalizeLine(layout, { kind: 'edge', split: 'right' }, { cols: 80 }, 4)).toEqual({
      ...layout,
      second: { pane: 3 }
    })
  })

  it('columns 의 cell 오른쪽 끝은 그 끝이 미는 pane 의 열 수만 지운다', () => {
    const layout: Layout = {
      split: 'right',
      first: { pane: 1, cols: 100 },
      second: { pane: 2, cols: 60 }
    }
    expect(equalizeLine(layout, { kind: 'edge', split: 'right' }, { cols: 80 }, 8)).toEqual({
      split: 'right',
      first: { pane: 1, cols: 100 },
      second: { pane: 2 }
    })
  })
})
