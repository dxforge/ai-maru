import type { GitHead } from './git'

/** cell·workspace 이름의 재료. `cwd` 는 그 pane 의 화면에 보이는 cwd 다. */
export type Named = { cwd?: string; git?: GitHead }

export function focusedPane<P extends { key: number }>(c: {
  readonly panes: readonly P[]
  readonly focused: number
}): P {
  return c.panes.find((p) => p.key === c.focused)!
}

export function startDirOf(p: { cwd?: string; startDir?: string }): string | undefined {
  return p.cwd ?? p.startDir
}

export function dirName(cwd: string | undefined): string {
  if (cwd === undefined) return 'Shell'
  return cwd.split('/').filter(Boolean).pop() ?? '/'
}

export type Label = { name: string; branch?: string }

export function cellLabel(p: Named): Label {
  return p.git ? { name: p.git.repo, branch: p.git.branch } : { name: dirName(p.cwd) }
}

export function workspaceName(p: Named): string {
  return cellLabel(p).name
}

export function windowTitle(label: Label, separator = ' — '): string {
  return label.branch ? `${label.name}${separator}${label.branch}` : label.name
}
