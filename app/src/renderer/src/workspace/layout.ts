import { panes, type Layout, type SplitDirection } from '../../../shared/layout'

export { panes }
export type { Layout, SplitDirection }
export type FocusDirection = 'left' | 'right' | 'up' | 'down'

export type Rect = { x: number; y: number; w: number; h: number }

/**
 * 좌우로 나눈 폭을 `even` 은 그 방향으로 늘어선 항목(pane 하나, 또는 다른 방향으로 나눈 부분 하나)의 몫(`weight`)
 * 비율로 나눈다. `{ cols }` 는 columns 보기로, pane 마다 열 수(pane 의 `cols`, 없으면 `{ cols }` 의
 * 값)로 폭을 정한다. 위아래로 나눈 높이는 두 값 모두 몫 비율로 나눈다.
 */
export type Widths = 'even' | { cols: number }

export type Split = Extract<Layout, { split: SplitDirection }>

export function withoutWeight(layout: Layout): Layout {
  const copy = { ...layout }
  delete copy.weight
  return copy
}

export function withoutCols(layout: Layout): Layout {
  const copy = { ...layout }
  if ('pane' in copy) delete copy.cols
  return copy
}

function withWeight(layout: Layout, weight: number | undefined): Layout {
  return weight === undefined ? withoutWeight(layout) : { ...layout, weight }
}

/**
 * 줄 `root` 의 크기를 지운다 — 항목의 몫과, 좌우 줄이면 항목 안 pane 의 열 수. 항목 안쪽의 다른 방향 나눔의 몫은
 * 그대로 둔다.
 * `root` 의 몫은 바깥 줄의 것이라 남긴다.
 */
export function resetLine(root: Split): Split {
  const reset = (node: Layout): Layout => {
    const bare = withoutWeight(node)
    if ('split' in bare && bare.split === root.split) {
      return { ...bare, first: reset(bare.first), second: reset(bare.second) }
    }
    return root.split === 'right' ? clearCols(bare) : bare
  }
  return { ...root, first: reset(root.first), second: reset(root.second) }
}

const isItemOf = (root: Split, pane: number): boolean =>
  line(root, root.split).some((item) => 'pane' in item && item.pane === pane)

/**
 * `target` 을 나눈다. `target` 이 든 줄과 같은 방향이면 그 줄에 항목이 늘어 줄의 크기를 지운다. 다른 방향이면 `target`
 * 의 몫을 새 나눔 노드가 이어받아 줄은 그대로다.
 */
export function splitPane(
  layout: Layout,
  target: number,
  pane: number,
  split: SplitDirection,
  outer?: SplitDirection
): Layout {
  if ('pane' in layout) {
    if (layout.pane !== target) return layout
    return withWeight({ split, first: withoutWeight(layout), second: { pane } }, layout.weight)
  }
  const first = splitPane(layout.first, target, pane, split, layout.split)
  const second = splitPane(layout.second, target, pane, split, layout.split)
  if (first === layout.first && second === layout.second) return layout
  const next = { ...layout, first, second }
  return layout.split !== outer && layout.split === split && isItemOf(layout, target)
    ? resetLine(next)
    : next
}

export function splitRoot(layout: Layout, pane: number, split: SplitDirection): Layout {
  const next: Split = { split, first: withoutWeight(layout), second: { pane } }
  return 'split' in layout && layout.split === split ? resetLine(next) : next
}

type Removed = { layout: Layout; next: number; lineChanged: boolean }

/**
 * `outer` 는 `layout` 이 든 줄의 방향이다. `lineChanged` 는 그 줄의 항목 수가 바뀌어 줄의 크기를 지워야 한다는 뜻이다.
 */
function remove(layout: Layout, target: number, outer?: SplitDirection): Removed | null {
  if ('pane' in layout) return null
  const { first, second, split } = layout
  const sibling =
    'pane' in first && first.pane === target
      ? second
      : 'pane' in second && second.pane === target
        ? first
        : undefined
  if (sibling) {
    const lineChanged = split === outer || ('split' in sibling && sibling.split === outer)
    // 형제가 같은 방향으로 나눈 것이면 그 나눔은 지운 pane 과 한 줄이었다.
    const rest = 'split' in sibling && sibling.split === split ? resetLine(sibling) : sibling
    return { layout: withWeight(rest, layout.weight), next: panes(sibling)[0], lineChanged }
  }
  for (const side of ['first', 'second'] as const) {
    const r = remove(layout[side], target, split)
    if (!r) continue
    const next: Split = { ...layout, [side]: r.layout }
    if (!r.lineChanged || split === outer) return { ...r, layout: next }
    return { layout: resetLine(next), next: r.next, lineChanged: false }
  }
  return null
}

/** 지운 pane 이 든 줄은 크기를 지운다. 그 줄이 없어지면 남은 쪽이 그 자리의 몫을 잇는다. */
export function removePane(
  layout: Layout,
  target: number
): { layout: Layout; next: number } | null {
  const r = remove(layout, target)
  return r && { layout: withoutWeight(r.layout), next: r.next }
}

export function clearCols(layout: Layout): Layout {
  if ('pane' in layout) return withoutCols(layout)
  return { ...layout, first: clearCols(layout.first), second: clearCols(layout.second) }
}

export function sameShape(a: Layout, b: Layout): boolean {
  if ('pane' in a || 'pane' in b) return 'pane' in a && 'pane' in b && a.pane === b.pane
  return a.split === b.split && sameShape(a.first, b.first) && sameShape(a.second, b.second)
}

export function line(layout: Layout, split: SplitDirection): Layout[] {
  if ('pane' in layout || layout.split !== split) return [layout]
  return [...line(layout.first, split), ...line(layout.second, split)]
}

/**
 * columns 보기에서 `layout` 이 받는 열 수. 좌우는 더하고 위아래는 큰 쪽이다. 글자 칸 폭을 모를 때와 비율(`rects`)에
 * 쓴다 — px 폭은 `naturalWidth`(`grid.ts`)가 pane 마다 여백을 더해 잰다.
 */
export function naturalCols(layout: Layout, cols: number): number {
  if ('pane' in layout) return layout.cols ?? cols
  const [a, b] = [naturalCols(layout.first, cols), naturalCols(layout.second, cols)]
  return layout.split === 'right' ? a + b : Math.max(a, b)
}

export function weight(part: Layout, split: SplitDirection, widths: Widths): number {
  if (split === 'right' && widths !== 'even') return naturalCols(part, widths.cols)
  return line(part, split).reduce((sum, item) => sum + (item.weight ?? 1), 0)
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

export type Edges = { left: boolean; top: boolean; right: boolean; bottom: boolean }

/** `rects` 의 상자 `r` 이 cell 의 어느 가장자리에 닿는지. */
export function edgesOf(r: Rect): Edges {
  return {
    left: r.x < EPSILON,
    top: r.y < EPSILON,
    right: r.x + r.w > 1 - EPSILON,
    bottom: r.y + r.h > 1 - EPSILON
  }
}

export const EPSILON = 1e-9

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
