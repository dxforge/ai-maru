import { PANE_MIN } from '../../../shared/layout'

export type Position = 'top' | 'bottom'

/**
 * `header` 는 pane 헤더와 cell 헤더, `palette` 는 명령 팔레트가 놓이는 쪽이다. `columnCols` 는 columns 보기에서
 * Widen·Narrow Cell 로 폭을 바꾸지 않은 cell 의 pane 폭(열 수)이다.
 */
export type LayoutConfig = { header: Position; palette: Position; columnCols: number }

export const DEFAULT_LAYOUT: LayoutConfig = { header: 'bottom', palette: 'bottom', columnCols: 80 }

const POSITION_KEYS = ['header', 'palette'] as const

const RANGES = {
  'column-cols': { key: 'columnCols', min: PANE_MIN.cols, max: 500, integer: true }
} as const

export const LAYOUT_KEYS: readonly string[] = [...POSITION_KEYS, ...Object.keys(RANGES)]

export type NumberRange = { min: number; max: number; integer?: boolean }

export function parseNumber(
  value: unknown,
  label: string,
  fallback: number,
  { min, max, integer }: NumberRange,
  warnings: string[]
): number {
  const valid = integer ? Number.isInteger(value) : Number.isFinite(value)
  if (typeof value !== 'number' || !valid) {
    warnings.push(`${label} must be ${integer ? 'an integer' : 'a number'}, using ${fallback}.`)
    return fallback
  }
  const clamped = Math.min(max, Math.max(min, value))
  if (clamped !== value)
    warnings.push(`${label} = ${value} is outside ${min}–${max}, using ${clamped}.`)
  return clamped
}

export function sameLayout(a: LayoutConfig, b: LayoutConfig): boolean {
  return a.header === b.header && a.palette === b.palette && a.columnCols === b.columnCols
}

export function parseLayout(layout: Record<string, unknown>, warnings: string[]): LayoutConfig {
  const result = { ...DEFAULT_LAYOUT }
  for (const key of POSITION_KEYS) {
    const value = layout[key]
    if (value === undefined) continue
    if (value === 'top' || value === 'bottom') result[key] = value
    else warnings.push(`layout.${key} must be "top" or "bottom", using ${DEFAULT_LAYOUT[key]}.`)
  }
  for (const [name, { key, ...range }] of Object.entries(RANGES)) {
    const value = layout[name]
    if (value === undefined) continue
    result[key] = parseNumber(value, `layout.${name}`, result[key], range, warnings)
  }
  return result
}
