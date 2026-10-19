/**
 * `pane.new` 가 renderer 에 넘기는 요청. `session` 은 나눌 pane 의 세션이다. `full` 이면 그 pane 이 아니라
 * pane 이 든 workspace 전체를 나눈다.
 */
export type PaneNewRequest = {
  session: string
  cwd: string
  direction: 'right' | 'down'
  command?: string[]
  full: boolean
}

export type PaneReply =
  { session: string } | { error: 'no_pane' | 'open_failed'; message: string } | null
