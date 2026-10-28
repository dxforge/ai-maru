import { describe, expect, it } from 'vitest'
import { canSplit, NO_MIN, overflow, required, snapRects, type Size } from './grid'
import { splitPane, splitRoot, type Layout } from './layout'

const cell = { width: 8, height: 18 }

describe('snapRects', () => {
  it('pane 하나는 cell 을 그대로 채운다', () => {
    expect(snapRects({ pane: 1 }, { width: 805, height: 700 }, cell).get(1)).toEqual({
      left: 0,
      top: 0,
      width: 805,
      height: 700
    })
  })

  it('나눈 경계는 글자 칸의 배수에 두고, 남는 픽셀은 맨 오른쪽·맨 아래 pane 이 갖는다', () => {
    const layout: Layout = {
      split: 'right',
      first: { pane: 1 },
      second: { split: 'down', first: { pane: 2 }, second: { pane: 3 } }
    }
    const boxes = snapRects(layout, { width: 1003, height: 700 }, cell)
    expect(boxes.get(1)).toEqual({ left: 0, top: 0, width: 504, height: 700 })
    expect(boxes.get(2)).toEqual({ left: 504, top: 0, width: 499, height: 342 })
    expect(boxes.get(3)).toEqual({ left: 504, top: 342, width: 499, height: 358 })
  })

  it('글자 칸 크기가 소수여도 경계는 그 배수다', () => {
    const boxes = snapRects(
      { split: 'down', first: { pane: 1 }, second: { pane: 2 } },
      { width: 800, height: 600 },
      { width: 7.8, height: 17.5 }
    )
    expect(boxes.get(2)!.top).toBe(17 * 17.5)
    expect(boxes.get(1)!.height).toBe(17 * 17.5)
  })

  it('pane 이 반 글자 칸보다 작아져도 상자는 음수가 되지 않고 빈틈 없이 cell 을 채운다', () => {
    const chain = (i: number): Layout =>
      i === 8 ? { pane: i } : { split: 'down', first: { pane: i }, second: chain(i + 1) }
    const boxes = [...snapRects(chain(0), { width: 800, height: 300 }, cell).values()].sort(
      (a, b) => a.top - b.top
    )
    expect(boxes.every((b) => b.height >= 0)).toBe(true)
    boxes.slice(1).forEach((b, i) => expect(b.top).toBe(boxes[i].top + boxes[i].height))
    expect(boxes.at(-1)!.top + boxes.at(-1)!.height).toBe(300)
  })

  it('글자 칸 크기를 모르면 px 로만 반올림한다', () => {
    const boxes = snapRects(
      { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      { width: 801, height: 600 },
      { width: 0, height: 0 }
    )
    expect(boxes.get(2)).toEqual({ left: 401, top: 0, width: 400, height: 600 })
  })

  it('columns 는 늘어선 pane 마다 같은 글자 칸 수를 준다', () => {
    const layout: Layout = {
      split: 'right',
      first: { pane: 1 },
      second: { split: 'right', first: { pane: 2 }, second: { pane: 3 } }
    }
    const boxes = snapRects(
      layout,
      { width: 3 * 82 * 9, height: 700 },
      { width: 9, height: 18 },
      'columns'
    )
    expect([...boxes.values()].map((b) => [b.left, b.width])).toEqual([
      [0, 82 * 9],
      [82 * 9, 82 * 9],
      [2 * 82 * 9, 82 * 9]
    ])
  })

  it('columns 에서 폭의 단위를 pane 하나의 폭으로 주면 좌우 경계를 그 배수에 두고, 높이는 글자 칸 배수에 둔다', () => {
    const pane = 80 * 7.82666 + 12
    const layout: Layout = {
      split: 'right',
      first: { pane: 1 },
      second: {
        split: 'down',
        first: { pane: 2 },
        second: { split: 'right', first: { pane: 3 }, second: { pane: 4 } }
      }
    }
    const boxes = snapRects(
      layout,
      { width: 3 * pane, height: 700 },
      { width: pane, height: 18 },
      'columns',
      { width: pane, height: 6 * 18 }
    )
    expect(boxes.get(1)).toMatchObject({ left: 0, width: pane })
    expect(boxes.get(2)).toMatchObject({ left: pane, width: 2 * pane, height: 19 * 18 })
    expect(boxes.get(3)).toMatchObject({ left: pane, width: pane, top: 19 * 18 })
    expect(boxes.get(4)!.left).toBeCloseTo(2 * pane)
    expect(boxes.get(4)!.width).toBeCloseTo(pane)
  })

  describe('하한', () => {
    const min = { width: 23 * 8, height: 6 * 18 }
    const twoRight: Layout = { split: 'right', first: { pane: 1 }, second: { pane: 2 } }
    const twoThree: Layout = { split: 'right', first: { pane: 2 }, second: { pane: 3 } }
    const threeRight: Layout = { split: 'right', first: { pane: 1 }, second: twoThree }
    const twoDown: Layout = { split: 'down', first: { pane: 1 }, second: { pane: 2 } }
    const threeDown: Layout = {
      split: 'down',
      first: { pane: 1 },
      second: { split: 'down', first: { pane: 2 }, second: { pane: 3 } }
    }

    it('pane 하나는 cell 이 하한보다 작아도 하한 크기다', () => {
      expect(snapRects({ pane: 1 }, { width: 100, height: 50 }, cell, 'half', min).get(1)).toEqual({
        left: 0,
        top: 0,
        width: 23 * 8,
        height: 6 * 18
      })
    })

    it('반으로 나누면 한쪽이 하한 아래가 될 때 그쪽에 하한을 주고 나머지를 다른 쪽이 갖는다', () => {
      const boxes = snapRects(threeRight, { width: 70 * 8, height: 700 }, cell, 'half', min)
      expect([...boxes.values()].map((b) => [b.left / 8, b.width / 8])).toEqual([
        [0, 24],
        [24, 23],
        [47, 23]
      ])
      const stacked = snapRects(threeDown, { width: 800, height: 20 * 18 }, cell, 'half', min)
      expect([...stacked.values()].map((b) => [b.top / 18, b.height / 18])).toEqual([
        [0, 8],
        [8, 6],
        [14, 6]
      ])
    })

    it('양쪽에 하한을 줄 자리가 없으면 각자 하한을 받고 뒤쪽이 cell 밖으로 나간다', () => {
      const boxes = snapRects(threeRight, { width: 40 * 8, height: 700 }, cell, 'half', min)
      expect([...boxes.values()].map((b) => [b.left / 8, b.width / 8])).toEqual([
        [0, 23],
        [23, 23],
        [46, 23]
      ])
      const stacked = snapRects(twoDown, { width: 800, height: 5 * 18 }, cell, 'half', min)
      expect(stacked.get(1)).toEqual({ left: 0, top: 0, width: 800, height: 6 * 18 })
      expect(stacked.get(2)).toEqual({ left: 0, top: 6 * 18, width: 800, height: 6 * 18 })
    })

    it('자리가 넉넉하면 하한이 경계를 바꾸지 않는다', () => {
      const size = { width: 1003, height: 700 }
      expect(snapRects(twoRight, size, cell, 'half', min)).toEqual(snapRects(twoRight, size, cell))
    })

    describe('required', () => {
      it('좌우는 폭을 더하고 높이는 큰 쪽, 위아래는 반대다', () => {
        expect(required(threeRight, min)).toEqual({ width: 3 * 23 * 8, height: 6 * 18 })
        expect(required({ split: 'down', first: threeRight, second: { pane: 4 } }, min)).toEqual({
          width: 3 * 23 * 8,
          height: 12 * 18
        })
      })
    })

    describe('overflow', () => {
      it('필요한 크기에서 cell 크기를 뺀 만큼이고, 들어가면 0 이다', () => {
        expect(overflow(threeRight, { width: 40 * 8, height: 700 }, min)).toEqual({
          width: 29 * 8,
          height: 0
        })
        expect(overflow(threeRight, { width: 69 * 8, height: 6 * 18 }, min)).toEqual(NO_MIN)
      })
    })

    describe('canSplit', () => {
      const size = (w: number, h = 700) => ({ width: w * 8, height: h })
      const split = (layout: Layout, target: number | null, dir: 'right' | 'down', area: Size) =>
        canSplit(
          layout,
          area,
          target === null ? splitRoot(layout, 9, dir) : splitPane(layout, target, 9, dir),
          area,
          min
        )

      it('나눈 뒤 pane 들이 필요한 크기가 cell 에 들어가면 나눌 수 있고, 한 글자 칸이라도 모자라면 없다', () => {
        expect(split({ pane: 1 }, 1, 'right', size(46))).toBe(true)
        expect(split({ pane: 1 }, 1, 'right', size(45))).toBe(false)
        expect(split({ pane: 1 }, 1, 'down', size(100, 12 * 18))).toBe(true)
        expect(split({ pane: 1 }, 1, 'down', size(100, 12 * 18 - 1))).toBe(false)
      })

      it('형제 pane 이 내줄 수 있는 자리까지 센다', () => {
        expect(split(twoRight, 2, 'right', size(69))).toBe(true)
        expect(split(twoRight, 2, 'right', size(68))).toBe(false)
        expect(split(twoDown, 2, 'down', size(100, 18 * 18))).toBe(true)
        expect(split(twoDown, 2, 'down', size(100, 18 * 18 - 1))).toBe(false)
      })

      it('cell 전체를 나누면 있던 pane 들이 필요한 크기와 새 pane 의 하한이 들어가야 한다', () => {
        expect(split(threeRight, null, 'right', size(92))).toBe(true)
        expect(split(threeRight, null, 'right', size(91))).toBe(false)
        expect(split(threeRight, null, 'down', size(69, 12 * 18))).toBe(true)
        expect(split(threeRight, null, 'down', size(69, 12 * 18 - 1))).toBe(false)
      })

      it('나눈 뒤 넓어지는 cell(columns)을 주면 폭은 넘치지 않는다', () => {
        const next = splitPane({ pane: 1 }, 1, 9, 'right')
        expect(canSplit({ pane: 1 }, size(23), next, size(46), min)).toBe(true)
        expect(canSplit({ pane: 1 }, size(23, 6 * 18), next, size(46, 6 * 18 - 1), min)).toBe(false)
      })

      it('이미 넘친 cell 에서도 넘침이 늘지 않는 split 은 된다', () => {
        expect(split(threeRight, 3, 'right', size(40))).toBe(false)
        expect(split(threeRight, 3, 'down', size(40, 12 * 18))).toBe(true)
        expect(split(threeRight, null, 'down', size(40, 12 * 18))).toBe(true)
      })

      it('하한이 0 이면(글자 칸 크기를 모르면) 늘 나눌 수 있다', () => {
        const next = splitPane({ pane: 1 }, 1, 9, 'right')
        expect(canSplit({ pane: 1 }, size(1, 1), next, size(1, 1), NO_MIN)).toBe(true)
      })
    })
  })
})
