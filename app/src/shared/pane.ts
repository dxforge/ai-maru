import type { ProgramStatusKind, ProgramStatusState } from './program-status'

/**
 * main 이 renderer 에 pane 을 가리키는 값이다. `pane` 이면 그 id 의 pane 을, `pty` 면 renderer 가 그 pty 를 보이는
 * pane 을 찾는다. main 은 둘을 서로 바꿔 찾지 않는다(`docs/architecture.md` 의 "창에 보내는 요청은 창이 준비된 뒤에
 * 넘긴다").
 */
export type PaneTarget = { pane: string } | { pty: string }

/**
 * `pane.new` 가 renderer 에 넘기는 요청. 나눌 pane 은 `--split` 으로 가리켰으면 `pane`, 아니면 부른 pty 의
 * pane(`pty`)이다. `full` 이면 그 pane 이 아니라 pane 이 든 cell 전체를 나눈다. `cell` 이 있으면 `pane`·`pty` 를 보지
 * 않고 그 id 의 cell 전체를 나눈다. `hidden` 이면 새 pane 을 숨긴 채 띄운다.
 */
export type PaneNewRequest = PaneTarget & {
  cwd: string
  direction: 'right' | 'down'
  command?: string[]
  full: boolean
  cell?: string
  hidden?: boolean
}

/**
 * `cell.new` 핸들러가 renderer 에 넘기는 요청이다. `cell` 은 부른 pty(pane 이나 job)의 cell id 다.
 * renderer 는 새 cell 을 그 뒤에 놓는다. main 이 모르는 pty 면 `cell` 은 없다. `place.cell` 은 `after`·`before` 로
 * 가리킨 pty 의 cell id 다. `place` 가 있으면 renderer 는 새 cell 을 그 cell 의 뒤(`place.before` 면 앞)에 놓는다.
 */
export type CellNewRequest = Pick<PaneNewRequest, 'cwd' | 'command'> & {
  cell?: string
  place?: { cell: string; before: boolean }
}

/** ⌘W·⇧⌘W 의 확인에 main 이 주는 답. `close` 면 닫는다. `asked` 는 main 이 확인 창을 띄웠거나, 다른 확인 창이 이미 떠 있었다는 뜻이다. */
export type CloseAnswer = { close: boolean; asked: boolean }

/** `pane.list` 의 한 줄이다. 각 값은 `maru` 의 모듈 doc(`core/crates/maru/src/main.rs`)이 정한다. */
export type PaneRow = {
  pane: string
  pty: string
  state: ProgramStatusState | ''
  kind: ProgramStatusKind | null
  app: string
  workspace: string
  cell: string
  title: string
  dir: string
  message: string
  hidden: boolean
}

/**
 * `pane`·`pty` 는 새 pane 과 그 pty 의 id 이고, `cell` 은 `cell.new` 가 연 cell 의 id 다. `no_space` 는 나눌
 * 자리가 없어 거절한 것이다(`docs/architecture.md` 의 "pane 경계와 글자 칸 격자"). `no_cell` 은 `pane.new` 가
 * 가리킨 cell 이 창에 없다는 것이다. `bad_place` 는 `cell.new` 가 가리킨 자리에 cell 을 넣지 못해 거절한 것이다.
 */
export type PaneReply =
  | { pane: string; pty: string; cell?: string }
  | {
      error: 'no_pane' | 'no_cell' | 'no_space' | 'bad_place' | 'open_failed'
      message: string
    }
  | null
