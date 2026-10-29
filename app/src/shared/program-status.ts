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
 * 루트(`id` 가 `""`)와 하위 레코드 가운데 pane 의 상태로 보일 레코드. 루트가 없으면 없다. 루트가 working 이면 루트다.
 * 하위의 blocked 는 쓴 쪽이 아직 지우지 않은 것일 수 있기 때문이다. 그 밖에는 `URGENCY` 로 가장 급한 것이고, 같으면 루트,
 * 그다음 `records` 의 순서(maru-pty 가 보내는 id 순)다. 고른 레코드의 `app` 은 늘 루트의 `app` 이다. pane 의 이름·아이콘과
 * `maru pane list` 의 APP 열은 그 pane 의 프로그램을 가리키고, 하위가 자기 `app` 을 가져도 바뀌지 않아야 하기 때문이다.
 */
export function shownRecord(
  records: readonly ProgramStatusRecord[]
): ProgramStatusRecord | undefined {
  const root = records.find((r) => r.id === '')
  if (!root || root.state === 'working') return root
  let shown = root
  for (const r of records) {
    if (URGENCY.indexOf(r.state) < URGENCY.indexOf(shown.state)) shown = r
  }
  return shown.app === root.app ? shown : { ...shown, app: root.app }
}

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
