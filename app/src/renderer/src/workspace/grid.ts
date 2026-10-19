import { EPSILON, rects, type Layout, type Widths } from './layout'

export type Size = { width: number; height: number }
export type Box = { left: number; top: number; width: number; height: number }

/** 칸 경계를 셀의 배수로 반올림한 px 상자. workspace 끝에 닿는 경계는 그대로 둔다 — docs/architecture.md 의 "칸 경계와 셀 격자". */
export function snapRects(
  layout: Layout,
  size: Size,
  cell: Size,
  widths: Widths = 'half'
): Map<number, Box> {
  const edge = (f: number, total: number, unit: number): number => {
    if (f >= 1 - EPSILON) return total
    const step = unit > 0 ? unit : 1
    return Math.round(f * Math.floor(total / step + EPSILON)) * step
  }
  const boxes = new Map<number, Box>()
  for (const [pane, r] of rects(layout, widths)) {
    const left = edge(r.x, size.width, cell.width)
    const top = edge(r.y, size.height, cell.height)
    const right = edge(r.x + r.w, size.width, cell.width)
    const bottom = edge(r.y + r.h, size.height, cell.height)
    boxes.set(pane, { left, top, width: right - left, height: bottom - top })
  }
  return boxes
}
