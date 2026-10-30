import { describe, expect, it } from 'vitest'
import {
  columnCount,
  neighbor,
  panes,
  readingOrder,
  rects,
  removePane,
  splitPane,
  splitRoot,
  type Layout,
  type Widths
} from './layout'

function threePanes(): Layout {
  return splitPane(splitPane({ pane: 1 }, 1, 2, 'right'), 2, 3, 'down')
}

describe('splitPane', () => {
  it('대상 pane 만 나누고 새 pane 을 오른쪽·아래에 둔다', () => {
    expect(threePanes()).toEqual({
      split: 'right',
      first: { pane: 1 },
      second: { split: 'down', first: { pane: 2 }, second: { pane: 3 } }
    })
  })

  it('없는 pane 을 나누면 그대로다', () => {
    expect(splitPane({ pane: 1 }, 9, 2, 'right')).toEqual({ pane: 1 })
  })
})

describe('splitRoot', () => {
  it('cell 전체를 나눠 새 pane 을 오른쪽·아래 끝에 둔다', () => {
    expect(splitRoot({ pane: 1 }, 2, 'right')).toEqual(splitPane({ pane: 1 }, 1, 2, 'right'))
    expect(splitRoot(threePanes(), 4, 'down')).toEqual({
      split: 'down',
      first: threePanes(),
      second: { pane: 4 }
    })
  })
})

