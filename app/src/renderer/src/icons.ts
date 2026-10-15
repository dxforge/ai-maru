import type { ClaudeState } from '../../shared/claude'

/**
 * 화면에 쓰는 Codicons glyph 의 Symbols Nerd Font 코드 포인트. 글꼴은 여기 적힌 것만 담으므로,
 * 더하거나 빼면 `scripts/subset-symbols.sh` 로 `assets/symbols.woff2` 를 다시 만든다.
 */
export const ICONS = {
  claude: '\uEC82',
  terminal: '\uEA85',
  idle: '\uEA71',
  working: '\uEB19',
  waiting: '\uEAA2'
} as const satisfies Record<'claude' | 'terminal' | ClaudeState, string>
