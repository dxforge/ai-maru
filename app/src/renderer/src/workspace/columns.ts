import { PANE_MAX_COLS, PANE_MIN } from '../../../shared/layout'
import { EPSILON } from './layout'

export function stepPaneCols(cols: number, by: 1 | -1, step: number): number {
  const min = PANE_MIN.cols
  const max = PANE_MAX_COLS
  if (cols > max) return by === -1 ? max : cols
  if (cols < min) return by === 1 ? min : cols
  const next = cols + by * step
  return next < min || next > max ? cols : next
}

export function paneColsOf(paneCols: number | undefined, columnCols: number): number {
  return paneCols ?? columnCols
}

/** Widen·Narrow Cell 로 바꾼 cell 의 `paneCols`. 설정값과 같아지면 지워, 그 뒤로는 설정을 따르게 한다. */
export function stepPaneColsOverride(
  paneCols: number | undefined,
  by: 1 | -1,
  layout: { columnCols: number; columnStep: number }
): number | undefined {
  const cols = stepPaneCols(paneColsOf(paneCols, layout.columnCols), by, layout.columnStep)
  return cols === layout.columnCols ? undefined : cols
}

export const SCROLLBAR_WIDTH = 8

/** 터미널 왼쪽 여백(px). `App.vue` 가 `--pad` 로 넘기고, `TerminalView.vue` 가 그 값을 `.xterm` 의 `padding-left` 로 둔다. */
export const TERMINAL_PADDING = 4

const CHROME = TERMINAL_PADDING + SCROLLBAR_WIDTH

/** 폭 `width` 인 pane 에 들어가는 터미널 열 수. `cellWidth` 는 0 보다 크다. */
export function fitCols(width: number, cellWidth: number): number {
  return Math.max(0, Math.floor((width - CHROME) / cellWidth + EPSILON))
}

/** 터미널 `cols` 열이 들어가는 pane 의 폭을 글자 칸 수로 올린 값. 글자 칸 폭을 모르면 0 이다. */
export function paneCells(cols: number, cellWidth: number): number {
  if (cellWidth <= 0) return 0
  return Math.ceil(cols + CHROME / cellWidth - EPSILON)
}

/**
 * columns 에서 터미널 `cols` 열이 들어가는 pane 의 폭(px). 글자 칸 폭의 배수라, pane 경계에 놓인 글자 열이 위아래 pane
 * 끼리 이어진다. 글자 칸 폭을 모르면 0 이다.
 */
export function columnWidth(cols: number, cellWidth: number): number {
  return paneCells(cols, cellWidth) * cellWidth
}
