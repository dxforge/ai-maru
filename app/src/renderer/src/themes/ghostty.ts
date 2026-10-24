import { hexColor, type TerminalTheme } from '../../../shared/theme'

const COLOR_KEYS = {
  background: 'background',
  foreground: 'foreground',
  cursor: 'cursor-color',
  cursorText: 'cursor-text',
  selectionBackground: 'selection-background',
  selectionForeground: 'selection-foreground'
} as const
type ColorKey = keyof typeof COLOR_KEYS
const BY_FILE_KEY = new Map<string, ColorKey>(
  Object.entries(COLOR_KEYS).map(([k, file]) => [file, k as ColorKey])
)

/**
 * Ghostty 테마 파일(`key = value` 한 줄씩, 팔레트는 `palette = N=#rrggbb`)을 읽는다. `background`·`foreground` 와
 * 팔레트 0–15 가 모두 있어야 하고, 앱이 읽는 키의 값이 색이 아니면 null 이다. 그 밖의 줄은 지나간다.
 */
export function parseGhosttyTheme(text: string): TerminalTheme | null {
  const ansi: (string | undefined)[] = []
  const colors: Partial<Record<ColorKey, string>> = {}
  for (const raw of text.split('\n')) {
    const eq = raw.indexOf('=')
    if (eq < 0) continue
    const key = raw.slice(0, eq).trim()
    const value = raw.slice(eq + 1).trim()
    if (key === 'palette') {
      const m = /^(\d+)\s*=\s*(\S+)$/.exec(value)
      const index = m ? Number(m[1]) : -1
      const c = m && hexColor(m[2])
      if (!c || index > 15) return null
      ansi[index] = c
      continue
    }
    const colorKey = BY_FILE_KEY.get(key)
    if (!colorKey) continue
    const c = hexColor(value)
    if (!c) return null
    colors[colorKey] = c
  }
  const { background, foreground } = colors
  // 희소 배열의 `some` 은 빈 자리를 건너뛰므로 16 칸으로 펴서 본다.
  const palette = Array.from({ length: 16 }, (_, i) => ansi[i])
  if (!background || !foreground || palette.some((c) => !c)) return null
  return { ...colors, background, foreground, ansi: palette as string[] }
}
