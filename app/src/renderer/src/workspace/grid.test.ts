import { describe, expect, it } from 'vitest'
import {
  areaOf,
  canSplit,
  columnsWidthOf,
  NO_MIN,
  overflow,
  paneMin,
  required,
  roomForSplit,
  snapRects,
  type Box,
  type Size
} from './grid'
import { panes, splitPane, splitRoot, type Layout } from './layout'

const cell = { width: 8, height: 18 }
const twoRight: Layout = { split: 'right', first: { pane: 1 }, second: { pane: 2 } }
const twoThree: Layout = { split: 'right', first: { pane: 2 }, second: { pane: 3 } }

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

  it('같은 방향으로 늘어선 pane 마다 같은 글자 칸 수를 준다', () => {
    const down: Layout = {
      split: 'down',
      first: { split: 'down', first: { pane: 1 }, second: { pane: 2 } },
      second: { pane: 3 }
    }
    const right: Layout = {
      split: 'right',
      first: { pane: 1 },
      second: { split: 'right', first: { pane: 2 }, second: { pane: 3 } }
    }
    const rows = (boxes: Map<number, Box>) =>
      [...boxes.values()].map((b) => [b.top / 18, b.height / 18])
    const thirds = [
      [0, 10],
      [10, 10],
      [20, 10]
    ]
    expect(rows(snapRects(down, { width: 800, height: 30 * 18 }, cell))).toEqual(thirds)
    const column = { width: 82 * 9, height: 18 }
    expect(rows(snapRects(down, { width: 82 * 9, height: 30 * 18 }, column, 'columns'))).toEqual(
      thirds
    )
    const side = snapRects(right, { width: 60 * 8, height: 700 }, cell)
    expect([...side.values()].map((b) => [b.left / 8, b.width / 8])).toEqual([
      [0, 20],
      [20, 20],
      [40, 20]
    ])
  })

  it('나누어떨어지지 않는 글자 칸은 나눔 트리 모양과 상관없이 같은 pane 이 받는다', () => {
    const nested: Layout = { split: 'right', first: { pane: 1 }, second: twoThree }
    const grouped: Layout = { split: 'right', first: twoRight, second: { pane: 3 } }
    const widths = (layout: Layout) =>
      [...snapRects(layout, { width: 10 * 8, height: 700 }, cell).values()]
        .sort((a, b) => a.left - b.left)
        .map((b) => b.width / 8)
    expect(widths(nested)).toEqual([3, 4, 3])
    expect(widths(grouped)).toEqual([3, 4, 3])
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
    const threeRight: Layout = { split: 'right', first: { pane: 1 }, second: twoThree }
    const twoDown: Layout = { split: 'down', first: { pane: 1 }, second: { pane: 2 } }

    it('pane 하나는 cell 이 하한보다 작아도 하한 크기다', () => {
      expect(snapRects({ pane: 1 }, { width: 100, height: 50 }, cell, 'even', min).get(1)).toEqual({
        left: 0,
        top: 0,
        width: 23 * 8,
        height: 6 * 18
      })
    })

    it('고르게 나누면 한쪽이 하한 아래가 될 때 그쪽에 하한을 주고 나머지를 다른 쪽이 갖는다', () => {
      // 1 | (2 위, 3 | 4 아래) — 좌우로 늘어선 것은 1 과 오른쪽 부분 둘이지만, 오른쪽 부분은 하한 둘의 폭이 필요하다.
      const right: Layout = {
        split: 'right',
        first: { pane: 1 },
        second: {
          split: 'down',
          first: { pane: 2 },
          second: { split: 'right', first: { pane: 3 }, second: { pane: 4 } }
        }
      }
      const boxes = snapRects(right, { width: 80 * 8, height: 700 }, cell, 'even', min)
      expect([1, 2, 3].map((p) => [boxes.get(p)!.left / 8, boxes.get(p)!.width / 8])).toEqual([
        [0, 34],
        [34, 46],
        [34, 23]
      ])
      const down: Layout = {
        split: 'down',
        first: { pane: 1 },
        second: {
          split: 'right',
          first: { pane: 2 },
          second: { split: 'down', first: { pane: 3 }, second: { pane: 4 } }
        }
      }
      const stacked = snapRects(down, { width: 800, height: 20 * 18 }, cell, 'even', min)
      expect([1, 2, 3].map((p) => [stacked.get(p)!.top / 18, stacked.get(p)!.height / 18])).toEqual(
        [
          [0, 8],
          [8, 12],
          [8, 6]
        ]
      )
    })

    it('같은 방향으로 늘어선 pane 들은 나눔 트리 모양과 상관없이 하한이 큰 항목을 뺀 나머지 길이를 고르게 받는다', () => {
      const block: Layout = {
        split: 'down',
        first: { pane: 3 },
        second: { split: 'right', first: { pane: 4 }, second: { pane: 5 } }
      }
      const nested: Layout = {
        split: 'right',
        first: { pane: 1 },
        second: { split: 'right', first: { pane: 2 }, second: block }
      }
      const grouped: Layout = { split: 'right', first: twoRight, second: block }
      const columns = (layout: Layout) => {
        const boxes = snapRects(layout, { width: 100 * 8, height: 700 }, cell, 'even', min)
        return [1, 2, 3].map((p) => [boxes.get(p)!.left / 8, boxes.get(p)!.width / 8])
      }
      const expected = [
        [0, 27],
        [27, 27],
        [54, 46]
      ]
      expect(columns(nested)).toEqual(expected)
      expect(columns(grouped)).toEqual(expected)

      const stack: Layout = {
        split: 'down',
        first: { pane: 1 },
        second: {
          split: 'down',
          first: { pane: 2 },
          second: {
            split: 'right',
            first: { pane: 3 },
            second: { split: 'down', first: { pane: 4 }, second: { pane: 5 } }
          }
        }
      }
      const rows = snapRects(stack, { width: 800, height: 30 * 18 }, cell, 'even', min)
      expect([1, 2, 3].map((p) => [rows.get(p)!.top / 18, rows.get(p)!.height / 18])).toEqual([
        [0, 9],
        [9, 9],
        [18, 12]
      ])
    })

    it('하한을 받은 항목이 줄 가운데나 끝에 있어도 경계는 글자 칸 배수에 있고, 남는 px 는 마지막 항목이 갖는다', () => {
      const unit = { width: 8.5, height: 18 }
      const wide = { width: 23 * 8.5, height: 6 * 18 }
      const block: Layout = {
        split: 'down',
        first: { pane: 3 },
        second: { split: 'right', first: { pane: 4 }, second: { pane: 5 } }
      }
      const size = { width: 100 * 8.5 + 3, height: 700 }
      const spans = (layout: Layout, order: number[]) => {
        const boxes = snapRects(layout, size, unit, 'even', wide)
        return order.map((p) => [boxes.get(p)!.left, boxes.get(p)!.width])
      }
      const middle: Layout = {
        split: 'right',
        first: { pane: 1 },
        second: { split: 'right', first: block, second: { pane: 2 } }
      }
      expect(spans(middle, [1, 3, 2])).toEqual([
        [0, 27 * 8.5],
        [27 * 8.5, 46 * 8.5],
        [73 * 8.5, 27 * 8.5 + 3]
      ])
      const last: Layout = { split: 'right', first: twoRight, second: block }
      expect(spans(last, [1, 2, 3])).toEqual([
        [0, 27 * 8.5],
        [27 * 8.5, 27 * 8.5],
        [54 * 8.5, 46 * 8.5 + 3]
      ])
    })

    it('하한이 큰 항목에 하한을 준 뒤 남은 몫이 다른 항목의 하한보다 작아지면 그 항목에도 하한을 준다', () => {
      // 하한은 10 칸이고, 항목은 하한 2·6·1·1 개의 폭이 필요하다. 처음 고른 몫 25 는 두 번째 항목(60)에만 모자란다.
      // 두 번째에 60 을 주고 남은 40 칸의 고른 몫 13.3 은 첫 번째 항목(20)에도 모자라므로 첫 번째도 20 을 받는다.
      // 남은 20 칸은 나머지 두 항목이 10 씩 받는다.
      const narrow = { width: 10 * 8, height: 6 * 18 }
      let next = 1
      const row = (n: number): Layout =>
        n === 1 ? { pane: next++ } : { split: 'right', first: row(1), second: row(n - 1) }
      const block = (n: number): Layout => ({
        split: 'down',
        first: { pane: next++ },
        second: row(n)
      })
      const items = [block(2), block(6), { pane: next++ }, { pane: next++ }]
      const layout = items.reduceRight((rest, item): Layout => ({
        split: 'right',
        first: item,
        second: rest
      }))
      const boxes = snapRects(layout, { width: 100 * 8, height: 700 }, cell, 'even', narrow)
      expect(items.map((item) => boxes.get(panes(item)[0])!.width / 8)).toEqual([20, 60, 10, 10])
    })

    it('양쪽에 하한을 줄 자리가 없으면 각자 하한을 받고 뒤쪽이 cell 밖으로 나간다', () => {
      const boxes = snapRects(threeRight, { width: 40 * 8, height: 700 }, cell, 'even', min)
      expect([...boxes.values()].map((b) => [b.left / 8, b.width / 8])).toEqual([
        [0, 23],
        [23, 23],
        [46, 23]
      ])
      const stacked = snapRects(twoDown, { width: 800, height: 5 * 18 }, cell, 'even', min)
      expect(stacked.get(1)).toEqual({ left: 0, top: 0, width: 800, height: 6 * 18 })
      expect(stacked.get(2)).toEqual({ left: 0, top: 6 * 18, width: 800, height: 6 * 18 })
    })

    it('자리가 넉넉하면 하한이 경계를 바꾸지 않는다', () => {
      const size = { width: 1003, height: 700 }
      expect(snapRects(twoRight, size, cell, 'even', min)).toEqual(snapRects(twoRight, size, cell))
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

describe('paneMin', () => {
  it('single 에서는 터미널 20열과 여백·스크롤바가 들어가는 글자 칸 폭, 헤더를 더한 6행 높이다', () => {
    // 20열 + 여백 4px·스크롤바 8px(1.5칸)을 글자 칸 수로 올리면 22칸이다.
    expect(paneMin(cell, undefined)).toEqual({ width: 22 * 8, height: 6 * 18 })
  })

  it('columns 에서는 pane 하나의 폭이 폭의 하한이다', () => {
    expect(paneMin(cell, 80)).toEqual({ width: 82 * 8, height: 6 * 18 })
  })

  it('글자 칸 크기를 모르면 0 이다', () => {
    expect(paneMin({ width: 0, height: 0 }, undefined)).toEqual(NO_MIN)
    expect(paneMin({ width: 0, height: 0 }, 80)).toEqual(NO_MIN)
  })
})

describe('columnsWidthOf·areaOf', () => {
  const layout: Layout = {
    split: 'right',
    first: { pane: 1 },
    second: { split: 'down', first: { pane: 2 }, second: { pane: 3 } }
  }
  const measured = { width: 300, height: 500 }

  it('columns 에서 cell 폭은 열의 수만큼의 pane 폭이고, 높이는 잰 값이다', () => {
    expect(columnsWidthOf(layout, 80, cell)).toBe(2 * 82 * 8)
    expect(areaOf(layout, 80, cell, measured)).toEqual({ width: 2 * 82 * 8, height: 500 })
  })

  it('single 에서는 잰 크기 그대로다', () => {
    expect(columnsWidthOf(layout, undefined, cell)).toBeUndefined()
    expect(areaOf(layout, undefined, cell, measured)).toEqual(measured)
  })
})

describe('roomForSplit', () => {
  const twoDown: Layout = { split: 'down', first: { pane: 1 }, second: { pane: 2 } }
  const room = (
    layout: Layout,
    from: number,
    direction: 'right' | 'down',
    measured: Size | undefined,
    cols?: number,
    full = false
  ) => roomForSplit({ layout, cell, measured, cols }, { from, direction, full })

  it('single 에서 나눈 pane 들에 20열이 들어가지 않으면 나누지 않는다', () => {
    const height = 700
    expect(room(twoRight, 2, 'right', { width: 66 * 8, height })).toBe(true)
    expect(room(twoRight, 2, 'right', { width: 66 * 8 - 1, height })).toBe(false)
  })

  it('높이에 헤더를 뺀 5행이 들어가지 않으면 아래로 나누지 않는다', () => {
    expect(room(twoDown, 2, 'down', { width: 2000, height: 18 * 18 }, 80)).toBe(true)
    expect(room(twoDown, 2, 'down', { width: 2000, height: 18 * 18 - 1 }, 80)).toBe(false)
  })

  it('columns 에서는 cell 이 pane 폭만큼 넓어지므로 창이 좁아도 좌우로 나눈다', () => {
    const narrow = { width: 100, height: 700 }
    expect(room({ pane: 1 }, 1, 'right', narrow, 80)).toBe(true)
    expect(room({ pane: 1 }, 1, 'right', narrow)).toBe(false)
  })

  it('이미 cell 밖으로 나간 cell 에서도 넘침이 늘지 않는 split 은 된다', () => {
    const overflowed = { width: 200, height: 700 }
    expect(room(twoRight, 2, 'right', overflowed)).toBe(false)
    expect(room(twoRight, 2, 'down', overflowed)).toBe(true)
  })

  it('`full` 이면 pane 하나가 아니라 cell 전체를 나눈다', () => {
    const layout: Layout = { split: 'down', first: { pane: 1 }, second: twoThree }
    const area = { width: 44 * 8, height: 700 }
    expect(room(layout, 1, 'right', area)).toBe(true)
    expect(room(layout, 1, 'right', area, undefined, true)).toBe(false)
  })

  it('pane 영역을 아직 재지 않았으면 나눈다', () => {
    expect(room(twoRight, 2, 'right', undefined)).toBe(true)
  })
})
