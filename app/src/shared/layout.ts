export type SplitDirection = 'right' | 'down'

/** 잎은 화면 안에서는 pane 의 key, `state.json` 의 `cells` 표에서는 pane 의 id 다. */
export type Layout<P = number> =
  { pane: P } | { split: SplitDirection; first: Layout<P>; second: Layout<P> }

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
