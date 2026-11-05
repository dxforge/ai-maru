import type { GitHead } from './git'

/**
 * cell·workspace 이름의 재료. `cwd` 는 그 pane 의 화면에 보이는 cwd 다. `gitRoot` 는 `git` 을 읽은 cwd 에서 구한 작업 트리
 * 최상위 경로다.
 */
export type Named = { cwd?: string; git?: GitHead; gitRoot?: string }

export function focusedPane<P extends { key: number }>(c: {
  readonly panes: readonly P[]
  readonly focused: number
}): P {
  return c.panes.find((p) => p.key === c.focused)!
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

/** `base` 는 workspace 이름을 지은 pane 으로, `labelBase` 가 고른다. 줄에는 workspace 이름과 다른 부분만 적는다. */
export function sidebarLabel(p: Named, base: Named | undefined, home?: string): SidebarLabel {
  if (!p.git) return { name: dirLabel(p.cwd, home) }
  const { repo, branch, sub } = p.git
  if (!base?.git || !sameRepo(p.git, base.git)) return { name: repo, branch }
  return { ...(branch === undefined ? { name: repo } : { branch }), ...(sub && { sub }) }
}

type NamedWorkspace<P> = { name?: string; dir?: string; cells: readonly { panes: readonly P[] }[] }

/**
 * `dir` 이 없거나 첫 pane 의 작업 트리 안에 있을 때만 첫 pane 을 돌려준다. 저장소 여럿을 모은 디렉토리를 workspace 로 연
 * 경우, 첫 cell 이 그 안의 저장소로 `cd` 해도 그 저장소 이름을 workspace 이름으로 쓰지 않기 위해서다.
 */
function repoPane<P extends Named>(w: NamedWorkspace<P>): P | undefined {
  const p = w.cells[0]?.panes[0]
  if (!p || w.dir === undefined) return p
  // `cd` 한 뒤 `git` 을 다시 읽기 전에는 `git.sub` 이 옛 cwd 의 것이라, 새 cwd 로 구하면 작업 트리 안에서도 이름이 깜빡인다.
  const top = p.git && (p.gitRoot ?? (p.cwd && gitRootOf(p.cwd, p.git.sub)))
  return top !== undefined && (w.dir === top || w.dir.startsWith(`${top}/`)) ? p : undefined
}

/**
 * `git` 을 읽은 cwd 에서 `sub` 를 떼어 작업 트리 최상위 경로를 구한다. `sub` 는 심링크를 푼 경로로 세므로, cwd 의
 * 끝이 `sub` 와 다르면 구하지 않는다.
 */
export function gitRootOf(cwd: string, sub: string | undefined): string | undefined {
  if (sub === undefined) return undefined
  // 끝의 `/` 를 뗀다. 저장소가 `/` 면 루트가 빈 문자열이 되어 store 의 `within` 이 모든 절대 경로를 그 안으로 본다.
  const dir = cwd.replace(/\/+$/, '')
  if (sub === '') return dir
  return dir.endsWith(`/${sub}`) ? dir.slice(0, -sub.length - 1) : undefined
}

/**
 * `home` 을 주면 홈 디렉토리를 `~` 로 쓴다. 사이드바가 pane 줄의 위치(`sidebarLabel`)와 맞추려고 준다.
 */
export function autoWorkspaceName(w: NamedWorkspace<Named>, home?: string): string {
  const p = repoPane(w)
  if (p?.git) return p.git.repo
  return dirLabel(w.dir ?? p?.cwd, home)
}

export function workspaceName(w: NamedWorkspace<Named>, home?: string): string {
  return w.name ?? autoWorkspaceName(w, home)
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
export function labelBase<P extends Named>(w: NamedWorkspace<P>): P | undefined {
  return w.name === undefined ? repoPane(w) : undefined
}

export function windowTitle(label: Label): string {
  return label.branch ? `${label.name} — ${label.branch}` : label.name
}
