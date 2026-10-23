import { readonly, shallowRef } from 'vue'
import type { ConfigRead } from '../../../shared/config'
import type { Toast } from '../toast/store'
import { DEFAULT_FONT, DEFAULT_HEADER, parseConfig, sameFont } from './terminal'

/**
 * `problem` 이 있으면 설정을 적용하지 못했다. 그때 `first` 면 기본값을, 아니면 앞의 값을 그대로 쓴다.
 */
export type ConfigReport = {
  path: string
  first: boolean
  problem?: string
  warnings: string[]
  names: string[]
}

export function createConfig(first: ConfigRead, report: (r: ConfigReport) => void) {
  const font = shallowRef(DEFAULT_FONT)
  const header = shallowRef(DEFAULT_HEADER)
  let applied = false

  function apply(read: ConfigRead): void {
    const result = read.text === null ? null : parseConfig(read.text)
    const problem = read.error ?? (result && !result.ok ? result.problem : undefined)
    const ok = result?.ok ? result : undefined
    if (problem === undefined) {
      const next = ok?.font ?? DEFAULT_FONT
      // 같은 값이면 터미널이 다시 맞추지 않게 바꾸지 않는다.
      if (!sameFont(font.value, next)) font.value = next
      header.value = ok?.header ?? DEFAULT_HEADER
    }
    report({
      path: read.path,
      first: !applied,
      problem,
      warnings: ok?.warnings ?? [],
      names: ok?.names ?? []
    })
    applied = true
  }

  apply(first)
  return { font: readonly(font), header: readonly(header), apply }
}

export function configToast(r: ConfigReport, missing: string[], detail: string): Toast | null {
  if (r.problem !== undefined)
    return {
      level: 'error',
      title: "Couldn't read config.toml",
      lines: [r.problem, r.first ? 'Using the default settings.' : 'Kept the previous settings.'],
      detail
    }
  const lines = [...r.warnings, ...missing.map((name) => `Font "${name}" is not available.`)]
  if (!lines.length) return null
  return { level: 'warning', title: 'Applied config.toml with warnings', lines, detail }
}
