import { parse, TomlError } from 'smol-toml'
import { FONT_FAMILY, FONT_SIZE, LINE_HEIGHT } from '../font'
import { DEFAULT_LAYOUT, parseLayout, type LayoutConfig } from './layout'

export type TerminalFont = { fontFamily: string; fontSize: number; lineHeight: number }

export function sameFont(a: TerminalFont, b: TerminalFont): boolean {
  return a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.lineHeight === b.lineHeight
}

export const DEFAULT_FONT: TerminalFont = {
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT
}

/** `names` 는 사용자가 적은 글꼴 이름이다. `missingFonts`(`fonts.ts`)가 쓸 수 있는지 잴 때 쓴다. */
export type ConfigResult =
  | { ok: false; problem: string }
  | { ok: true; font: TerminalFont; layout: LayoutConfig; names: string[]; warnings: string[] }

// xterm 은 1 보다 작은 `lineHeight` 를 받으면 오류를 던지므로 줄 높이 하한을 1 로 둔다.
const RANGES = {
  'font-size': { key: 'fontSize', min: 8, max: 32 },
  'line-height': { key: 'lineHeight', min: 1, max: 2 }
} as const

const TABLES = {
  terminal: new Set<string>(['font-family', ...Object.keys(RANGES)]),
  layout: new Set<string>(Object.keys(DEFAULT_LAYOUT))
}

export function stepFontSize(size: number, by: 1 | -1): number {
  const { min, max } = RANGES['font-size']
  return Math.min(max, Math.max(min, size + by))
}

/**
 * cell 에 둘 글꼴 크기다. 설정 파일의 크기와 같으면 `undefined` 를 돌려주므로, 그 cell 은 설정 파일의
 * `font-size` 가 바뀌면 따라간다. 소수 크기에 1px 씩 더하고 빼면 부동소수 오차가 쌓이므로 아주 작은 차이는 같은
 * 크기로 본다.
 */
export function fontSizeOverride(size: number, configured: number): number | undefined {
  return Math.abs(size - configured) < 1e-6 ? undefined : size
}

// CSS Fonts 4 의 generic family 키워드다. 따옴표로 감싸면 그 이름의 글꼴을 찾으므로 감싸지 않고 넣는다.
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong'
])

export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILIES.has(name.toLowerCase())
}

type Table = Record<string, unknown>

function isTable(v: unknown): v is Table {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)
}

/**
 * 따옴표를 걷어 낸 이름에 CSS 값을 일찍 끝내거나 escape 하는 문자, 또는 CSS 문자열을 끝내는 줄바꿈 같은 제어
 * 문자가 남거나 빈 이름이 있으면 null 이다.
 */
export function fontNames(input: string): string[] | null {
  const names = input.split(',').map((part) => {
    const name = part.trim()
    const quoted = /^(['"]).*\1$/s.test(name)
    return (quoted ? name.slice(1, -1) : name).trim()
  })
  // eslint-disable-next-line no-control-regex
  return names.every((n) => n && !/["';\\\u0000-\u001f\u007f]/.test(n)) ? names : null
}

export function parseConfig(text: string): ConfigResult {
  let doc: Table
  try {
    doc = parse(text.replace(/^\u{FEFF}/u, ''))
  } catch (err) {
    if (!(err instanceof TomlError)) throw err
    const message = err.message.split('\n')[0].replace(/^Invalid TOML document: /, '')
    return { ok: false, problem: `Line ${err.line}, column ${err.column}: ${message}` }
  }
  const warnings: string[] = []
  for (const key of Object.keys(doc))
    if (!Object.hasOwn(TABLES, key)) warnings.push(`Unknown key ${key}.`)
  const { font, names } = parseTerminal(table(doc, 'terminal', warnings), warnings)
  const layout = parseLayout(table(doc, 'layout', warnings), warnings)
  return { ok: true, font, layout, names, warnings }
}

function table(doc: Table, name: keyof typeof TABLES, warnings: string[]): Table {
  const value = doc[name] ?? {}
  if (!isTable(value)) {
    warnings.push(`${name} must be a table, using the defaults.`)
    return {}
  }
  for (const key of Object.keys(value))
    if (!TABLES[name].has(key)) warnings.push(`Unknown key ${name}.${key}.`)
  return value
}

function parseTerminal(
  terminal: Table,
  warnings: string[]
): { font: TerminalFont; names: string[] } {
  const font = { ...DEFAULT_FONT }
  let names: string[] = []
  const family = terminal['font-family']
  if (typeof family === 'string') {
    const parsed = fontNames(family)
    if (parsed) {
      names = parsed
      const css = parsed.map((n) => (isGenericFamily(n) ? n : `'${n}'`))
      font.fontFamily = [...css, FONT_FAMILY].join(', ')
    } else {
      warnings.push(
        `terminal.font-family can't contain " ' ; \\, control characters or empty names, using the default.`
      )
    }
  } else if (family !== undefined) {
    warnings.push('terminal.font-family must be a string, using the default.')
  }
  for (const [name, { key, min, max }] of Object.entries(RANGES)) {
    const value = terminal[name]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      warnings.push(`terminal.${name} must be a number, using ${font[key]}.`)
      continue
    }
    font[key] = Math.min(max, Math.max(min, value))
    if (font[key] !== value)
      warnings.push(`terminal.${name} = ${value} is outside ${min}–${max}, using ${font[key]}.`)
  }
  return { font, names }
}
