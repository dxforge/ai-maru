export type SplitDirection = 'right' | 'down'

export type Layout = { pane: number } | { split: SplitDirection; first: Layout; second: Layout }

/**
 * pane 하나가 받는 터미널 크기의 하한. 열은 왼쪽 여백·스크롤바를 뺀 터미널 열, 행은 헤더를 뺀 터미널 행이다
 * (docs/architecture.md 의 "pane 경계와 셀 격자").
 */
export const PANE_MIN = { cols: 20, rows: 5 } as const
