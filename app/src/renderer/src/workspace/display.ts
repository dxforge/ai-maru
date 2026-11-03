import type { CommandView } from '../../../shared/pane-name'
import type { PtyNotification, PtyState } from '../../../shared/pty-state'

export type CwdSources = {
  state?: PtyState
  /** 셸이 뜬(또는 뜰) 디렉토리(`Pane` 의 `startDir`) */
  startDir?: string
}

/**
 * pane 의 화면에 보일 cwd. 돌고 있는 프로그램이 옮겨 간 디렉토리(claude 가 들어간 worktree 등)는 셸의 OSC 7 로 오지
 * 않으므로 foreground 프로세스의 cwd 를 먼저 쓴다. 셸 cwd(없으면 pty 를 띄울 때의 시작 디렉토리)와 같은 디렉토리면 maru-pty 가 그 경로를 실어 준다.
 */
export function paneCwd(s: CwdSources): string | undefined {
  return s.state?.foregroundCwd ?? s.state?.cwd ?? s.startDir
}

/**
 * pane 의 제목. 상태가 오기 전에는 되살린 제목을 쓴다. 이전 maru-pty 의 pty 는 제목을 보내지 않으므로, 되살린 제목이
 * 낡은 채 남지 않게 비운다.
 */
export function paneTitle(s: {
  state?: PtyState
  restoredTitle?: string
  old: boolean
}): string | undefined {
  if (s.old) return undefined
  return s.state ? (s.state.title ?? undefined) : s.restoredTitle
}

export function notificationText(n: PtyNotification): string {
  return n.title && n.body ? `${n.title}: ${n.body}` : n.title || n.body
}

export function commandLabel(c: CommandView): string {
  return c.running ? 'Running' : `Exited with code ${c.exitCode}`
}

export function commandTail(c: CommandView, now: number): string {
  if (!c.running) return String(c.exitCode)
  return c.startedAt === undefined ? '' : elapsed(now - c.startedAt)
}

export function elapsed(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}
