import { describe, expect, it } from 'vitest'
import {
  columnCount,
  neighbor,
  panes,
  rects,
  removePane,
  splitPane,
  splitRoot,
  type Layout
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
  it('workspace 전체를 나눠 새 pane 을 오른쪽·아래 끝에 둔다', () => {
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
  it('나눈 pane 은 반씩 차지한다', () => {
    expect(rects(threePanes())).toEqual(
      new Map([
        [1, { x: 0, y: 0, w: 0.5, h: 1 }],
        [2, { x: 0.5, y: 0, w: 0.5, h: 0.5 }],
        [3, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }]
      ])
    )
    expect(panes(threePanes())).toEqual([1, 2, 3])
  })

  it('columns 는 좌우로 나눈 폭을 양쪽의 늘어선 pane 수 비율로 나눈다', () => {
    const widths = (layout: Layout) =>
      [...rects(layout, 'columns')].map(([pane, r]) => [
        pane,
        Math.round(r.x * 3),
        Math.round(r.w * 3)
      ])
    const right = splitPane(splitPane({ pane: 1 }, 1, 2, 'right'), 2, 3, 'right')
    expect(widths(right)).toEqual([
      [1, 0, 1],
      [2, 1, 1],
      [3, 2, 1]
    ])
    expect(widths(splitRoot(splitPane({ pane: 1 }, 1, 2, 'right'), 3, 'right'))).toEqual([
      [1, 0, 1],
      [2, 1, 1],
      [3, 2, 1]
    ])
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

  it('columns 에서는 늘어선 pane 수 비율로 그린 자리에서 이웃을 찾는다', () => {
    // 위 1 | 2, 아래 3 | 4 | 5 — columns 에서 2 는 아래 4·5 위에 걸치고, 5 와 더 길게 맞닿는다.
    const layout: Layout = {
      split: 'down',
      first: { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      second: {
        split: 'right',
        first: { pane: 3 },
        second: { split: 'right', first: { pane: 4 }, second: { pane: 5 } }
      }
    }
    expect(neighbor(layout, 2, 'down')).toBe(4)
    expect(neighbor(layout, 2, 'down', 'columns')).toBe(5)
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
