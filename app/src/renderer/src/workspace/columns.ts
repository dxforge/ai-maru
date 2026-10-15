const PANE_COLS = 80

/** 터미널 스크롤바 폭(px). FitAddon 도 이 폭을 칸 폭에서 뺀다. */
export const SCROLLBAR_WIDTH = 8

/** 터미널 왼쪽 여백. FitAddon 이 여백을 정수로 잘라 읽으므로 올려서 정수로 둔다. */
export function terminalPadding(cellWidth: number): number {
  return Math.ceil(cellWidth)
}

/**
 * columns 에서 칸이 `columns` 개 늘어선 workspace 의 폭(px). 칸 폭은 셀의 배수이고, 여백과 스크롤바를
 * 빼면 PANE_COLS 열이 남는다. FitAddon 이 나누는 셀 폭은 지금 열 수로 반올림한 값이라 실제와 열 수
 * 전체로 0.5px 까지 어긋나므로 그만큼을 더 둔다.
 */
export function columnsWidth(columns: number, cellWidth: number): number {
  if (cellWidth <= 0) return 0
  const extra = (terminalPadding(cellWidth) + SCROLLBAR_WIDTH + 0.5) / cellWidth
  return columns * Math.ceil(PANE_COLS + extra) * cellWidth
}
