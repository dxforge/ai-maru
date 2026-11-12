export type SplitDirection = 'right' | 'down'

/**
 * 잎은 화면 안에서는 pane 의 key, `state.json` 의 `cells` 표에서는 pane 의 id 다.
 *
 * 크기 필드는 사용자가 pane 크기를 바꿨을 때만 있다. 없으면 같은 크기로 나눈다.
 * - `weight` 는 이 노드가 같은 방향으로 늘어선 줄(`line`)의 항목일 때 그 줄에서 받는 몫이다. 좌우 줄의 몫은 single
 *   보기의 폭만, 위아래 줄의 몫은 두 보기의 높이를 정한다. 줄의 항목 가운데 몫이 없는 항목은 1 이다.
 * - `cols` 는 columns 보기에서 이 pane 이 받는 터미널 열 수다. 없으면 cell 의 열 수(`paneCols`)다.
 */
export type Layout<P = number> = (
  { pane: P; cols?: number } | { split: SplitDirection; first: Layout<P>; second: Layout<P> }
) & { weight?: number }

/** 잎을 왼쪽(위)부터 돌려준다. 화면의 pane 순서다. */
export function panes<P>(layout: Layout<P>): P[] {
  return 'pane' in layout ? [layout.pane] : [...panes(layout.first), ...panes(layout.second)]
}

/**
 * pane 하나가 받는 터미널 크기의 하한. 열은 왼쪽 여백·스크롤바를 뺀 터미널 열, 행은 헤더를 뺀 터미널 행이다
 * (docs/architecture.md 의 "pane 경계와 글자 칸 격자").
 */
export const PANE_MIN = { cols: 20, rows: 5 } as const

/** columns 보기에서 `layout.column-cols` 와 Widen·Narrow Cell 이 정하는 pane 열 수의 상한이다. 재시작으로 되살린 `paneCols` 는 이 상한으로 맞추지 않으므로 500 보다 클 수 있다. */
export const PANE_MAX_COLS = 500
