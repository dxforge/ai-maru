/** maru-session 의 `program_status` 메시지에 담기는 레코드(OSC 7501). 모양은 maru-session 의 모듈 doc 이 계약이다. */

const PROGRAM_STATUS_STATES = ['idle', 'working', 'done', 'blocked', 'error'] as const
export type ProgramStatusState = (typeof PROGRAM_STATUS_STATES)[number]

export type ProgramStatusKind = 'permission' | 'question' | 'auth'

export type ProgramStatusRecord = {
  /** 루트 레코드는 `''`, 하위는 `/` 로 잇는다. */
  id: string
  state: ProgramStatusState
  kind: ProgramStatusKind | null
  progress: number | null
  app: string
  title: string
  message: string
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
