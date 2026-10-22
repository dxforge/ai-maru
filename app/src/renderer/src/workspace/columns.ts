const PANE_COLS = 80

/** 터미널 스크롤바 폭(px). FitAddon 도 이 폭을 pane 폭에서 뺀다. */
export const SCROLLBAR_WIDTH = 8

/** 터미널 왼쪽 여백. FitAddon 이 여백을 정수로 잘라 읽으므로 올려서 정수로 둔다. */
export function terminalPadding(cellWidth: number): number {
  return Math.ceil(cellWidth)
}

/**
 * columns 에서 pane 이 `columns` 개 늘어선 workspace 의 폭(px). pane 폭은 셀의 배수이고, 여백과 스크롤바를
 * 빼면 PANE_COLS 열이 남는다. FitAddon 이 나누는 셀 폭은 지금 열 수로 반올림한 값이라 실제와 열 수
 * 전체로 0.5px 까지 어긋나므로 그만큼을 더 둔다. `floored` 면 `fitTerminal`(`TerminalView.vue`)이 열 수를 이
 * 셀 폭으로 직접 나누므로 더 두지 않는다. 더 두면 여백과 스크롤바가 셀의 배수일 때 한 셀이 더 붙어
 * `PANE_COLS + 1` 열이 된다.
 */
export function columnsWidth(columns: number, cellWidth: number, floored: boolean): number {
  if (cellWidth <= 0) return 0
  const slack = floored ? 0 : 0.5
  const extra = (terminalPadding(cellWidth) + SCROLLBAR_WIDTH + slack) / cellWidth
  return columns * Math.ceil(PANE_COLS + extra) * cellWidth
}
