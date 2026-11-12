import { PANE_MIN } from '../../../shared/layout'
import { naturalWidth, required, type Box, type Size } from './grid'
import {
  clearCols,
  EPSILON,
  line,
  panes,
  withoutCols,
  withoutWeight,
  type FocusDirection,
  type Layout,
  type Split,
  type SplitDirection,
  type Widths
} from './layout'

type Side = 'first' | 'second'
export type Path = Side[]

/**
 * 끌 수 있는 경계. `line` 은 `path` 의 줄에서 `index` 번째 항목과 그다음 항목 사이고, `edge` 는 columns 보기에서 cell 의
 * 오른쪽 끝이다. `pos` 는 경계의 px 위치, `start`·`end` 는 경계가 걸친 범위다.
 */
export type Divider = Target & { pos: number; start: number; end: number }

export type Target =
  | { kind: 'line'; path: Path; index: number; split: SplitDirection }
  | { kind: 'edge'; split: 'right' }

/**
 * `boxes` 는 지금 그린 pane 상자, `cell` 은 글자 칸 크기, `min` 은 pane 하나의 하한(`paneMin`)이다. `maxCols` 는
 * columns 보기에서 pane 하나가 넓어질 수 있는 열 수다.
 */
export type ResizeContext = {
  boxes: Map<number, Box>
  cell: Size
  min: Size
  widths: Widths
  maxCols: number
}

function nodeAt(layout: Layout, path: Path): Layout {
  return path.reduce((node, side) => (node as Split)[side], layout)
}

function replaceAt(layout: Layout, path: Path, node: Layout): Layout {
  if (!path.length) return node
  const split = layout as Split
  const [side, ...rest] = path
  return { ...split, [side]: replaceAt(split[side], rest, node) }
}

function mapItems(root: Split, f: (item: Layout, index: number) => Layout): Split {
  let i = 0
  const walk = (node: Layout): Layout =>
    'split' in node && node.split === root.split
      ? { ...node, first: walk(node.first), second: walk(node.second) }
      : f(node, i++)
  return { ...root, first: walk(root.first), second: walk(root.second) }
}

function mapLeaves(layout: Layout, f: (leaf: Extract<Layout, { pane: number }>) => Layout): Layout {
  if ('pane' in layout) return f(layout)
  return { ...layout, first: mapLeaves(layout.first, f), second: mapLeaves(layout.second, f) }
}

function bounds(layout: Layout, boxes: Map<number, Box>): Box {
  const all = panes(layout).map((p) => boxes.get(p)!)
  const left = Math.min(...all.map((b) => b.left))
  const top = Math.min(...all.map((b) => b.top))
  const right = Math.max(...all.map((b) => b.left + b.width))
  const bottom = Math.max(...all.map((b) => b.top + b.height))
  return { left, top, width: right - left, height: bottom - top }
}

/** 같은 방향으로 늘어선 줄마다 그 줄의 맨 위 노드. 바깥 줄이 먼저다. */
function lines(layout: Layout): { path: Path; root: Split }[] {
  const out: { path: Path; root: Split }[] = []
  const walk = (node: Layout, path: Path, outer?: SplitDirection): void => {
    if ('pane' in node) return
    if (node.split !== outer) out.push({ path, root: node })
    walk(node.first, [...path, 'first'], node.split)
    walk(node.second, [...path, 'second'], node.split)
  }
  walk(layout, [])
  return out
}

const isColumns = (widths: Widths, split: SplitDirection): widths is { cols: number } =>
  widths !== 'even' && split === 'right'

export function dividers(layout: Layout, boxes: Map<number, Box>, widths: Widths): Divider[] {
  if (panes(layout).some((p) => !boxes.has(p))) return []
  const out: Divider[] = lines(layout).flatMap(({ path, root }) => {
    const items = line(root, root.split)
    const area = bounds(root, boxes)
    const [along, across, size] =
      root.split === 'right'
        ? (['left', 'top', 'height'] as const)
        : (['top', 'left', 'width'] as const)
    return items.slice(1).map((item, i) => ({
      kind: 'line' as const,
      path,
      index: i,
      split: root.split,
      pos: bounds(item, boxes)[along],
      start: area[across],
      end: area[across] + area[size]
    }))
  })
  if (widths !== 'even') {
    const all = bounds(layout, boxes)
    out.push({
      kind: 'edge',
      split: 'right',
      pos: all.left + all.width,
      start: all.top,
      end: all.top + all.height
    })
  }
  return out
}

function naturalRights(
  layout: Layout,
  cols: number,
  cellWidth: number,
  at = 0
): Map<number, number> {
  if ('pane' in layout) return new Map([[layout.pane, at + naturalWidth(layout, cols, cellWidth)]])
  const shift = layout.split === 'right' ? naturalWidth(layout.first, cols, cellWidth) : 0
  return new Map([
    ...naturalRights(layout.first, cols, cellWidth, at),
    ...naturalRights(layout.second, cols, cellWidth, at + shift)
  ])
}

