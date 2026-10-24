import type { ProgramStatusState } from '../../shared/program-status'

/** 화면에 쓰는 Codicons glyph 의 Symbols Nerd Font 코드 포인트. */
export const ICONS = {
  claude: '\uEC82',
  terminal: '\uEA85',
  branch: '\uEA68',
  expanded: '\uEAB4',
  collapsed: '\uEAB6',
  error: '\uEA87',
  warning: '\uEA6C',
  close: '\uEA76'
} as const

/** 상태 아이콘의 툴팁·aria-label. 화면에는 글자를 쓰지 않는다. 이름은 OSC 7501 의 상태 그대로다. */
export const STATE_LABELS: Record<ProgramStatusState, string> = {
  idle: 'Idle',
  working: 'Working',
  done: 'Done',
  blocked: 'Blocked',
  error: 'Error'
}
