import { SHELL } from '../../shared/launcher'
import { CLAUDE_APP, type ProgramStatusState } from '../../shared/program-status'
import { commandArgv } from './config/launcher'

type Command = { running: boolean }

export type AgentLogo = 'claude' | 'codex' | 'kiro'

/** OSC 7501 레코드가 없는 pane 의 아이콘이다. `failed` 는 실패한 명령이 남아 있는 pane 이다. */
export type CommandIcon = 'terminal' | 'running' | 'failed'

export type PaneIcon =
  { agent: AgentLogo } | { state: ProgramStatusState } | { command: CommandIcon }

/** 색은 `commandClass` 가 붙이는 class(`style.css`)가 정한다. */
export function commandIcon(c: Command | undefined): CommandIcon {
  if (!c) return 'terminal'
  return c.running ? 'running' : 'failed'
}

export function commandClass(c: Command | undefined): string {
  if (!c) return ''
  return c.running ? 'command-running' : 'command-failed'
}

/** `app` 은 OSC 7501 레코드의 `app`, `argv0` 은 launcher 명령의 실행 파일 이름이다. */
const AGENTS: readonly { app: string; argv0: string; icon: AgentLogo }[] = [
  { app: CLAUDE_APP, argv0: 'claude', icon: 'claude' },
  { app: 'codex', argv0: 'codex', icon: 'codex' },
  { app: 'kiro-cli', argv0: 'kiro-cli', icon: 'kiro' }
]

// OSC 7501 의 `app` 은 아무 문자열이나 오므로 객체 대신 Map 으로 찾는다. 객체면 `constructor` 같은 키에 prototype 의 값을 돌려준다.
export const AGENT_ICONS: ReadonlyMap<string, AgentLogo> = new Map(
  AGENTS.map((a) => [a.app, a.icon])
)

const PROGRAM_ICONS: ReadonlyMap<string, AgentLogo> = new Map(AGENTS.map((a) => [a.argv0, a.icon]))

/** launcher 의 명령 줄 아이콘이다. 셸은 셸 아이콘, 표에 있는 agent 는 그 로고, 그 밖의 명령은 도는 명령 아이콘이다. */
export function launcherIcon(command: string): 'terminal' | 'running' | AgentLogo {
  if (command === SHELL) return 'terminal'
  const argv0 = commandArgv(command)[0]
  if (argv0 === undefined) return 'running'
  return PROGRAM_ICONS.get(argv0.slice(argv0.lastIndexOf('/') + 1)) ?? 'running'
}
