import type { ITheme } from '@xterm/xterm'

export type TerminalTheme = {
  background: string
  foreground: string
  ansi: readonly string[]
  cursor?: string
  cursorText?: string
  selectionBackground?: string
  selectionForeground?: string
}

/**
 * renderer 가 적용한 테마 가운데 main 이 창에 반영하는 것이다. `background` 는 창 배경색, `mode` 는
 * `nativeTheme.themeSource` 다. 라이트·다크 테마를 모두 적었으면 `system` 이어야 renderer 의
 * `prefers-color-scheme` 이 OS 를 따른다.
 */
export type WindowTheme = { background: string; mode: 'light' | 'dark' | 'system' }

const HEX_COLOR = /^#?([0-9a-f]{6})$/i
const MODES = new Set(['light', 'dark', 'system'])

export function hexColor(value: string): string | null {
  const m = HEX_COLOR.exec(value.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

export function parseWindowTheme(v: unknown): WindowTheme | null {
  if (typeof v !== 'object' || v === null) return null
  const { background, mode } = v as Record<string, unknown>
  const color = typeof background === 'string' ? hexColor(background) : null
  if (!color || typeof mode !== 'string' || !MODES.has(mode)) return null
  return { background: color, mode: mode as WindowTheme['mode'] }
}

/** Ghostty 의 기본값 — 배경·글자는 `src/config/Config.zig`, 팔레트(Tomorrow Night)는 `src/terminal/color.zig`. */
export const GHOSTTY: TerminalTheme = {
  background: '#282c34',
  foreground: '#ffffff',
  ansi: [
    '#1d1f21',
    '#cc6666',
    '#b5bd68',
    '#f0c674',
    '#81a2be',
    '#b294bb',
    '#8abeb7',
    '#c5c8c6',
    '#666666',
    '#d54e53',
    '#b9ca4a',
    '#e7c547',
    '#7aa6da',
    '#c397d8',
    '#70c0b1',
    '#eaeaea'
  ]
}

type Rgb = [number, number, number]

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hex(c: Rgb): string {
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return hex(x.map((v, i) => v + (y[i] - v) * t) as Rgb)
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THUMB_ALPHA = '33'

/** 아이콘처럼 글자가 아닌 그래픽이 배경과 구분되는 대비(WCAG 1.4.11). */
const MIN_CONTRAST = 3

export function isLight({ background }: TerminalTheme): boolean {
  return luminance(background) > 0.5
}

export function uiColors(theme: TerminalTheme) {
  const { background: bg, foreground: fg, ansi } = theme
  const light = isLight(theme)
  const side = light ? mix(bg, fg, 0.035) : mix(bg, '#000000', 0.22)
  const raised = mix(bg, fg, 0.05)
  const hdrFocus = mix(bg, fg, 0.1)
  const status = (i: number): string =>
    [side, bg, raised, hdrFocus].every((s) => contrast(ansi[i], s) >= MIN_CONTRAST)
      ? ansi[i]
      : ansi[i + 8]
  return {
    ground: bg,
    fg,
    side,
    raised,
    hdrFocus,
    // 어느 면 위에서나 쓰도록 글자색을 반투명하게 겹친다.
    hover: fg + '0f',
    selected: fg + '1f',
    line: mix(bg, fg, 0.13),
    muted: mix(fg, bg, 0.35),
    faint: mix(fg, bg, 0.55),
    dim: bg + '73',
    thumb: fg + THUMB_ALPHA,
    track: fg + '0f',
    working: status(4),
    waiting: status(3),
    error: status(1),
    accent: ansi[4]
  }
}

export function xtermTheme(theme: TerminalTheme): ITheme {
  const { background, foreground, ansi } = theme
  const names = [
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'brightBlack',
    'brightRed',
    'brightGreen',
    'brightYellow',
    'brightBlue',
    'brightMagenta',
    'brightCyan',
    'brightWhite'
  ]
  const palette = Object.fromEntries(ansi.map((c, i) => [names[i], c]))
  return {
    background,
    foreground,
    cursor: theme.cursor ?? foreground,
    cursorAccent: theme.cursorText,
    selectionBackground: theme.selectionBackground,
    selectionForeground: theme.selectionForeground,
    scrollbarSliderBackground: foreground + THUMB_ALPHA,
    scrollbarSliderHoverBackground: foreground + '66',
    scrollbarSliderActiveBackground: foreground + '80',
    // 스크롤바 폭을 정하면 xterm 이 overview ruler canvas 를 붙인다. 이 canvas 는 왼쪽 끝에 이 색(기본 흰색)으로
    // 선을 긋는다. decoration 을 쓰지 않으므로 선을 투명하게 한다.
    overviewRulerBorder: 'transparent',
    ...palette
  }
}
