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

function dirLabel(cwd: string | undefined, home: string | undefined): string {
  return cwd !== undefined && cwd === home?.replace(/\/+$/, '') ? '~' : dirName(cwd)
}

export type Label = { name: string; branch?: string }

export function cellLabel(p: Named): Label {
  return p.git ? { name: p.git.repo, branch: p.git.branch } : { name: dirName(p.cwd) }
}

export type SidebarLabel = { name?: string; branch?: string; sub?: string }

// `common` 을 더하기 전에 저장한 화면의 `git` 은 저장소 이름으로 비교한다. 다시 읽으면 `common` 이 생긴다.
function sameRepo(a: GitHead, b: GitHead): boolean {
  return a.common !== undefined && b.common !== undefined
    ? a.common === b.common
    : a.repo === b.repo
}

/** workspace 이름(`base`, 그 workspace 의 첫 cell 의 첫 pane)과 다른 부분만 적는다. */
export function sidebarLabel(p: Named, base: Named | undefined, home?: string): SidebarLabel {
  if (!p.git) return { name: dirLabel(p.cwd, home) }
  const { repo, branch, sub } = p.git
  if (!base?.git || !sameRepo(p.git, base.git)) return { name: repo, branch }
  return { ...(branch === undefined ? { name: repo } : { branch }), ...(sub && { sub }) }
}

/** `home` 을 주면 홈 디렉토리를 `~` 로 쓴다. 사이드바가 pane 줄의 위치(`sidebarLabel`)와 맞추려고 준다. */
export function workspaceName(p: Named, home?: string): string {
  return p.git ? p.git.repo : dirLabel(p.cwd, home)
}

export function windowTitle(label: Label, separator = ' — '): string {
  return label.branch ? `${label.name}${separator}${label.branch}` : label.name
}
