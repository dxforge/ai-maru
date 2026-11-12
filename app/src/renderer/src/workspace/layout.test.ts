import { describe, expect, it } from 'vitest'
import {
  naturalCols,
  edgesOf,
  neighbor,
  panes,
  rects,
  removePane,
  sameShape,
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
    for (const widths of ['even', { cols: 80 }] as const) {
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
    expect(thirds(right, { cols: 80 }, 'x')).toEqual(evenly)
    const full = splitRoot(splitPane({ pane: 1 }, 1, 2, 'right'), 3, 'right')
    expect(thirds(full, { cols: 80 }, 'x')).toEqual(evenly)
  })

  it('columns 에서 위아래 두 쪽의 늘어선 pane 수가 다르면 적은 쪽 pane 이 넓어진다', () => {
    const layout = splitPane(threePanes(), 3, 4, 'right')
    const all = rects(layout, { cols: 80 })
    expect(all.get(1)!.w * 3).toBeCloseTo(1)
    expect(all.get(2)).toMatchObject({ y: 0, h: 0.5 })
    expect(all.get(2)!.x * 3).toBeCloseTo(1)
    expect(all.get(2)!.w * 3).toBeCloseTo(2)
    expect(all.get(3)!.w * 3).toBeCloseTo(1)
    expect(all.get(4)!.x * 3).toBeCloseTo(2)
    expect(all.get(4)!.w * 3).toBeCloseTo(1)
  })
})

describe('edgesOf', () => {
  it('3×3 으로 나눈 pane 마다 cell 의 어느 가장자리에 닿는지 가린다', () => {
    const column = (top: number): Layout =>
      splitPane(splitPane({ pane: top }, top, top + 1, 'down'), top + 1, top + 2, 'down')
    const layout: Layout = {
      split: 'right',
      first: column(1),
      second: { split: 'right', first: column(4), second: column(7) }
    }
    const touched = [...rects(layout)].map(([pane, r]) => {
      const e = edgesOf(r)
      return [pane, `${+e.left}${+e.top}${+e.right}${+e.bottom}`]
    })
    expect(touched).toEqual([
      [1, '1100'],
      [2, '1000'],
      [3, '1001'],
      [4, '0100'],
      [5, '0000'],
      [6, '0001'],
      [7, '0110'],
      [8, '0010'],
      [9, '0011']
    ])
  })

  it('나누지 않은 pane 은 네 가장자리에 모두 닿는다', () => {
    expect(edgesOf(rects({ pane: 1 }).get(1)!)).toEqual({
      left: true,
      top: true,
      right: true,
      bottom: true
    })
  })
})

