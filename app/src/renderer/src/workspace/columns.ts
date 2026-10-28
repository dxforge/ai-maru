import { EPSILON } from './layout'

/**
 * Claude Code 는 `/diff` 패널과 mod 의 docked pane 을 110열부터, mod 가 스스로 연 pane 의 dock 은 144열부터
 * 그린다(2.1.308 의 문자열로 확인).
 */
const CLAUDE_COLS_STOPS: readonly number[] = [110, 144]

export function stepPaneCols(cols: number, by: 1 | -1, configured: number): number {
  const stops = [...new Set([configured, ...CLAUDE_COLS_STOPS])].sort((a, b) => a - b)
  const next = by === 1 ? stops.find((s) => s > cols) : stops.findLast((s) => s < cols)
  return next ?? cols
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
