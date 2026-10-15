import { EPSILON, rects, type Layout } from './layout'

export type Size = { width: number; height: number }
export type Box = { left: number; top: number; width: number; height: number }

/**
 * 칸의 경계를 셀 격자에 맞춘 px 상자. 경계가 셀의 배수에 있어야 나란한 칸끼리 행이, 위아래 칸끼리 열이
 * 이어진다. workspace 끝에 닿는 경계는 맞추지 않아, 남는 픽셀은 맨 아래·맨 오른쪽 칸이 갖는다.
 */
export function snapRects(layout: Layout, size: Size, cell: Size): Map<number, Box> {
  const edge = (f: number, total: number, unit: number): number => {
    if (f >= 1 - EPSILON) return total
    const step = unit > 0 ? unit : 1
    return Math.round((f * total) / step) * step
  }
  const boxes = new Map<number, Box>()
  for (const [pane, r] of rects(layout)) {
    const left = edge(r.x, size.width, cell.width)
    const top = edge(r.y, size.height, cell.height)
    const right = edge(r.x + r.w, size.width, cell.width)
    const bottom = edge(r.y + r.h, size.height, cell.height)
    boxes.set(pane, { left, top, width: right - left, height: bottom - top })
  }
  return boxes
}
