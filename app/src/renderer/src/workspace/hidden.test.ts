import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { mergeVisible, visibleLayout } from './hidden'
import { panes, rects, type Layout, type Rect } from './layout'

const right = (first: Layout, second: Layout, weight?: number): Layout => ({
  split: 'right',
  first,
  second,
  ...(weight !== undefined && { weight })
})
const down = (first: Layout, second: Layout, weight?: number): Layout => ({
  split: 'down',
  first,
  second,
  ...(weight !== undefined && { weight })
})
const leaf = (pane: number, weight?: number): Layout => ({
  pane,
  ...(weight !== undefined && { weight })
})

describe('visibleLayout', () => {
  it('숨긴 pane 이 없으면 그대로다', () => {
    const l = right(leaf(1), leaf(2))
    expect(visibleLayout(l, new Set())).toBe(l)
  })

  it('가운데 pane 을 숨기면 양옆만 남고 몫을 지킨다', () => {
    const l = right(leaf(1, 2), right(leaf(2, 1), leaf(3, 3)))
    expect(visibleLayout(l, new Set([2]))).toEqual(right(leaf(1, 2), leaf(3, 3)))
  })

  it('위아래로 나눈 항목의 한쪽을 숨기면 남은 pane 이 그 항목의 몫을 잇는다', () => {
    const l = right(leaf(1, 1), down(leaf(2, 3), leaf(3, 1), 2))
    expect(visibleLayout(l, new Set([3]))).toEqual(right(leaf(1, 1), leaf(2, 2)))
  })

  it('남은 쪽이 바깥 줄과 같은 방향이면 그 항목들의 몫 합이 사라진 항목의 몫이다', () => {
    const l = right(leaf(1), down(right(leaf(2), leaf(3)), leaf(4)))
    expect(visibleLayout(l, new Set([4]))).toEqual(
      right(leaf(1), right(leaf(2, 0.5), leaf(3, 0.5)))
    )
  })

  it('모두 숨기면 null 이다', () => {
    expect(visibleLayout(right(leaf(1), leaf(2)), new Set([1, 2]))).toBeNull()
  })
})

describe('mergeVisible', () => {
  it('보이는 pane 의 몫을 바꾸면 숨긴 항목의 몫도 같은 비율로 맞춘다', () => {
    const full = right(leaf(1), right(leaf(2), leaf(3)))
    const hidden = new Set([2])
    const shown = right(leaf(1, 3), leaf(3, 1))
    expect(mergeVisible(full, hidden, shown)).toEqual(
      right(leaf(1, 3), right(leaf(2, 2), leaf(3, 1)))
    )
  })

  it('보이는 항목의 몫을 모두 지우면 숨긴 항목의 몫도 지운다', () => {
    const full = right(leaf(1, 2), right(leaf(2, 5), leaf(3, 1)))
    expect(mergeVisible(full, new Set([2]), right(leaf(1), leaf(3)))).toEqual(
      right(leaf(1), right(leaf(2), leaf(3)))
    )
  })

  it('위아래로 나눈 항목의 숨긴 쪽은 그 줄 안의 몫을 지킨다', () => {
    const full = right(leaf(1), down(leaf(2, 3), leaf(3, 1)))
    const merged = mergeVisible(full, new Set([3]), right(leaf(1, 1), leaf(2, 3)))
    expect(merged).toEqual(right(leaf(1, 1), down(leaf(2, 3), leaf(3, 1), 3)))
  })

  it('좌우 줄에서 보이는 pane 의 열 수를 모두 지우면 숨긴 pane 의 열 수도 지운다', () => {
    const full = right({ pane: 1, cols: 90 }, right({ pane: 2, cols: 70 }, leaf(3)))
    expect(mergeVisible(full, new Set([2]), right(leaf(1), leaf(3)))).toEqual(
      right(leaf(1), right(leaf(2), leaf(3)))
    )
  })

  it('보이는 pane 의 열 수를 되쓴다', () => {
    const full = right(leaf(1), right(leaf(2), leaf(3)))
    const merged = mergeVisible(full, new Set([2]), right({ pane: 1, cols: 90 }, leaf(3)))
    expect(merged).toEqual(right({ pane: 1, cols: 90 }, right(leaf(2), leaf(3))))
  })
})

const weightArb = fc.option(
  fc.integer({ min: 1, max: 8 }).map((n) => n / 2),
  { nil: undefined }
)

function layoutArb(n: number): fc.Arbitrary<Layout> {
  const build = (keys: number[]): fc.Arbitrary<Layout> => {
    if (keys.length === 1) return weightArb.map((w) => leaf(keys[0], w))
    return fc
      .tuple(
        fc.integer({ min: 1, max: keys.length - 1 }),
        fc.constantFrom('right', 'down'),
        weightArb
      )
      .chain(([at, split, w]) =>
        fc.tuple(build(keys.slice(0, at)), build(keys.slice(at))).map(([first, second]) => ({
          split: split as 'right' | 'down',
          first,
          second,
          ...(w !== undefined && { weight: w })
        }))
      )
  }
  return build(Array.from({ length: n }, (_, i) => i + 1))
}

const caseArb = fc.integer({ min: 2, max: 7 }).chain((n) =>
  fc.tuple(
    layoutArb(n),
    fc.subarray(
      Array.from({ length: n }, (_, i) => i + 1),
      { minLength: 1, maxLength: n - 1 }
    )
  )
)

function reweigh(layout: Layout, weights: (number | undefined)[]): Layout {
  let i = 0
  const go = (node: Layout): Layout => {
    const w = weights[i++ % weights.length]
    const copy: Layout =
      'pane' in node
        ? { pane: node.pane }
        : { ...node, first: go(node.first), second: go(node.second) }
    if (w !== undefined) copy.weight = w
    else delete copy.weight
    return copy
  }
  return go(layout)
}

function expectSameRects(a: Map<number, Rect>, b: Map<number, Rect>): void {
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort())
  for (const [k, r] of a) {
    const s = b.get(k)!
    for (const f of ['x', 'y', 'w', 'h'] as const) expect(r[f]).toBeCloseTo(s[f], 9)
  }
}

describe('visibleLayout·mergeVisible 의 성질', () => {
  it('바꾸지 않은 투영을 되쓰면 원래 트리다', () => {
    fc.assert(
      fc.property(caseArb, ([full, hidden]) => {
        const h = new Set(hidden)
        expect(mergeVisible(full, h, visibleLayout(full, h)!)).toEqual(full)
      })
    )
  })

  it('되쓴 트리의 투영은 바꾼 투영과 같은 자리에 pane 을 놓는다', () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.array(weightArb, { minLength: 1, maxLength: 9 }),
        ([full, hidden], ws) => {
          const h = new Set(hidden)
          const shown = reweigh(visibleLayout(full, h)!, ws)
          const merged = mergeVisible(full, h, shown)
          expect(panes(merged)).toEqual(panes(full))
          expectSameRects(rects(visibleLayout(merged, h)!), rects(shown))
        }
      )
    )
  })
})