describe('removePane', () => {
  it('마지막 pane 이면 null 이다', () => {
    expect(removePane({ pane: 1 }, 1)).toBeNull()
  })

  it('형제가 자리를 채우고, next 는 그 형제의 첫 pane 이다', () => {
    expect(removePane(threePanes(), 1)).toEqual({
      layout: { split: 'down', first: { pane: 2 }, second: { pane: 3 } },
      next: 2
    })
    expect(removePane(threePanes(), 3)).toEqual({
      layout: { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      next: 2
    })
  })

  it('없는 pane 이면 null 이다', () => {
    expect(removePane(threePanes(), 9)).toBeNull()
  })
})

describe('rects', () => {
  const thirds = (layout: Layout, widths: Widths, axis: 'x' | 'y') => {
    const [at, length] = axis === 'x' ? (['x', 'w'] as const) : (['y', 'h'] as const)
    return [...rects(layout, widths)].map(([pane, r]) => [
      pane,
      Math.round(r[at] * 3 * 1e6) / 1e6,
      Math.round(r[length] * 3 * 1e6) / 1e6
    ])
  }
  const evenly = [
    [1, 0, 1],
    [2, 1, 1],
    [3, 2, 1]
  ]

  it('격자가 아니면 같은 방향으로 늘어선 pane 끼리 고르게 나눈다', () => {
    expect(rects(threePanes())).toEqual(
      new Map([
        [1, { x: 0, y: 0, w: 0.5, h: 1 }],
        [2, { x: 0.5, y: 0, w: 0.5, h: 0.5 }],
        [3, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }]
      ])
    )
    expect(panes(threePanes())).toEqual([1, 2, 3])
  })

  it('아래로 나누면 위아래로 늘어선 pane 들의 높이가 같다', () => {
    const full = splitRoot(splitRoot({ pane: 1 }, 2, 'down'), 3, 'down')
    const below = splitPane(splitPane({ pane: 1 }, 1, 2, 'down'), 2, 3, 'down')
    const above = splitPane(splitPane({ pane: 1 }, 1, 2, 'down'), 1, 3, 'down')
    for (const widths of ['even', 'columns'] as const) {
      expect(thirds(full, widths, 'y')).toEqual(evenly)
      expect(thirds(below, widths, 'y')).toEqual(evenly)
      expect(thirds(above, widths, 'y')).toEqual([
        [1, 0, 1],
        [3, 1, 1],
        [2, 2, 1]
      ])
    }
  })

  it('single 에서 오른쪽으로 나누면 좌우로 늘어선 pane 들의 폭이 같다', () => {
    const full = splitRoot(splitRoot({ pane: 1 }, 2, 'right'), 3, 'right')
    const after = splitPane(splitPane({ pane: 1 }, 1, 2, 'right'), 2, 3, 'right')
    expect(thirds(full, 'even', 'x')).toEqual(evenly)
    expect(thirds(after, 'even', 'x')).toEqual(evenly)
  })

  it('다른 방향으로 나눈 부분은 늘어선 pane 하나로 센다', () => {
    const layout: Layout = {
      split: 'down',
      first: { pane: 1 },
      second: {
        split: 'right',
        first: { pane: 2 },
        second: { split: 'down', first: { pane: 3 }, second: { pane: 4 } }
      }
    }
    expect(rects(layout, 'even')).toEqual(
      new Map([
        [1, { x: 0, y: 0, w: 1, h: 0.5 }],
        [2, { x: 0, y: 0.5, w: 0.5, h: 0.5 }],
        [3, { x: 0.5, y: 0.5, w: 0.5, h: 0.25 }],
        [4, { x: 0.5, y: 0.75, w: 0.5, h: 0.25 }]
      ])
    )
  })

  it('pane 을 닫으면 남은 pane 들의 크기를 같은 규칙으로 맞춘다', () => {
    const four = splitRoot(splitRoot(splitRoot({ pane: 1 }, 2, 'down'), 3, 'down'), 4, 'down')
    const { layout } = removePane(four, 2)!
    expect(thirds(layout, 'even', 'y')).toEqual([
      [1, 0, 1],
      [3, 1, 1],
      [4, 2, 1]
    ])
    const right = splitPane(
      splitPane(splitPane({ pane: 1 }, 1, 2, 'right'), 2, 3, 'right'),
      3,
      4,
      'right'
    )
    expect(thirds(removePane(right, 3)!.layout, 'even', 'x')).toEqual([
      [1, 0, 1],
      [2, 1, 1],
      [4, 2, 1]
    ])
  })

  it('columns 는 좌우로 나눈 폭을 양쪽의 늘어선 pane 수 비율로 나눈다', () => {
    const right = splitPane(splitPane({ pane: 1 }, 1, 2, 'right'), 2, 3, 'right')
    expect(thirds(right, 'columns', 'x')).toEqual(evenly)
    const full = splitRoot(splitPane({ pane: 1 }, 1, 2, 'right'), 3, 'right')
    expect(thirds(full, 'columns', 'x')).toEqual(evenly)
  })

  it('columns 에서 위아래 두 쪽의 늘어선 pane 수가 다르면 적은 쪽 pane 이 넓어진다', () => {
    const layout = splitPane(threePanes(), 3, 4, 'right')
    const all = rects(layout, 'columns')
    expect(all.get(1)!.w * 3).toBeCloseTo(1)
    expect(all.get(2)).toMatchObject({ y: 0, h: 0.5 })
    expect(all.get(2)!.x * 3).toBeCloseTo(1)
    expect(all.get(2)!.w * 3).toBeCloseTo(2)
    expect(all.get(3)!.w * 3).toBeCloseTo(1)
    expect(all.get(4)!.x * 3).toBeCloseTo(2)
    expect(all.get(4)!.w * 3).toBeCloseTo(1)
  })
})

describe('columnCount', () => {
  it('좌우로 나누면 양쪽을 더하고, 위아래로 나누면 큰 쪽을 쓴다', () => {
    expect(columnCount({ pane: 1 })).toBe(1)
    expect(columnCount(threePanes())).toBe(2)
    expect(columnCount(splitPane(threePanes(), 3, 4, 'right'))).toBe(3)
    expect(columnCount(splitPane({ pane: 1 }, 1, 2, 'down'))).toBe(1)
  })

  it('고르지 않게 나눠도 늘어선 pane 수다', () => {
    const layout = splitPane(splitPane({ pane: 1 }, 1, 2, 'right'), 2, 3, 'right')
    expect(columnCount(layout)).toBe(3)
  })
})

