import { describe, expect, it } from 'vitest'
import { neighbor, panes, rects, removePane, splitPane, type Layout } from './layout'

function threePanes(): Layout {
  return splitPane(splitPane({ pane: 1 }, 1, 2, 'right'), 2, 3, 'down')
}

describe('splitPane', () => {
  it('대상 칸만 나누고 새 칸을 오른쪽·아래에 둔다', () => {
    expect(threePanes()).toEqual({
      split: 'right',
      first: { pane: 1 },
      second: { split: 'down', first: { pane: 2 }, second: { pane: 3 } }
    })
  })

  it('없는 칸을 나누면 그대로다', () => {
    expect(splitPane({ pane: 1 }, 9, 2, 'right')).toEqual({ pane: 1 })
  })
})

describe('removePane', () => {
  it('마지막 칸이면 null 이다', () => {
    expect(removePane({ pane: 1 }, 1)).toBeNull()
  })

  it('형제가 자리를 채우고, next 는 그 형제의 첫 칸이다', () => {
    expect(removePane(threePanes(), 1)).toEqual({
      layout: { split: 'down', first: { pane: 2 }, second: { pane: 3 } },
      next: 2
    })
    expect(removePane(threePanes(), 3)).toEqual({
      layout: { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      next: 2
    })
  })

  it('없는 칸이면 null 이다', () => {
    expect(removePane(threePanes(), 9)).toBeNull()
  })
})

describe('rects', () => {
  it('나눈 칸은 반씩 차지한다', () => {
    expect(rects(threePanes())).toEqual(
      new Map([
        [1, { x: 0, y: 0, w: 0.5, h: 1 }],
        [2, { x: 0.5, y: 0, w: 0.5, h: 0.5 }],
        [3, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }]
      ])
    )
    expect(panes(threePanes())).toEqual([1, 2, 3])
  })
})

describe('neighbor', () => {
  it('그 방향으로 맞닿은 칸으로 간다', () => {
    const layout = threePanes()
    expect(neighbor(layout, 2, 'down')).toBe(3)
    expect(neighbor(layout, 3, 'up')).toBe(2)
    expect(neighbor(layout, 2, 'left')).toBe(1)
    expect(neighbor(layout, 3, 'left')).toBe(1)
  })

  it('맞닿은 칸이 여럿이고 길이가 같으면 panes 순서에서 앞선 칸이다', () => {
    expect(neighbor(threePanes(), 1, 'right')).toBe(2)
  })

  it('가장 길게 맞닿은 칸으로 간다', () => {
    let layout = splitPane({ pane: 1 }, 1, 2, 'right')
    layout = splitPane(layout, 1, 3, 'down')
    layout = splitPane(layout, 3, 4, 'right')
    expect(neighbor(layout, 2, 'left')).toBe(1)
    expect(neighbor(layout, 1, 'down')).toBe(3)
    expect(neighbor(layout, 4, 'up')).toBe(1)
  })

  it('그 방향에 칸이 없거나 모서리만 닿으면 undefined 다', () => {
    const layout = threePanes()
    expect(neighbor(layout, 1, 'left')).toBeUndefined()
    expect(neighbor(layout, 1, 'up')).toBeUndefined()
    expect(neighbor(layout, 2, 'right')).toBeUndefined()
    expect(neighbor({ pane: 1 }, 1, 'down')).toBeUndefined()
    expect(neighbor(layout, 9, 'down')).toBeUndefined()
  })
})
