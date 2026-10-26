import { programName, type ProgramStatusRecord } from '../../../shared/program-status'
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
 * 않으므로 foreground 프로세스의 cwd 를 먼저 쓴다. 셸과 같은 디렉토리면 maru-pty 가 셸의 경로를 실어 준다.
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

export function paneName(
  title: string | undefined,
  root: Pick<ProgramStatusRecord, 'app'> | undefined
): string {
  return title || (root ? programName(root.app) : 'Shell')
}
