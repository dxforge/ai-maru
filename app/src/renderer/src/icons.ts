import type { ClaudeState } from '../../shared/claude'

/** 화면에 쓰는 Codicons glyph 의 Symbols Nerd Font 코드 포인트. */
export const ICONS = {
  claude: '\uEC82',
  terminal: '\uEA85',
  idle: '\uEA71',
  working: '\uEB19',
  waiting: '\uEAA2'
} as const satisfies Record<'claude' | 'terminal' | ClaudeState, string>
