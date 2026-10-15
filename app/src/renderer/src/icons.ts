import type { ClaudeState } from '../../shared/claude'

/** 화면에 쓰는 Codicons glyph 의 Symbols Nerd Font 코드 포인트. */
export const ICONS = {
  claude: '\uEC82',
  terminal: '\uEA85',
  branch: '\uEA68',
  idle: '\uEA71',
  working: '\uEB19',
  waiting: '\uEAA2'
} as const satisfies Record<'claude' | 'terminal' | 'branch' | ClaudeState, string>

/** 상태 아이콘의 툴팁·aria-label. 화면에는 글자를 쓰지 않는다. */
export const STATE_LABELS: Record<ClaudeState, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Needs input'
}
