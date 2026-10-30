import { PANE_MIN, type SplitDirection } from '../../../shared/layout'
import { columnWidth, paneCells } from './columns'
import {
  columnCount,
  EPSILON,
  line,
  splitPane,
  splitRoot,
  weight,
  type Layout,
  type Widths
} from './layout'

export type Size = { width: number; height: number }
export type Box = { left: number; top: number; width: number; height: number }

export const NO_MIN: Size = { width: 0, height: 0 }

export function required(layout: Layout, min: Size): Size {
  if ('pane' in layout) return min
  const [a, b] = [required(layout.first, min), required(layout.second, min)]
  return layout.split === 'right'
    ? { width: a.width + b.width, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height }
}

/**
 * pane 경계를 `unit` 의 배수로 반올림한 px 상자. `unit` 은 글자 칸 크기이고, columns 보기에서는 `unit` 의 폭으로 pane
 * 하나의 폭을 받는다. cell 끝에 닿는 경계는 그대로 둔다 — docs/architecture.md 의 "pane 경계와 글자 칸 격자". `min` 은 pane 하나의
 * px 하한이고 `unit` 의 배수다. cell 이 `required` 보다 작으면 그 크기에 놓아, 뒤쪽 pane 이 cell 밖으로 나간다.
 */
export function snapRects(
  layout: Layout,
  size: Size,
  unit: Size,
  widths: Widths = 'even',
  min: Size = NO_MIN
): Map<number, Box> {
  const need = required(layout, min)
  const boxes = new Map<number, Box>()
  const box = {
    left: 0,
    top: 0,
    width: Math.max(size.width, need.width),
    height: Math.max(size.height, need.height)
  }
  place(layout, box, unit, widths, min, boxes)
  return boxes
}

// `box` 는 `required(layout)` 이상이므로 `line` 이 펼친 항목마다 필요한 `unit` 수를 받는다.
function place(
  layout: Layout,
  box: Box,
  unit: Size,
  widths: Widths,
  min: Size,
  boxes: Map<number, Box>
): void {
  if ('pane' in layout) return void boxes.set(layout.pane, box)
  const { split } = layout
  const [along, length] =
    split === 'right' ? (['left', 'width'] as const) : (['top', 'height'] as const)
  const step = unit[length] > 0 ? unit[length] : 1
  const total = box[length]
  const steps = Math.floor(total / step + EPSILON)
  const items = line(layout, split).map((part) => ({
    part,
    weight: weight(part, split, widths),
    need: Math.ceil(required(part, min)[length] / step - EPSILON),
    fixed: false
  }))
  let rest = steps
  let restWeight = items.reduce((sum, item) => sum + item.weight, 0)
  for (let changed = true; changed;) {
    changed = false
    for (const item of items) {
      if (item.fixed || item.need <= (rest * item.weight) / restWeight + EPSILON) continue
      item.fixed = true
      rest -= item.need
      restWeight -= item.weight
      changed = true
    }
  }
  let fixedSteps = 0
  let freeWeight = 0
  let start = 0
  items.forEach((item, i) => {
    if (item.fixed) fixedSteps += item.need
    else freeWeight += item.weight
    const end = fixedSteps + (restWeight > 0 ? Math.round((rest * freeWeight) / restWeight) : 0)
    // 마지막 항목은 글자 칸에 맞지 않고 남는 px 까지 갖는다.
    const size = i === items.length - 1 ? total - start * step : (end - start) * step
    place(
      item.part,
      { ...box, [along]: box[along] + start * step, [length]: size },
      unit,
      widths,
      min,
      boxes
    )
    start = end
  })
}

/** `layout` 을 `size` 에 놓을 때 cell 끝 밖으로 나가는 길이(px). `snapRects` 는 `required` 만큼만 넘친다. */
export function overflow(layout: Layout, size: Size, min: Size): Size {
  const need = required(layout, min)
  return {
    width: Math.max(0, need.width - size.width),
    height: Math.max(0, need.height - size.height)
  }
}

/**
 * `layout` 을 `next` 로 나눠도 cell 밖으로 나가는 길이가 늘지 않는지. 나눌 자리가 없는 split 은 늘린다.
 * columns 보기의 좌우 나누기는 `nextSize` 가 그만큼 넓어 폭이 넘치지 않는다. `min` 이 0 이면(글자 칸 크기를 모르면)
 * 늘 나눌 수 있다.
 */
export function canSplit(
  layout: Layout,
  size: Size,
  next: Layout,
  nextSize: Size,
  min: Size
): boolean {
  const [before, after] = [overflow(layout, size, min), overflow(next, nextSize, min)]
  return after.width <= before.width + EPSILON && after.height <= before.height + EPSILON
}

/** columns 보기에서는 cell 의 pane 열 수, single 보기에서는 없다. */
export type ColumnCols = number | undefined

// columns 보기에서는 pane 하나의 폭을 폭의 하한으로 둔다. `layout.column-cols` 와 ⇧⌘. / ⇧⌘, 로 바꾼 값은
// `PANE_MIN.cols` 이상이므로 이 하한이 `PANE_MIN` 도 지킨다.
export function paneMin(cell: Size, cols: ColumnCols): Size {
  return {
    width:
      cols === undefined
        ? paneCells(PANE_MIN.cols, cell.width) * cell.width
        : columnWidth(cols, cell.width),
    height: (PANE_MIN.rows + 1) * cell.height
  }
}

export function columnsWidthOf(layout: Layout, cols: ColumnCols, cell: Size): number | undefined {
  if (cols === undefined) return undefined
  return columnCount(layout) * columnWidth(cols, cell.width)
}

export function areaOf(layout: Layout, cols: ColumnCols, cell: Size, measured: Size): Size {
  return {
    width: columnsWidthOf(layout, cols, cell) ?? measured.width,
    height: measured.height
  }
}

/**
 * cell 의 pane `from` 을, `full` 이면 cell 전체를 `direction` 으로 나눌 자리가 있는지. `cell` 은 글자 칸 크기이고
 * `measured` 는 잰 pane 영역이다. 아직 재지 않았으면 나눌 수 있다.
 */
export function roomForSplit(
  {
    layout,
    cell,
    measured,
    cols
  }: { layout: Layout; cell: Size; measured: Size | undefined; cols: ColumnCols },
  { from, direction, full }: { from: number; direction: SplitDirection; full: boolean }
): boolean {
  if (!measured) return true
  const next = full ? splitRoot(layout, -1, direction) : splitPane(layout, from, -1, direction)
  const area = (l: Layout): Size => areaOf(l, cols, cell, measured)
  return canSplit(layout, area(layout), next, area(next), paneMin(cell, cols))
}
