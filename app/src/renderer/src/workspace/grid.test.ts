import { describe, expect, it } from 'vitest'
import { snapRects } from './grid'
import type { Layout } from './layout'

const cell = { width: 8, height: 18 }

describe('snapRects', () => {
  it('칸 하나는 workspace 를 그대로 채운다', () => {
    expect(snapRects({ pane: 1 }, { width: 805, height: 700 }, cell).get(1)).toEqual({
      left: 0,
      top: 0,
      width: 805,
      height: 700
    })
  })

  it('나눈 경계는 셀의 배수에 두고, 남는 픽셀은 맨 오른쪽·맨 아래 칸이 갖는다', () => {
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

  it('셀 크기가 소수여도 경계는 그 배수다', () => {
    const boxes = snapRects(
      { split: 'down', first: { pane: 1 }, second: { pane: 2 } },
      { width: 800, height: 600 },
      { width: 7.8, height: 17.5 }
    )
    expect(boxes.get(2)!.top).toBe(17 * 17.5)
    expect(boxes.get(1)!.height).toBe(17 * 17.5)
  })

  it('칸이 반 셀보다 작아져도 상자는 음수가 되지 않고 빈틈 없이 workspace 를 채운다', () => {
    const chain = (i: number): Layout =>
      i === 8 ? { pane: i } : { split: 'down', first: { pane: i }, second: chain(i + 1) }
    const boxes = [...snapRects(chain(0), { width: 800, height: 300 }, cell).values()].sort(
      (a, b) => a.top - b.top
    )
    expect(boxes.every((b) => b.height >= 0)).toBe(true)
    boxes.slice(1).forEach((b, i) => expect(b.top).toBe(boxes[i].top + boxes[i].height))
    expect(boxes.at(-1)!.top + boxes.at(-1)!.height).toBe(300)
  })

  it('셀 크기를 모르면 px 로만 반올림한다', () => {
    const boxes = snapRects(
      { split: 'right', first: { pane: 1 }, second: { pane: 2 } },
      { width: 801, height: 600 },
      { width: 0, height: 0 }
    )
    expect(boxes.get(2)).toEqual({ left: 401, top: 0, width: 400, height: 600 })
  })
})
