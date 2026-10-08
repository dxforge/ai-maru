export type SplitDirection = 'right' | 'down'
export type FocusDirection = 'left' | 'right' | 'up' | 'down'

export type Layout = { pane: number } | { split: SplitDirection; first: Layout; second: Layout }

export type Rect = { x: number; y: number; w: number; h: number }

export function splitPane(
  layout: Layout,
  target: number,
  pane: number,
  split: SplitDirection
): Layout {
  if ('pane' in layout) {
    return layout.pane === target ? { split, first: layout, second: { pane } } : layout
  }
  return {
    ...layout,
    first: splitPane(layout.first, target, pane, split),
    second: splitPane(layout.second, target, pane, split)
  }
}

export function removePane(
  layout: Layout,
  target: number
): { layout: Layout; next: number } | null {
  if ('pane' in layout) return null
  const { first, second } = layout
  if ('pane' in first && first.pane === target) return { layout: second, next: panes(second)[0] }
  if ('pane' in second && second.pane === target) return { layout: first, next: panes(first)[0] }
  const inFirst = removePane(first, target)
  if (inFirst) return { layout: { ...layout, first: inFirst.layout }, next: inFirst.next }
  const inSecond = removePane(second, target)
  if (inSecond) return { layout: { ...layout, second: inSecond.layout }, next: inSecond.next }
  return null
}

export function panes(layout: Layout): number[] {
  return 'pane' in layout ? [layout.pane] : [...panes(layout.first), ...panes(layout.second)]
}

/** 가로선 하나가 지나는 칸의 최대 개수. */
export function columnCount(layout: Layout): number {
  if ('pane' in layout) return 1
  const [a, b] = [columnCount(layout.first), columnCount(layout.second)]
  return layout.split === 'right' ? a + b : Math.max(a, b)
}

export function rects(layout: Layout, at: Rect = { x: 0, y: 0, w: 1, h: 1 }): Map<number, Rect> {
  if ('pane' in layout) return new Map([[layout.pane, at]])
  const [a, b]: Rect[] =
    layout.split === 'right'
      ? [
          { ...at, w: at.w / 2 },
          { ...at, x: at.x + at.w / 2, w: at.w / 2 }
        ]
      : [
          { ...at, h: at.h / 2 },
          { ...at, y: at.y + at.h / 2, h: at.h / 2 }
        ]
  return new Map([...rects(layout.first, a), ...rects(layout.second, b)])
}

const EPSILON = 1e-9

export function neighbor(layout: Layout, from: number, dir: FocusDirection): number | undefined {
  const all = rects(layout)
  const cur = all.get(from)
  if (!cur) return undefined
  const [along, length, across, width] =
    dir === 'left' || dir === 'right'
      ? (['x', 'w', 'y', 'h'] as const)
      : (['y', 'h', 'x', 'w'] as const)
  const forward = dir === 'right' || dir === 'down'
  let best: { pane: number; overlap: number } | undefined
  for (const [pane, r] of all) {
    const gap = forward
      ? r[along] - (cur[along] + cur[length])
      : cur[along] - (r[along] + r[length])
    if (Math.abs(gap) > EPSILON) continue
    const overlap =
      Math.min(r[across] + r[width], cur[across] + cur[width]) - Math.max(r[across], cur[across])
    if (overlap > EPSILON && (!best || overlap > best.overlap + EPSILON)) best = { pane, overlap }
  }
  return best?.pane
}
