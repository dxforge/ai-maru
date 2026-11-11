/** maru-pty 의 `program_status` 메시지에 담기는 레코드(OSC 7501). 모양은 maru-pty 의 모듈 doc(`core/crates/maru-pty/src/lib.rs`)이 정한다. */

const PROGRAM_STATUS_STATES = ['idle', 'working', 'done', 'blocked', 'error'] as const
export type ProgramStatusState = (typeof PROGRAM_STATUS_STATES)[number]

export type ProgramStatusKind = 'permission' | 'question' | 'auth'

export type ProgramStatusRecord = {
  id: string
  state: ProgramStatusState
  kind: ProgramStatusKind | null
  progress: number | null
  app: string
  title: string
  message: string
}

/** Claude Code 2.1.310 이 OSC 7501 보고에 싣는 `app` 값이다. */
export const CLAUDE_APP = 'claude-code'

export function programName(app: string): string {
  if (app === CLAUDE_APP) return 'Claude'
  return app || 'Program'
}

/** 앞일수록 급한 상태다. */
export const URGENCY: readonly ProgramStatusState[] = [
  'blocked',
  'error',
  'done',
  'working',
  'idle'
]

/**
 * 루트(`id` 가 `""`)와 하위 레코드 가운데 pane 의 상태로 보일 레코드. 루트가 없으면 없다. 루트가 `working` 이면 `kind` 가 있는
 * 하위 `blocked` 가운데 `records` 의 순서(maru-pty 가 보내는 id 순)로 첫 것이고, 없으면 루트다. 사람이 답해야 하는 하위 레코드는
 * 루트가 일하는 동안에도 보여야 하기 때문이다. 루트가 `working` 이면 `kind` 없는 하위 `blocked`(Claude Code 가 멈춘 task 에
 * 보내는 것)는 고르지 않는다. 답할 것이 없기 때문이다. 쓴 쪽이 아직 지우지 않은 레코드일 수도 있다. 루트가 `working` 이 아니면
 * `URGENCY` 로 가장 급한 것이고, 같으면 루트, 그다음 `records` 의 순서다. 다만 루트가 `done`·`idle` 이고 그렇게 고른 것이 루트나
 * 하위 `working` 일 때, 하위 `working` 이 있으면 `state` 만 `working` 으로 바꾼 루트다. 차례를 마친 뒤에도 백그라운드 일이 돌면
 * pane 은 일하는 중으로 보여야 하고, 보이는 문장은 루트의 것이어야 하기 때문이다. 루트가 `idle` 인 것은 사용자가 본 pane 의 `done` 을
 * 앱이 `idle` 로 바꿔서다. 고른 레코드의 `app` 은 늘 루트의 `app` 이다. pane 의 이름·아이콘과
 * `maru pane list` 의 APP 열은 그 pane 의 프로그램을 가리키고, 하위가 자기 `app` 을 가져도 바뀌지 않아야 하기 때문이다.
 */
export function shownRecord(
  records: readonly ProgramStatusRecord[]
): ProgramStatusRecord | undefined {
  return pick(records)?.shown
}

/**
 * `shownRecord` 가 하위 `working` 때문에 루트를 `working` 으로 바꿔 보일 때, 루트가 보낸 상태(`done`·`idle`). 그 밖에는 없다.
 */
export function restingRoot(records: readonly ProgramStatusRecord[]): 'done' | 'idle' | undefined {
  return pick(records)?.resting
}

function pick(
  records: readonly ProgramStatusRecord[]
): { shown: ProgramStatusRecord; resting?: 'done' | 'idle' } | undefined {
  const root = records.find((r) => r.id === '')
  if (!root) return undefined
  let shown = root
  if (root.state === 'working') {
    shown = records.find((r) => r.id !== '' && r.state === 'blocked' && r.kind !== null) ?? root
  } else {
    for (const r of records) {
      if (URGENCY.indexOf(r.state) < URGENCY.indexOf(shown.state)) shown = r
    }
    const resting = root.state === 'done' || root.state === 'idle' ? root.state : undefined
    if (resting && (shown === root || shown.state === 'working') && records.some(isRunning)) {
      return { shown: { ...root, state: 'working' }, resting }
    }
  }
  return { shown: shown.app === root.app ? shown : { ...shown, app: root.app } }
}

const isRunning = (r: ProgramStatusRecord): boolean => r.id !== '' && r.state === 'working'

/**
 * pane 에서 도는 백그라운드 일(하위 레코드)로 사이드바 카드에 늘어놓을 것. `records` 의 순서다. `working`·`error` 와 `kind` 없는
 * `blocked`(Claude Code 가 멈춘 task 에 보내는 것)다. 끝난 것(`done`·`idle`)은 넣지 않고, `kind` 가 있는 `blocked` 는 pane 의 상태로
 * 이미 보이므로 넣지 않는다.
 */
export function runningTasks(records: readonly ProgramStatusRecord[]): ProgramStatusRecord[] {
  return records.filter(
    (r) =>
      r.id !== '' &&
      (r.state === 'working' || r.state === 'error' || (r.state === 'blocked' && r.kind === null))
  )
}

/** `maru claude hook` 이 백그라운드 셸에 쓰는 레코드의 id 앞부분이다. 그 레코드의 `title` 은 셸의 명령이다. */
export const SHELL_TASK_PREFIX = 'bg/'

const KINDS: ReadonlySet<unknown> = new Set(['permission', 'question', 'auth'])
const STATES: ReadonlySet<unknown> = new Set(PROGRAM_STATUS_STATES)

export function parseProgramStatus(v: unknown): ProgramStatusRecord[] | null {
  if (typeof v !== 'object' || v === null) return null
  const records = (v as { records?: unknown }).records
  if (!Array.isArray(records)) return null
  const out: ProgramStatusRecord[] = []
  for (const r of records) {
    if (typeof r !== 'object' || r === null) continue
    const rec = r as Record<string, unknown>
    if (typeof rec.id !== 'string' || !STATES.has(rec.state)) continue
    out.push({
      id: rec.id,
      state: rec.state as ProgramStatusState,
      kind: KINDS.has(rec.kind) ? (rec.kind as ProgramStatusKind) : null,
      progress: typeof rec.progress === 'number' ? rec.progress : null,
      app: typeof rec.app === 'string' ? rec.app : '',
      title: typeof rec.title === 'string' ? rec.title : '',
      message: typeof rec.message === 'string' ? rec.message : ''
    })
  }
  return out
}