describe('neighbor', () => {
  it('그 방향으로 맞닿은 pane 으로 간다', () => {
    const layout = threePanes()
    expect(neighbor(layout, 2, 'down')).toBe(3)
    expect(neighbor(layout, 3, 'up')).toBe(2)
    expect(neighbor(layout, 2, 'left')).toBe(1)
    expect(neighbor(layout, 3, 'left')).toBe(1)
  })

  it('맞닿은 pane 이 여럿이고 길이가 같으면 panes 순서에서 앞선 pane 이다', () => {
    expect(neighbor(threePanes(), 1, 'right')).toBe(2)
  })

  it('가장 길게 맞닿은 pane 으로 간다', () => {
    let layout = splitPane({ pane: 1 }, 1, 2, 'right')
    layout = splitPane(layout, 1, 3, 'down')
    layout = splitPane(layout, 3, 4, 'right')
    expect(neighbor(layout, 2, 'left')).toBe(1)
    expect(neighbor(layout, 1, 'down')).toBe(3)
    expect(neighbor(layout, 4, 'up')).toBe(1)
  })

  it('그린 자리에서 이웃을 찾으므로 columns 와 single 에서 이웃이 다를 수 있다', () => {
    // 위 1 | 2 | 3 | 4, 아래 5 | (6 위, 7 | 8 아래). single 에서 아래 5 는 폭의 반이라 2 아래를 덮는다. columns 에서
    // 아래는 column 4 개 가운데 5 가 4/3 개, 나머지가 8/3 개를 받으므로 2 는 6 과 더 길게 맞닿는다.
    const row = (...ps: number[]): Layout =>
      ps.length === 1
        ? { pane: ps[0] }
        : { split: 'right', first: { pane: ps[0] }, second: row(...ps.slice(1)) }
    const layout: Layout = {
      split: 'down',
      first: row(1, 2, 3, 4),
      second: {
        split: 'right',
        first: { pane: 5 },
        second: { split: 'down', first: { pane: 6 }, second: row(7, 8) }
      }
    }
    expect(neighbor(layout, 2, 'down')).toBe(5)
    expect(neighbor(layout, 2, 'down', 'columns')).toBe(6)
  })

  it('그 방향에 pane 이 없거나 모서리만 닿으면 undefined 다', () => {
    const layout = threePanes()
    expect(neighbor(layout, 1, 'left')).toBeUndefined()
    expect(neighbor(layout, 1, 'up')).toBeUndefined()
    expect(neighbor(layout, 2, 'right')).toBeUndefined()
    expect(neighbor({ pane: 1 }, 1, 'down')).toBeUndefined()
    expect(neighbor(layout, 9, 'down')).toBeUndefined()
  })
})

describe('readingOrder', () => {
  it('pane 이 하나면 그것만 준다', () => {
    expect(readingOrder({ pane: 1 })).toEqual([1])
  })

  it('위 줄을 왼쪽에서 오른쪽으로 읽은 뒤 아래 줄로 간다', () => {
    expect(readingOrder(threePanes())).toEqual([1, 2, 3])
    const twoRows: Layout = {
      split: 'down',
      first: { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      second: { pane: 3 }
    }
    expect(readingOrder(twoRows)).toEqual([1, 2, 3])
  })

  it('왼쪽 column 을 아래로 나눴어도 위 변이 같은 오른쪽 pane 을 아래 pane 보다 먼저 준다', () => {
    let layout = splitPane({ pane: 1 }, 1, 2, 'right')
    layout = splitPane(layout, 1, 3, 'down')
    expect(panes(layout)).toEqual([1, 3, 2])
    expect(readingOrder(layout)).toEqual([1, 2, 3])
  })

  it('양쪽 column 의 줄 높이가 달라도 위 변의 높이 순서로 준다', () => {
    // 왼쪽 1·2 는 위 변이 0·1/2, 오른쪽 3·4·5 는 0·1/3·2/3 이다.
    const layout: Layout = {
      split: 'right',
      first: { split: 'down', first: { pane: 1 }, second: { pane: 2 } },
      second: {
        split: 'down',
        first: { pane: 3 },
        second: { split: 'down', first: { pane: 4 }, second: { pane: 5 } }
      }
    }
    expect(readingOrder(layout)).toEqual([1, 3, 4, 2, 5])
  })
})
