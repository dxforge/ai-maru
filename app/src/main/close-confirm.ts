import type { MessageBoxOptions } from 'electron'
import type { PtyCommand } from '../shared/pty-state'
import type { ScreenPane } from '../shared/screen'
import type { Foreground } from './pty'

type PaneTarget = Pick<ScreenPane, 'ptyId' | 'command'>

export type ProgramDeps = {
  foreground: (pty: string) => Promise<Foreground>
  shellPid: (pty: string) => Promise<number | null>
  command: (pty: string) => PtyCommand | null
}

/**
 * 명령 pane 은 `foreground` 를 묻지 않고, maru-pty 가 명령이 끝났다고 알리지 않았으면 실행 중으로 본다. 셸이 명령을
 * exec 해서, foreground 프로세스 그룹이 bash 에서는 셸 pid 로, zsh 에서는 0 으로 나오기 때문이다. 명령이 끝나면
 * pane 도 닫히지만, 런처로 띄운 pane 은 명령이 실패하면 남는다.
 *
 * 셸 pane 이 실행 중인지는 foreground 로 가른다. 셸이 알린 명령 상태는 이름에만 쓴다 — 셸 훅이 빠져 낡은 명령 상태
 * 때문에 확인 창이 잘못 뜨거나 떠야 할 때 뜨지 않는 일을 막기 위해서다.
 */
export async function runningProgram(
  pane: PaneTarget,
  deps: ProgramDeps
): Promise<{ name: string | null } | null> {
  // 사이드바·헤더와 같은 이름을 보이도록 maru-pty 가 띄울 때 채운 명령 텍스트를 먼저 쓴다.
  if (pane.command?.length) {
    const command = deps.command(pane.ptyId)
    if (command?.running === false) return null
    return { name: command?.text ?? pane.command.join(' ') }
  }
  try {
    const [fg, shell] = await Promise.all([deps.foreground(pane.ptyId), deps.shellPid(pane.ptyId)])
    if (shell === null || fg.pid === shell) return null
    const command = deps.command(pane.ptyId)
    return { name: (command?.running && command.text) || fg.name }
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

/** `shutdown` 뒤로는 `graceMs` 동안만 묻지 않는다. 다른 앱이 로그아웃을 멈춰 이 앱이 남으면, 그 뒤의 ⌘Q·창 닫기는 다시 물어야 하기 때문이다. */
export function createQuitPermission(graceMs: number): {
  allow: () => void
  shutdown: () => void
  allowed: () => boolean
} {
  let allowed = false
  let shutdown: ReturnType<typeof setTimeout> | undefined
  return {
    allow: () => {
      allowed = true
    },
    shutdown: () => {
      clearTimeout(shutdown)
      shutdown = setTimeout(() => (shutdown = undefined), graceMs)
    },
    allowed: () => allowed || shutdown !== undefined
  }
}

export type Dialog = Pick<MessageBoxOptions, 'message' | 'detail' | 'buttons'>

export function closePaneDialog(name: string | null): Dialog {
  return {
    message: 'Close this pane?',
    detail: name === null ? 'A program is still running in it.' : `\`${name}\` is still running.`,
    buttons: ['Close', 'Cancel']
  }
}

export function stopJobDialog(name: string): Dialog {
  return {
    message: 'Stop this job?',
    detail: `\`${name}\` is still running.`,
    buttons: ['Stop', 'Cancel']
  }
}

export type Running = { panes: number; jobs: number }

/** `paneNoun` 이 false 면 앞 문장이 pane 을 이미 세었으므로 "1 is running" 처럼 쓴다. */
function runningParts({ panes, jobs }: Running, paneNoun = true): string[] {
  const verb = panes === 1 ? 'is' : 'are'
  const subject = paneNoun ? `${panes === 1 ? 'pane' : 'panes'} ${verb}` : verb
  return [
    panes && `${panes} ${subject} running a program`,
    jobs && `${jobs} ${jobs === 1 ? 'job is' : 'jobs are'} running`
  ].filter((p): p is string => Boolean(p))
}

export function runningDialog(running: Running, message: string, action: string): Dialog | null {
  if (!running.panes && !running.jobs) return null
  const parts = runningParts(running)
  return { message, detail: `${parts.join(' and ')}.`, buttons: [action, 'Cancel'] }
}

export const QUIT_OUTCOMES = ['keep', 'layout', 'end'] as const

/** 버튼 순서는 `QUIT_OUTCOMES` 와 같고 마지막이 Cancel 이다. */
export function quitDialog({ open, panes, jobs }: Running & { open: number }): Dialog {
  const running = runningParts({ panes, jobs }, false)
  const count = `${open} ${open === 1 ? 'pane is' : 'panes are'} open`
  return {
    message: 'Quit AI Maru?',
    detail:
      `${running.length ? `${count}; ${running.join(' and ')}` : count}.\n\n` +
      'Choose Keep terminals to leave the terminals running for the next launch. Choose Keep ' +
      'layout only to end the terminals and reopen the panes with new shells next time. Choose ' +
      'End everything to end the terminals and start with an empty screen next time.',
    buttons: ['Keep terminals', 'Keep layout only', 'End everything', 'Cancel']
  }
}
