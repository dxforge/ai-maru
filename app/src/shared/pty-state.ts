import { parseProgramStatus, type ProgramStatusRecord } from './program-status'

/** 셸이 OSC 133 으로 알린 명령 실행 상태다. 명령 pane 은 maru-pty 가 띄울 때 채운다. `startedAt` 은 epoch 밀리초다. */
export type PtyCommand = {
  running: boolean
  text: string | null
  exitCode: number | null
  startedAt: number | null
}

/**
 * maru-pty 가 `subscribe` 로 보내는 pane 상태. 각 값의 뜻은 maru-pty 의 모듈 doc(`core/crates/maru-pty/src/lib.rs`)이
 * 정한다. 값이 없으면 null 이다 — 지운 것과 받지 못한 것을 가르지 않는다. `command` 만은 null 이 "신호를 받은 적 없음" 이다.
 */
export type PtyState = {
  /** 셸이 OSC 7 로 보고한 cwd */
  cwd: string | null
  /** 받아들인 OSC 7 보고 수. 같은 디렉토리를 다시 보고해도 는다. */
  cwdReports: number
  /** OSC 0/2 의 제목 */
  title: string | null
  /** OSC 7501 레코드가 있는 동안 잰 foreground 프로세스의 cwd */
  foregroundCwd: string | null
  command: PtyCommand | null
  records: ProgramStatusRecord[]
}

/**
 * main 이 pty 마다 든 것. `old` 는 상태 구독을 모르는 이전 maru-pty 의 pty 다 — 그 pty 의 상태는 오지 않는다.
 * 이 표시는 이전 maru-pty 의 pty 가 모두 끝나면 지울 잠정 경로다.
 */
export type PtyStateEntry = { state: PtyState } | { old: true }

const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const numberOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null)

function parseCommand(v: unknown): PtyCommand | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  if (typeof c.running !== 'boolean') return null
  return {
    running: c.running,
    text: stringOrNull(c.text),
    exitCode: numberOrNull(c.exit_code),
    startedAt: numberOrNull(c.started_at)
  }
}

export function parsePtyState(v: unknown): PtyState | null {
  if (typeof v !== 'object' || v === null) return null
  const m = v as Record<string, unknown>
  if (m.type !== 'state') return null
  const records = parseProgramStatus(m)
  if (!records) return null
  return {
    cwd: stringOrNull(m.cwd),
    cwdReports: typeof m.cwd_reports === 'number' ? m.cwd_reports : 0,
    title: stringOrNull(m.title),
    foregroundCwd: stringOrNull(m.foreground_cwd),
    command: parseCommand(m.command),
    records
  }
}
