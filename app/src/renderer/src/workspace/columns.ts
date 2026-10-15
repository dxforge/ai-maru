const PANE_COLS = 80

/** FitAddon 이 칸 폭에서 빼는 xterm 의 기본 스크롤바 폭. */
const SCROLLBAR_WIDTH = 14

/** 터미널 왼쪽 여백. FitAddon 이 여백을 정수로 잘라 읽으므로 올려서 정수로 둔다. */
export function terminalPadding(cellWidth: number): number {
  return Math.ceil(cellWidth)
}

/**
 * columns 에서 칸이 `columns` 개 늘어선 workspace 의 폭(px). 칸 폭을 셀의 배수로 잡아 고르게 나눈 경계가
 * 셀 격자에 그대로 떨어지게 하고, 여백과 스크롤바를 빼면 PANE_COLS 열이 남게 한다. FitAddon 이 나누는
 * 셀 폭은 지금 열 수로 반올림한 값이라 실제와 열 수 전체로 0.5px 까지 어긋나므로 그만큼을 더 둔다.
 */
export function columnsWidth(columns: number, cellWidth: number): number {
  if (cellWidth <= 0) return 0
  const extra = (terminalPadding(cellWidth) + SCROLLBAR_WIDTH + 0.5) / cellWidth
  return columns * Math.ceil(PANE_COLS + extra) * cellWidth
}
