import type { Layout, SplitDirection } from '../../../shared/layout'

export type { Layout, SplitDirection }
export type FocusDirection = 'left' | 'right' | 'up' | 'down'

export type Rect = { x: number; y: number; w: number; h: number }

/**
 * 좌우로 나눈 폭을 `even` 은 그 방향으로 늘어선 항목(pane 하나, 또는 다른 방향으로 나눈 부분 하나) 수(`line` 의 길이)
 * 비율로, `columns` 는 `columnCount` 비율로 나눈다. 위아래로 나눈 높이는 두 값 모두 늘어선 항목 수 비율로 나눈다.
 */
export type Widths = 'even' | 'columns'

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

export function splitRoot(layout: Layout, pane: number, split: SplitDirection): Layout {
  return { split, first: layout, second: { pane } }
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

export function columnCount(layout: Layout): number {
  if ('pane' in layout) return 1
  const [a, b] = [columnCount(layout.first), columnCount(layout.second)]
  return layout.split === 'right' ? a + b : Math.max(a, b)
}

export function line(layout: Layout, split: SplitDirection): Layout[] {
  if ('pane' in layout || layout.split !== split) return [layout]
  return [...line(layout.first, split), ...line(layout.second, split)]
}

export function weight(part: Layout, split: SplitDirection, widths: Widths): number {
  return split === 'right' && widths === 'columns' ? columnCount(part) : line(part, split).length
}

function share(layout: Extract<Layout, { split: SplitDirection }>, widths: Widths): number {
  const { split } = layout
  const first = weight(layout.first, split, widths)
  return first / (first + weight(layout.second, split, widths))
}

export function rects(
  layout: Layout,
  widths: Widths = 'even',
  at: Rect = { x: 0, y: 0, w: 1, h: 1 }
): Map<number, Rect> {
  if ('pane' in layout) return new Map([[layout.pane, at]])
  const [along, length] = layout.split === 'right' ? (['x', 'w'] as const) : (['y', 'h'] as const)
  const n = at[length] * share(layout, widths)
  const a = { ...at, [length]: n }
  const b = { ...at, [along]: at[along] + n, [length]: at[length] - n }
  return new Map([...rects(layout.first, widths, a), ...rects(layout.second, widths, b)])
}

export const EPSILON = 1e-9

/**
 * `rects` 에 `Widths` 를 넘기지 않는다. `Widths` 는 좌우로 나눈 폭의 비율만 바꾸고, pane 의 위아래·좌우 순서는 바꾸지
 * 않기 때문이다.
 */
export function readingOrder(layout: Layout): number[] {
  return [...rects(layout)]
    .sort(([, a], [, b]) => (Math.abs(a.y - b.y) > EPSILON ? a.y - b.y : a.x - b.x))
    .map(([pane]) => pane)
}

export function neighbor(
  layout: Layout,
  from: number,
  dir: FocusDirection,
  widths: Widths = 'even'
): number | undefined {
  const all = rects(layout, widths)
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
