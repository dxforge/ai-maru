import { GHOSTTY, isLight, type TerminalTheme, type WindowTheme } from '../../../shared/theme'
import { parseGhosttyTheme } from './ghostty'

// 한 번 읽어 두므로 같은 이름은 같은 객체이고, `sameThemeChoice` 는 테마가 바뀌었는지 `===` 로 안다.
const files = import.meta.glob('./ghostty/*', { query: '?raw', import: 'default', eager: true })
const PREFIX = './ghostty/'
const THEMES = new Map<string, TerminalTheme>()
for (const [path, text] of Object.entries(files)) {
  const theme = parseGhosttyTheme(text as string)
  if (theme) THEMES.set(path.slice(PREFIX.length), theme)
}

export function themeNames(): string[] {
  return [...THEMES.keys()]
}

export function themeNamed(name: string): TerminalTheme | undefined {
  return THEMES.get(name)
}

/** `terminal.theme` 의 값이다. `pair` 는 OS 의 라이트·다크 모드마다 다른 테마다. */
export type ThemeChoice =
  | { kind: 'one'; theme: TerminalTheme }
  | { kind: 'pair'; light: TerminalTheme; dark: TerminalTheme }

export const DEFAULT_THEME: ThemeChoice = { kind: 'one', theme: GHOSTTY }

export function sameThemeChoice(a: ThemeChoice, b: ThemeChoice): boolean {
  if (a.kind === 'one') return b.kind === 'one' && a.theme === b.theme
  return b.kind === 'pair' && a.light === b.light && a.dark === b.dark
}

export function activeTheme(choice: ThemeChoice, dark: boolean): TerminalTheme {
  if (choice.kind === 'one') return choice.theme
  return dark ? choice.dark : choice.light
}

export function windowTheme(choice: ThemeChoice, dark: boolean): WindowTheme {
  const theme = activeTheme(choice, dark)
  const mode = choice.kind === 'pair' ? 'system' : isLight(theme) ? 'light' : 'dark'
  return { background: theme.background, mode }
}
