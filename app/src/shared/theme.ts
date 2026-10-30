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

/** focus 안 된 pane 헤더·cell 헤더와 터미널 배경의 대비. 헤더 배경은 섞는 비율이 아니라 이 대비로 정한다. 같은 비율로 섞으면 테마의 밝기에 따라 대비가 달라지기 때문이다. */
export const HEADER_CONTRAST = 1.1

/** focus 된 pane 헤더·cell 헤더와 focus 안 된 헤더의 대비. */
export const FOCUSED_HEADER_CONTRAST = 1.5

/** `base` 를 `toward` 쪽으로 섞어 `base` 와의 대비가 `ratio` 가 되는 색. 끝까지 섞어도 닿지 못하면 null 이다. */
function reachContrast(base: string, toward: string, ratio: number): string | null {
  if (contrast(toward, base) < ratio) return null
  let [lo, hi] = [0, 1]
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2
    if (contrast(mix(base, toward, t), base) < ratio) lo = t
    else hi = t
  }
  return mix(base, toward, hi)
}

/** pane 경계선이 그 선이 지나는 면(터미널, focus 안 된 헤더, focus 된 헤더)과 내야 하는 가장 낮은 대비. 기본 테마(`GHOSTTY`)의 `line` 이 이 세 면과 내는 가장 낮은 대비 1.112:1 에서 온 값이다. 그래서 기본 테마의 pane 경계선은 `line` 과 같은 색이다. */
export const PANE_LINE_CONTRAST = 1.11

function paneLineColor(line: string, fg: string, surfaces: string[]): string {
  // 섞을수록 어떤 면과는 대비가 줄다가 늘어나므로, 이분 탐색 대신 8bit 한 단계씩 찾는다.
  for (let i = 0; i <= 255; i++) {
    const c = mix(line, fg, i / 255)
    if (surfaces.every((s) => contrast(c, s) >= PANE_LINE_CONTRAST)) return c
  }
  return fg
}

function headerColor(bg: string, fg: string, light: boolean): string {
  const [first, second] = light ? [fg, '#000000'] : ['#000000', fg]
  return (
    reachContrast(bg, first, HEADER_CONTRAST) ?? reachContrast(bg, second, HEADER_CONTRAST) ?? bg
  )
}

export function uiColors(theme: TerminalTheme) {
  const { background: bg, foreground: fg, ansi } = theme
  const light = isLight(theme)
  const side = light ? mix(bg, fg, 0.035) : mix(bg, '#000000', 0.22)
  const raised = mix(bg, fg, 0.05)
  const hdr = headerColor(bg, fg, light)
  // focus 된 헤더는 focus 안 된 헤더보다 밝은 쪽으로 섞는다. 밝은 테마는 글자색이 아니라 흰색 쪽으로 섞는다. 글자색 쪽으로 섞으면 focus 된 헤더가 `faint` 글자와 거의 같은 색이 되기 때문이다.
  const away = light ? '#ffffff' : fg
  const hdrFocus = reachContrast(hdr, away, FOCUSED_HEADER_CONTRAST) ?? away
  const status = (i: number): string =>
    [side, bg, raised, hdr, hdrFocus].every((s) => contrast(ansi[i], s) >= MIN_CONTRAST)
      ? ansi[i]
      : ansi[i + 8]
  const line = mix(bg, fg, 0.13)
  return {
    ground: bg,
    fg,
    side,
    raised,
    hdr,
    hdrFocus,
    // 어느 면 위에서나 쓰도록 글자색을 반투명하게 겹친다.
    hover: fg + '0f',
    selected: fg + '1f',
    line,
    paneLine: paneLineColor(line, fg, [bg, hdr, hdrFocus]),
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