describe('naturalCols', () => {
  it('좌우로 나누면 양쪽을 더하고, 위아래로 나누면 큰 쪽을 쓴다', () => {
    expect(naturalCols({ pane: 1 }, 1)).toBe(1)
    expect(naturalCols(threePanes(), 1)).toBe(2)
    expect(naturalCols(splitPane(threePanes(), 3, 4, 'right'), 1)).toBe(3)
    expect(naturalCols(splitPane({ pane: 1 }, 1, 2, 'down'), 1)).toBe(1)
  })

  it('고르지 않게 나눠도 늘어선 pane 수다', () => {
    const layout = splitPane(splitPane({ pane: 1 }, 1, 2, 'right'), 2, 3, 'right')
    expect(naturalCols(layout, 1)).toBe(3)
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
    expect(neighbor(layout, 2, 'down', { cols: 80 })).toBe(6)
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

describe('크기 필드와 split·닫기', () => {
  const sized: Layout = {
    split: 'right',
    first: { pane: 1, weight: 3, cols: 100 },
    second: { pane: 2, weight: 1, cols: 40 }
  }

  it('다른 방향으로 나누면 새 나눔 노드가 그 pane 의 몫을 잇고, 줄은 그대로다', () => {
    expect(splitPane(sized, 2, 3, 'down')).toEqual({
      split: 'right',
      first: { pane: 1, weight: 3, cols: 100 },
      second: { split: 'down', first: { pane: 2, cols: 40 }, second: { pane: 3 }, weight: 1 }
    })
  })

  it('같은 방향으로 나누면 그 줄의 몫과 열 수를 지운다', () => {
    expect(splitPane(sized, 2, 3, 'right')).toEqual({
      split: 'right',
      first: { pane: 1 },
      second: { split: 'right', first: { pane: 2 }, second: { pane: 3 } }
    })
    expect(splitRoot(sized, 3, 'right')).toEqual({
      split: 'right',
      first: { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      second: { pane: 3 }
    })
  })

  it('좌우 줄에 pane 이 늘거나 줄면 항목 안 위아래 묶음의 열 수도 지운다', () => {
    const grouped: Layout = {
      split: 'right',
      first: { pane: 1 },
      second: { split: 'down', first: { pane: 2, cols: 120, weight: 2 }, second: { pane: 3 } }
    }
    const bare = { split: 'down', first: { pane: 2, weight: 2 }, second: { pane: 3 } }
    const groupOf = (l: Layout): Layout => {
      if ('pane' in l) throw new Error('pane')
      return 'pane' in l.second
        ? groupOf(l.first)
        : l.second.split === 'down'
          ? l.second
          : groupOf(l.second)
    }
    expect(groupOf(splitPane(grouped, 1, 4, 'right'))).toEqual(bare)
    expect(groupOf(splitRoot(grouped, 4, 'right'))).toEqual(bare)
    const wider: Layout = {
      ...grouped,
      first: { split: 'right', first: { pane: 1 }, second: { pane: 5 } }
    }
    expect(groupOf(removePane(wider, 5)!.layout)).toEqual(bare)
    expect(splitRoot(grouped, 4, 'right')).toMatchObject({ first: { second: bare } })
    expect(
      removePane(
        { ...grouped, first: { split: 'right', first: { pane: 1 }, second: { pane: 5 } } },
        5
      )!.layout
    ).toMatchObject({ second: bare })
  })

  it('줄 안쪽의 다른 방향 나눔과 바깥 줄은 그대로 둔다', () => {
    const layout: Layout = {
      split: 'right',
      first: { pane: 1, weight: 2 },
      second: {
        split: 'down',
        first: { pane: 2, weight: 3 },
        second: { pane: 3, weight: 1 },
        weight: 1
      }
    }
    expect(splitPane(layout, 2, 4, 'down')).toEqual({
      split: 'right',
      first: { pane: 1, weight: 2 },
      second: {
        split: 'down',
        first: { split: 'down', first: { pane: 2 }, second: { pane: 4 } },
        second: { pane: 3 },
        weight: 1
      }
    })
  })

  it('root 를 다른 방향으로 나누면 크기가 그대로다', () => {
    expect(splitRoot(sized, 3, 'down')).toEqual({
      split: 'down',
      first: sized,
      second: { pane: 3 }
    })
  })

  it('A | (B / C) 에서 B 를 닫으면 C 가 그 자리의 몫을 잇는다', () => {
    const layout: Layout = {
      split: 'right',
      first: { pane: 1, weight: 2 },
      second: { split: 'down', first: { pane: 2 }, second: { pane: 3, weight: 5 }, weight: 1 }
    }
    expect(removePane(layout, 2)!.layout).toEqual({
      split: 'right',
      first: { pane: 1, weight: 2 },
      second: { pane: 3, weight: 1 }
    })
  })

  it('A | (B / (C | D)) 에서 B 를 닫으면 A | C | D 한 줄이 되어 몫을 지운다', () => {
    const layout: Layout = {
      split: 'right',
      first: { pane: 1, weight: 2, cols: 90 },
      second: {
        split: 'down',
        first: { pane: 2 },
        second: {
          split: 'right',
          first: { pane: 3, weight: 3 },
          second: { pane: 4, weight: 1, cols: 30 }
        },
        weight: 1
      }
    }
    expect(removePane(layout, 2)!.layout).toEqual({
      split: 'right',
      first: { pane: 1 },
      second: { split: 'right', first: { pane: 3 }, second: { pane: 4 } }
    })
  })

  it('A | B | C 에서 B 를 닫으면 그 줄을 지우고, 줄이 든 바깥 줄은 그대로다', () => {
    const layout: Layout = {
      split: 'down',
      first: {
        split: 'right',
        first: { pane: 1, weight: 2 },
        second: { split: 'right', first: { pane: 2 }, second: { pane: 3, weight: 4 } },
        weight: 3
      },
      second: { pane: 4, weight: 1 }
    }
    expect(removePane(layout, 2)!.layout).toEqual({
      split: 'down',
      first: { split: 'right', first: { pane: 1 }, second: { pane: 3 }, weight: 3 },
      second: { pane: 4, weight: 1 }
    })
  })

  it('남은 pane 이 root 가 되면 몫이 없다', () => {
    expect(removePane(sized, 2)!.layout).toEqual({ pane: 1, cols: 100 })
  })

  it('sameShape 는 크기 필드를 보지 않는다', () => {
    expect(sameShape(sized, { split: 'right', first: { pane: 1 }, second: { pane: 2 } })).toBe(true)
    expect(sameShape(sized, { split: 'down', first: { pane: 1 }, second: { pane: 2 } })).toBe(false)
  })
})