function touchingRight(region: Layout, cols: number, cellWidth: number): Set<number> {
  const edge = naturalWidth(region, cols, cellWidth)
  return new Set(
    [...naturalRights(region, cols, cellWidth)]
      .filter(([, r]) => Math.abs(r - edge) < EPSILON)
      .map(([p]) => p)
  )
}

/**
 * columns 보기의 좌우 밀기. `region` 의 오른쪽 끝을 `delta` 글자 칸 옮긴다. 넓힐 때는 열 수로 잰 오른쪽 끝이 `region`
 * 의 끝에 닿는 pane 들을 넓힌다. 좁힐 때는 새 끝을 넘는 pane 을 모두 새 끝까지 좁힌다. 위아래로 나눈 항목의 좁은 pane
 * 도 같이 줄이지 않으면 저장한 열 수가 보이는 폭보다 작아지기 때문이다. 바뀌는 pane 이 모두 20열과 `maxCols` 사이에 있게
 * `delta` 를 줄인다.
 */
function pushCols(
  region: Layout,
  delta: number,
  ctx: ResizeContext & { widths: { cols: number } }
): Layout {
  const { cols } = ctx.widths
  const width = ctx.cell.width
  if (width <= 0) return region
  const edge = naturalWidth(region, cols, width)
  const rights = naturalRights(region, cols, width)
  const gap = (p: number) => Math.round((edge - rights.get(p)!) / width)
  const all = panes(region).map((p) => ({ p, gap: gap(p), cur: colsOf(region, p) ?? cols }))
  const touching = all.filter((x) => x.gap === 0)
  const low = Math.min(0, Math.max(...all.map((x) => PANE_MIN.cols - x.cur - x.gap)))
  const high = Math.min(...touching.map((x) => Math.max(0, Math.max(ctx.maxCols, x.cur) - x.cur)))
  const by = Math.max(low, Math.min(high, delta))
  if (by === 0) return region
  const gaps = new Map(all.map((x) => [x.p, x.gap]))
  return mapLeaves(region, (leaf) => {
    const g = gaps.get(leaf.pane)!
    const change = by > 0 ? (g === 0 ? by : 0) : -Math.max(0, -by - g)
    if (change === 0) return leaf
    const next = (leaf.cols ?? cols) + change
    return next === cols ? withoutCols(leaf) : { ...leaf, cols: next }
  })
}

function colsOf(layout: Layout, pane: number): number | undefined {
  if ('pane' in layout) return layout.pane === pane ? layout.cols : undefined
  return colsOf(layout.first, pane) ?? colsOf(layout.second, pane)
}

/**
 * 경계를 `delta` 글자 칸(위아래는 행)만큼 옮긴 layout. 옮길 수 없으면 `layout` 을 그대로 돌려준다.
 * 비율로 나누는 줄은 이웃한 두 항목만 크기가 바뀌고, 줄의 모든 항목에 지금 크기(글자 칸 수)를 몫으로 적는다.
 */
export function moveDivider(layout: Layout, d: Target, delta: number, ctx: ResizeContext): Layout {
  if (delta === 0) return layout
  if (d.kind === 'edge') {
    return ctx.widths === 'even' ? layout : pushCols(layout, delta, { ...ctx, widths: ctx.widths })
  }
  const root = nodeAt(layout, d.path) as Split
  const items = line(root, root.split)
  if (isColumns(ctx.widths, d.split)) {
    const widths = ctx.widths
    const moved = mapItems(root, (item, i) =>
      i === d.index ? pushCols(item, delta, { ...ctx, widths }) : item
    )
    return line(moved, moved.split).every((item, i) => item === items[i])
      ? layout
      : replaceAt(layout, d.path, moved)
  }
  const [along, length] =
    d.split === 'right' ? (['left', 'width'] as const) : (['top', 'height'] as const)
  const step = ctx.cell[length]
  if (step <= 0) return layout
  const area = bounds(root, ctx.boxes)
  const total = Math.floor(area[length] / step + EPSILON)
  const starts = items.map((item) =>
    Math.round((bounds(item, ctx.boxes)[along] - area[along]) / step)
  )
  const sizes = items.map((_, i) => (i + 1 < items.length ? starts[i + 1] : total) - starts[i])
  const need = (i: number) => Math.ceil(required(items[i], ctx.min)[length] / step - EPSILON)
  const [a, b] = [d.index, d.index + 1]
  // 이미 하한보다 작은 항목(cell 이 좁아 넘친 경우)은 더 줄이지만 않는다.
  const low = Math.min(0, need(a) - sizes[a])
  const high = Math.max(0, sizes[b] - need(b))
  const by = Math.max(low, Math.min(high, delta))
  if (by === 0) return layout
  sizes[a] += by
  sizes[b] -= by
  return replaceAt(
    layout,
    d.path,
    mapItems(root, (item, i) => ({ ...item, weight: sizes[i] }))
  )
}

