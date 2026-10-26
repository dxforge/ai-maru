import type { MessageBoxOptions } from 'electron'
import type { ScreenPane } from '../shared/screen'
import type { Foreground } from './pty'

type PaneTarget = Pick<ScreenPane, 'ptyId' | 'command'>

export type ProgramDeps = {
  foreground: (pty: string) => Promise<Foreground>
  shellPid: (pty: string) => Promise<number | null>
}

/**
 * pane 에서 셸 말고 도는 프로그램. 없으면 null 이고, 있는데 이름을 모르면 `name` 이 null 이다.
 *
 * 명령 pane 은 `foreground` 를 묻지 않고 늘 실행 중으로 본다. 셸이 명령을 exec 하므로 foreground 프로세스 그룹이
 * bash 에서는 셸 pid 로, zsh 에서는 0 으로 나오기 때문이다. 명령이 끝나면 pane 도 닫히므로, 떠 있는 명령 pane 에서는
 * 명령이 도는 중이다. pty 에 닿지 못하거나 레코드가 없으면 실행 중이 아닌 것으로 본다.
 */
export async function runningProgram(
  pane: PaneTarget,
  deps: ProgramDeps
): Promise<{ name: string | null } | null> {
  if (pane.command?.length) return { name: pane.command[0] }
  try {
    const [fg, shell] = await Promise.all([deps.foreground(pane.ptyId), deps.shellPid(pane.ptyId)])
    return shell === null || fg.pid === shell ? null : { name: fg.name }
  } catch {
    return null
  }
}

export async function runningPanes(
  panes: readonly PaneTarget[],
  deps: ProgramDeps
): Promise<number> {
  const found = await Promise.all(panes.map((p) => runningProgram(p, deps)))
  return found.filter(Boolean).length
}

export type Dialog = Pick<MessageBoxOptions, 'message' | 'detail' | 'buttons'>

export function closePaneDialog(name: string | null): Dialog {
  return {
    message: 'Close this pane?',
    detail: name === null ? 'A program is still running in it.' : `\`${name}\` is still running.`,
    buttons: ['Close', 'Cancel']
  }
}

export type Running = { panes: number; jobs: number }

export function runningDialog(
  { panes, jobs }: Running,
  message: string,
  action: string
): Dialog | null {
  if (!panes && !jobs) return null
  const parts = [
    panes && `${panes} ${panes === 1 ? 'pane is' : 'panes are'} running a program`,
    jobs && `${jobs} ${jobs === 1 ? 'job is' : 'jobs are'} running`
  ].filter(Boolean)
  return { message, detail: `${parts.join(' and ')}.`, buttons: [action, 'Cancel'] }
}
