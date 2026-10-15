import type { ITheme } from '@xterm/xterm'

export type TerminalTheme = { background: string; foreground: string; ansi: readonly string[] }

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

export function uiColors({ background: bg, foreground: fg, ansi }: TerminalTheme) {
  const light = luminance(bg) > 0.5
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
    working: status(4),
    waiting: status(3),
    accent: ansi[4]
  }
}

export function xtermTheme({ background, foreground, ansi }: TerminalTheme): ITheme {
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
    cursor: foreground,
    scrollbarSliderBackground: foreground + THUMB_ALPHA,
    scrollbarSliderHoverBackground: foreground + '66',
    scrollbarSliderActiveBackground: foreground + '80',
    ...palette
  }
}
