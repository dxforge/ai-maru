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

/** 터미널 스크롤바 폭(px). FitAddon 도 이 폭을 pane 폭에서 뺀다. */
export const SCROLLBAR_WIDTH = 8

/** 터미널 왼쪽 여백. FitAddon 이 여백을 정수로 잘라 읽으므로 올려서 정수로 둔다. */
export function terminalPadding(cellWidth: number): number {
  return Math.ceil(cellWidth)
}

/**
 * 터미널 `cols` 열이 들어가는 pane 의 폭(글자 칸 수). 여백과 스크롤바를 빼면 `cols` 열이 남는다. FitAddon 이 나누는
 * 글자 칸 폭은 지금 열 수로 반올림한 값이라 실제와 열 수 전체로 0.5px 까지 어긋나므로 그만큼을 더 둔다. `floored` 면
 * `fitTerminal`(`TerminalView.vue`)이 열 수를 이 글자 칸 폭으로 직접 나누므로 더 두지 않는다. 더 두면 여백과
 * 스크롤바가 글자 칸의 배수일 때 한 글자 칸이 더 붙어 `cols + 1` 열이 된다. 글자 칸 폭을 모르면 0 이다.
 */
export function paneCells(cols: number, cellWidth: number, floored: boolean): number {
  if (cellWidth <= 0) return 0
  const slack = floored ? 0 : 0.5
  const extra = (terminalPadding(cellWidth) + SCROLLBAR_WIDTH + slack) / cellWidth
  return Math.ceil(cols + extra)
}

/** columns 에서 pane 이 `columns` 개 늘어선 cell 의 폭(px). pane 폭은 글자 칸의 배수다. */
export function columnsWidth(
  columns: number,
  cellWidth: number,
  floored: boolean,
  cols: number
): number {
  return columns * paneCells(cols, cellWidth, floored) * cellWidth
}
