export type Position = 'top' | 'bottom'

/** `header` 는 pane 헤더와 cell 헤더, `palette` 는 명령 팔레트가 놓이는 쪽이다. */
export type LayoutConfig = { header: Position; palette: Position }

export const DEFAULT_LAYOUT: LayoutConfig = { header: 'bottom', palette: 'bottom' }

export function sameLayout(a: LayoutConfig, b: LayoutConfig): boolean {
  return a.header === b.header && a.palette === b.palette
}

export function parseLayout(layout: Record<string, unknown>, warnings: string[]): LayoutConfig {
  const result = { ...DEFAULT_LAYOUT }
  for (const key of Object.keys(DEFAULT_LAYOUT) as (keyof LayoutConfig)[]) {
    const value = layout[key]
    if (value === undefined) continue
    if (value === 'top' || value === 'bottom') result[key] = value
    else warnings.push(`layout.${key} must be "top" or "bottom", using ${DEFAULT_LAYOUT[key]}.`)
  }
  return result
}
