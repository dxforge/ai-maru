import { EPSILON, share, type Layout, type Widths } from './layout'

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

// `box` 는 `required(layout)` 이상이므로 나눈 두 쪽도 각자 필요한 `unit` 수를 받는다.
function place(
  layout: Layout,
  box: Box,
  unit: Size,
  widths: Widths,
  min: Size,
  boxes: Map<number, Box>
): void {
  if ('pane' in layout) return void boxes.set(layout.pane, box)
  const [along, length] =
    layout.split === 'right' ? (['left', 'width'] as const) : (['top', 'height'] as const)
  const step = unit[length] > 0 ? unit[length] : 1
  const total = box[length]
  const steps = Math.floor(total / step + EPSILON)
  const need = (part: Layout): number => Math.ceil(required(part, min)[length] / step - EPSILON)
  const n = Math.min(
    Math.max(Math.round(share(layout, widths) * steps), need(layout.first)),
    steps - need(layout.second)
  )
  place(layout.first, { ...box, [length]: n * step }, unit, widths, min, boxes)
  const second = { ...box, [along]: box[along] + n * step, [length]: total - n * step }
  place(layout.second, second, unit, widths, min, boxes)
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
