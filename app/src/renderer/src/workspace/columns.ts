const PANE_COLS = 80

/** FitAddon 이 칸 폭에서 빼는 xterm 의 기본 스크롤바 폭. */
const SCROLLBAR_WIDTH = 14

/**
 * columns 에서 칸이 `columns` 개 늘어선 workspace 의 폭(px). 칸 사이 1px 경계를 빼고도 칸마다
 * PANE_COLS 열이 들어가야 한다. FitAddon 이 나누는 셀 폭은 지금 열 수로 반올림한 값이라 실제와
 * 0.5px/열 수 까지 어긋나므로 반 칸을 더 둔다.
 */
export function columnsWidth(columns: number, cellWidth: number): number {
  return columns * (Math.ceil((PANE_COLS + 0.5) * cellWidth) + SCROLLBAR_WIDTH + 1)
}
