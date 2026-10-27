import { programName, type ProgramStatusRecord } from '../../../shared/program-status'
import { dirName } from '../../../shared/names'
import type { PtyState } from '../../../shared/pty-state'

export type CwdSources = {
  state?: PtyState
  /** 재시작 전 화면에 보이던 cwd(snapshot) */
  restoredCwd?: string
  /** pty 를 띄운 실제 시작 디렉토리(`spawned`) */
  spawnedCwd?: string
  /** 셸을 띄울 때 요청한 디렉토리 */
  startDir?: string
}

/**
 * pane 의 화면에 보일 cwd. 돌고 있는 프로그램이 옮겨 간 디렉토리(claude 가 들어간 worktree 등)는 셸의 OSC 7 로 오지
 * 않으므로 foreground 프로세스의 cwd 를 먼저 쓴다. 셸 cwd(없으면 pty 를 띄울 때의 시작 디렉토리)와 같은 디렉토리면 maru-pty 가 그 경로를 실어 준다.
 * 재시작으로 남긴 pty 에 다시 붙으면 `spawned` 에 cwd 가 없으므로, 상태가 오기 전에는 되살린 cwd 를 쓴다.
 */
export function paneCwd(s: CwdSources): string | undefined {
  return s.state?.foregroundCwd ?? s.state?.cwd ?? s.restoredCwd ?? s.spawnedCwd ?? s.startDir
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

type Named = { title?: string; command?: readonly string[] }

/**
 * 제목도 OSC 7501 레코드도 없는 pane 의 이름. 명령 pane 은 그 명령, 아니면 셸이다. maru-pty 는 `SHELL` 이 비었거나
 * 실행할 수 없으면 `/bin/sh` 를 띄운다. 실행할 수 있는지는 여기서 보지 않는다.
 */
export function fallbackName(p: Pick<Named, 'command'>, shell: string | undefined): string {
  if (p.command?.length) return dirName(p.command[0])
  return shell ? dirName(shell) : 'sh'
}

/** pane 에 보일 명령. 도는 중이거나, 끝났는데 종료 코드가 0 이 아닌(실패한) 것만 보인다. */
export type CommandView =
  | { running: true; text: string; startedAt?: number }
  | { running: false; text: string; exitCode: number }

/** OSC 7501 레코드가 있는 pane 은 그 프로그램(claude 등)이 알리는 상태를 쓰므로 명령을 보이지 않는다. */
export function commandView(state: PtyState | undefined): CommandView | undefined {
  const c = state?.command
  if (!c?.text || state!.records.length) return undefined
  if (c.running) return { running: true, text: c.text, startedAt: c.startedAt ?? undefined }
  if (c.exitCode !== null && c.exitCode !== 0)
    return { running: false, text: c.text, exitCode: c.exitCode }
  return undefined
}

export function commandLabel(c: CommandView): string {
  return c.running ? 'Running' : `Exited with code ${c.exitCode}`
}

export function commandTail(c: CommandView, now: number): string {
  if (!c.running) return String(c.exitCode)
  return c.startedAt === undefined ? '' : elapsed(now - c.startedAt)
}

/**
 * 레코드가 없는 pane 에서는 명령이 제목보다 먼저다. 프롬프트마다 제목을 찍는 셸 설정(oh-my-zsh 등)에서도 명령이 보이게
 * 하기 위해서다.
 */
export function paneName(
  p: Named,
  root: Pick<ProgramStatusRecord, 'app'> | undefined,
  shell: string | undefined,
  command?: CommandView
): string {
  if (root) return p.title || programName(root.app)
  return command?.text || p.title || fallbackName(p, shell)
}

export function elapsed(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}
