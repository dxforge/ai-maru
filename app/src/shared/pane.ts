/**
 * `pane.new` 가 renderer 에 넘기는 요청. `session` 은 나눌 pane 의 세션이다. `full` 이면 그 pane 이 아니라
 * pane 이 든 cell 전체를 나눈다.
 */
export type PaneNewRequest = {
  session: string
  cwd: string
  direction: 'right' | 'down'
  command?: string[]
  full: boolean
}

/**
 * `cell.new` 핸들러가 renderer 에 넘기는 요청이다. `cell` 은 부른 세션(pane 이나 job)의 cell id 다.
 * renderer 는 새 cell 을 그 뒤에 놓는다. main 이 모르는 세션이면 `cell` 은 없다.
 */
export type CellNewRequest = Pick<PaneNewRequest, 'cwd' | 'command'> & { cell?: string }

/** `no_space` 는 나눌 자리가 없어 거절한 것이다(docs/architecture.md 의 "pane 경계와 글자 칸 격자"). */
export type PaneReply =
  { session: string } | { error: 'no_pane' | 'no_space' | 'open_failed'; message: string } | null
