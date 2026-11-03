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

type NamedWorkspace<P> = { name?: string; cells: readonly { panes: readonly P[] }[] }

/** `home` 을 주면 홈 디렉토리를 `~` 로 쓴다. 사이드바가 pane 줄의 위치(`sidebarLabel`)와 맞추려고 준다. */
export function autoWorkspaceName(w: NamedWorkspace<Named>, home?: string): string {
  const p = w.cells[0].panes[0]
  return p.git ? p.git.repo : dirLabel(p.cwd, home)
}

export function workspaceName(w: NamedWorkspace<Named>, home?: string): string {
  return w.name ?? autoWorkspaceName(w, home)
}

/**
 * 즐겨찾기에 넣을 workspace 의 디렉토리다. 자동 이름을 짓는 pane(첫 cell 의 첫 pane)을 연 디렉토리를 쓴다. cd 로 들어간
 * 하위 디렉토리에 끌리지 않게 하기 위해서다. 연 디렉토리를 모르는 pane(앱을 처음 켤 때 디렉토리 없이 연 pane 등)은
 * 화면에 보이는 cwd 로 대신한다.
 */
export function workspaceDir(
  w: NamedWorkspace<{ startDir?: string; cwd?: string }>
): string | undefined {
  const p = w.cells[0].panes[0]
  return p.startDir ?? p.cwd
}

/**
 * 이름 입력창이 포커스를 잃어 확정할 때 저장할 이름이다. 앞뒤 공백을 자른 값이 입력창을 열 때의 이름(`opened`)과 같으면
 * null(취소)이다. workspace 줄을 빠르게 두 번 눌러 고치기가 뜻하지 않게 열렸을 때, 다른 곳을 누르기만 해도 보이던
 * 자동 이름이 `name` 으로 고정되지 않게 하기 위해서다. Enter 는 같은 이름이어도 확정하므로 이 함수를 거치지 않는다.
 */
export function nameOnFocusLoss(typed: string, opened: string): string | null {
  return typed.trim() === opened ? null : typed
}

/**
 * cell·pane 줄이 `sidebarLabel` 에 넘길 `base` 다. 바꾼 이름에는 저장소 이름이 없을 수 있으므로 `base` 를 두지 않고, 줄마다
 * 저장소 이름을 온전히 적게 한다.
 */
export function labelBase<P>(w: NamedWorkspace<P>): P | undefined {
  return w.name === undefined ? w.cells[0].panes[0] : undefined
}

export function windowTitle(label: Label): string {
  return label.branch ? `${label.name} — ${label.branch}` : label.name
}
