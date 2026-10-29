import { dirName } from './names'
import { programName, shownRecord, type ProgramStatusRecord } from './program-status'
import type { PtyState } from './pty-state'

type Titled = { title?: string; command?: readonly string[] }

/**
 * 제목도 OSC 7501 레코드도 없는 pane 의 이름을 돌려준다. 명령 pane 은 그 명령, 아니면 셸이다. maru-pty 는 `SHELL` 이 비었거나
 * 실행할 수 없으면 `/bin/sh` 를 띄운다. 실행할 수 있는지는 여기서 보지 않는다.
 */
export function fallbackName(p: Pick<Titled, 'command'>, shell: string | undefined): string {
  if (p.command?.length) return dirName(p.command[0])
  return shell ? dirName(shell) : 'sh'
}

export type CommandView =
  | { running: true; text: string; startedAt?: number }
  | { running: false; text: string; exitCode: number }

const SIGINT_EXIT = 130

/**
 * 도는 명령과 실패한 명령만 돌려준다. 종료 코드가 0 이나 130 이면 실패로 보지 않는다. 130(SIGINT)은 dev 서버처럼
 * Ctrl-C 로 끄는 명령이 흔히 내기 때문이다. 보일 OSC 7501 레코드(`shownRecord`)가 있는 pane 은 그 프로그램(claude 등)이
 * 알리는 상태를 쓰므로 명령을 보이지 않는다.
 */
export function commandView(state: PtyState | undefined): CommandView | undefined {
  const c = state?.command
  if (!c?.text || shownRecord(state!.records)) return undefined
  if (c.running) return { running: true, text: c.text, startedAt: c.startedAt ?? undefined }
  if (c.exitCode !== null && c.exitCode !== 0 && c.exitCode !== SIGINT_EXIT)
    return { running: false, text: c.text, exitCode: c.exitCode }
  return undefined
}

/**
 * 레코드가 없는 pane 에서는 명령이 제목보다 먼저다. 프롬프트마다 제목을 찍는 셸 설정(oh-my-zsh 등)에서도 명령이 보이게
 * 하기 위해서다.
 */
export function paneName(
  p: Titled,
  record: Pick<ProgramStatusRecord, 'app'> | undefined,
  shell: string | undefined,
  command?: CommandView
): string {
  if (record) return p.title || programName(record.app)
  return command?.text || p.title || fallbackName(p, shell)
}
