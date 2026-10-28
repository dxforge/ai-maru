import { CLAUDE_APP, type ProgramStatusState } from '../../shared/program-status'

type Command = { running: boolean }

/** 화면에 쓰는 Codicons glyph 의 Symbols Nerd Font 코드 포인트. */
export const ICONS = {
  claude: '\uEC82',
  openai: '\uEC81',
  terminal: '\uEA85',
  branch: '\uEA68',
  expanded: '\uEAB4',
  collapsed: '\uEAB6',
  error: '\uEA87',
  warning: '\uEA6C',
  close: '\uEA76',
  gear: '\uEAF8',
  running: '\uEB2C'
} as const

/** OSC 7501 레코드가 없는 pane 의 아이콘이다. 색은 `commandClass` 가 붙이는 class(`style.css`)가 정한다. */
export function commandIcon(c: Command | undefined): string {
  if (!c) return ICONS.terminal
  return c.running ? ICONS.running : ICONS.error
}

export function commandClass(c: Command | undefined): string {
  if (!c) return ''
  return c.running ? 'command-running' : 'command-failed'
}

// OSC 7501 의 `app` 은 아무 문자열이나 오므로 객체 대신 Map 으로 찾는다. 객체면 `constructor` 같은 키에 prototype 의 값을 돌려준다.
export const AGENT_ICONS: ReadonlyMap<string, string> = new Map([[CLAUDE_APP, ICONS.claude]])

const PROGRAM_ICONS: ReadonlyMap<string, string> = new Map([
  ['claude', ICONS.claude],
  ['codex', ICONS.openai]
])

export function programIcon(argv0: string | undefined): string | undefined {
  return argv0 === undefined
    ? undefined
    : PROGRAM_ICONS.get(argv0.slice(argv0.lastIndexOf('/') + 1))
}

/** 상태 아이콘의 툴팁·aria-label. 화면에는 글자를 쓰지 않는다. 이름은 OSC 7501 의 상태 그대로다. */
export const STATE_LABELS: Record<ProgramStatusState, string> = {
  idle: 'Idle',
  working: 'Working',
  done: 'Done',
  blocked: 'Blocked',
  error: 'Error'
}
