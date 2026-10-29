import { PANE_MAX_COLS, PANE_MIN } from '../../../shared/layout'

export type Position = 'top' | 'bottom'

/**
 * `header` 는 pane 헤더와 cell 헤더, `palette` 는 명령 팔레트가 놓이는 쪽이다. `columnCols` 는 columns 보기에서
 * Widen·Narrow Cell 로 폭을 바꾸지 않은 cell 의 pane 폭(열 수)이다. `columnStep` 은 두 명령이 한 번에 바꾸는 열 수다.
 */
export type LayoutConfig = {
  header: Position
  palette: Position
  columnCols: number
  columnStep: number
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  header: 'bottom',
  palette: 'bottom',
  columnCols: 80,
  columnStep: 20
}

const POSITION_KEYS = ['header', 'palette'] as const

const RANGES = {
  'column-cols': { key: 'columnCols', min: PANE_MIN.cols, max: PANE_MAX_COLS, integer: true },
  // `stepPaneCols` 는 다음 폭이 범위 밖이면 그대로 두므로, 이보다 큰 간격으로는 범위 안 어느 폭에서도 움직이지 않는다.
  'column-step': { key: 'columnStep', min: 1, max: PANE_MAX_COLS - PANE_MIN.cols, integer: true }
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
  return (Object.keys(a) as (keyof LayoutConfig)[]).every((k) => a[k] === b[k])
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