/** `pane` 을 담은 줄들. 바깥 줄이 먼저다. */
function linesOf(
  layout: Layout,
  pane: number
): { path: Path; split: SplitDirection; index: number; count: number }[] {
  return lines(layout).flatMap(({ path, root }) => {
    const items = line(root, root.split)
    const index = items.findIndex((item) => panes(item).includes(pane))
    return index < 0 ? [] : [{ path, split: root.split, index, count: items.length }]
  })
}

/**
 * columns 보기에서 pane 상자의 오른쪽 끝에 놓인 경계. 좁은 pane 이나 남는 폭을 채우는 pane 은 열 수로 잰 폭보다 넓게
 * 그려지므로, 그 pane 의 열 수가 아니라 화면에서 오른쪽에 닿은 경계를 옮겨야 화면이 바뀐다.
 */
function rightOf(layout: Layout, pane: number, ctx: ResizeContext): Target | undefined {
  const box = ctx.boxes.get(pane)
  if (!box) return undefined
  const right = box.left + box.width
  const found = dividers(layout, ctx.boxes, ctx.widths)
    .filter(
      (d) =>
        d.split === 'right' &&
        Math.abs(d.pos - right) < 0.5 &&
        d.start <= box.top + EPSILON &&
        d.end >= box.top + box.height - EPSILON
    )
    .sort((a, b) => a.end - a.start - (b.end - b.start))
  return found[0]
}

/**
 * 포커스된 pane 의 `dir` 쪽 경계를 그쪽으로 한 글자 칸(위아래는 한 행) 옮긴다. 그쪽에 경계가 없으면 반대쪽 경계를
 * 그쪽으로 옮긴다. columns 보기의 좌우는 포커스된 pane 의 오른쪽 끝에 놓인 경계를 끌기처럼 한 글자 칸 옮긴다.
 */
export function keyResize(
  layout: Layout,
  focused: number,
  dir: FocusDirection,
  ctx: ResizeContext
): Layout {
  const split: SplitDirection = dir === 'left' || dir === 'right' ? 'right' : 'down'
  const sign = dir === 'right' || dir === 'down' ? 1 : -1
  if (isColumns(ctx.widths, split)) {
    const d = rightOf(layout, focused, ctx)
    return d ? moveDivider(layout, d, sign, ctx) : layout
  }
  const owners = linesOf(layout, focused)
    .filter((l) => l.split === split)
    .reverse()
  const ahead = (l: { index: number; count: number }) =>
    sign > 0 ? l.index < l.count - 1 : l.index > 0
  const behind = (l: { index: number; count: number }) =>
    sign > 0 ? l.index > 0 : l.index < l.count - 1
  const at = owners.find(ahead)
  const l = at ?? owners.find(behind)
  if (!l) return layout
  const facing = at ? sign > 0 : sign < 0
  const index = facing ? l.index : l.index - 1
  return moveDivider(layout, { kind: 'line', path: l.path, index, split }, sign, ctx)
}

/**
 * 경계 `d` 가 나누는 줄을 같은 크기로 되돌린다. 비율로 나누는 줄은 항목의 몫만 지워 안쪽 나눔은 그대로 둔다. columns
 * 보기의 좌우 줄은 그 줄 안 pane 의 열 수를, cell 오른쪽 끝은 그 끝이 미는 pane 의 열 수를 지운다.
 */
export function equalizeLine(layout: Layout, d: Target, widths: Widths, cellWidth: number): Layout {
  if (d.kind === 'edge') {
    if (widths === 'even') return layout
    const touching = touchingRight(layout, widths.cols, cellWidth)
    return mapLeaves(layout, (leaf) => (touching.has(leaf.pane) ? withoutCols(leaf) : leaf))
  }
  const root = nodeAt(layout, d.path) as Split
  const next = isColumns(widths, d.split)
    ? (clearCols(root) as Split)
    : mapItems(root, withoutWeight)
  return replaceAt(layout, d.path, next)
}

/** cell 의 모든 줄을 같은 크기로 되돌린다. 지금 보기의 좌우 크기와 위아래 몫을 지운다. */
export function equalizeAll(layout: Layout, widths: Widths): Layout {
  const walk = (node: Layout, outer?: SplitDirection): Layout => {
    const keep = outer !== undefined && isColumns(widths, outer)
    const bare = keep ? node : withoutWeight(node)
    if ('pane' in bare) return widths === 'even' ? bare : withoutCols(bare)
    return { ...bare, first: walk(bare.first, bare.split), second: walk(bare.second, bare.split) }
  }
  return walk(layout)
}
