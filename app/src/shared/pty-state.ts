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
 * 프로그램이 OSC 9 나 OSC 777 로 보낸 데스크톱 알림. maru-pty 가 한 줄로 다듬어 보내고, OSC 로 온 알림은 둘 다 비지는
 * 않는다. OSC 9 는 제목을 싣지 않아 `title` 이 비어 있다. Claude Code 의 Notification hook 으로 받은 알림도 이 모양이다.
 * Claude Code 의 Notification hook 으로 받은 알림 가운데 상태 레코드가 같은 내용을 보이는 종류는 `title`·`body` 가 모두 빈
 * 알림(`isBodyless`)이다. 사이드바와 pane 헤더는 이 알림에 점만 달고, 데스크톱 알림은 본문에 pane 의 상태를
 * 쓴다(`docs/architecture.md`).
 */
export type PtyNotification = { title: string; body: string }

export function isBodyless(n: PtyNotification): boolean {
  return !n.title && !n.body
}

/**
 * main 이 pty 마다 든 것. `old` 는 상태 구독을 모르는 이전 maru-pty 의 pty 다 — 그 pty 의 상태는 오지 않는다.
 * 이 표시는 이전 maru-pty 의 pty 가 모두 끝나면 지울 잠정 경로다. `notification` 은 사용자가 아직 보지 않은 마지막 알림이다.
 */
export type PtyStateEntry = { state: PtyState; notification?: PtyNotification } | { old: true }

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

export function parsePtyNotification(v: unknown): PtyNotification | null {
  if (typeof v !== 'object' || v === null) return null
  const m = v as Record<string, unknown>
  if (m.type !== 'notification' || typeof m.title !== 'string' || typeof m.body !== 'string')
    return null
  return { title: m.title, body: m.body }
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
