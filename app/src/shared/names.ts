import type { GitHead } from './git'

/** cell·workspace 이름의 재료. `cwd` 는 그 pane 의 화면에 보이는 cwd 다. */
export type Named = { cwd?: string; git?: GitHead }

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
  const p = w.cells[0]?.panes[0]
  if (p?.git) return p.git.repo
  return dirLabel(p?.cwd ?? w.dir, home)
}

/**
 * 이름 없이 핀을 꽂아 저장한 workspace 를 되살릴 때 굳힐 이름이다. 이전 빌드는 핀 workspace 의 이름을 `name` 에 굳히지 않고
 * 그릴 때마다 지었다. 첫 pane 의 작업 트리 안에 `dir` 이 있을 때만 저장소 이름을 쓰고, 아니면 `dir` 이름을 썼다. 같은 규칙으로
 * 지어야 새 빌드로 바꿔도 이름이 바뀌지 않는다.
 */
export function savedPinnedName(w: NamedWorkspace<Named>, dir: string, home?: string): string {
  const p = w.cells[0]?.panes[0]
  const top = p?.git && p.cwd !== undefined ? gitRootOf(p.cwd, p.git.sub) : undefined
  if (p?.git && top !== undefined && (dir === top || dir.startsWith(`${top}/`))) return p.git.repo
  return dirLabel(dir, home)
}

export function workspaceName(w: NamedWorkspace<Named>, home?: string): string {
  return w.name ?? autoWorkspaceName(w, home)
}

/**
 * 이름 입력창이 포커스를 잃어 확정할 때 저장할 이름이다. 앞뒤 공백을 자른 값이 입력창을 열 때의 이름(`opened`)과 같으면
 * null(취소)이다. workspace 메뉴를 열기만 하고 다른 곳을 누르거나 항목을 골라 닫았을 때, 보이던
 * 자동 이름이 `name` 으로 고정되지 않게 하기 위해서다. Enter 는 같은 이름이어도 확정하므로 이 함수를 거치지 않는다.
 */
export function nameOnFocusLoss(typed: string, opened: string): string | null {
  return typed.trim() === opened ? null : typed
}

/**
 * cell·pane 줄이 `sidebarLabel` 에 넘길 `base` 다. 이름이 첫 pane 의 저장소 이름과 다르면 이름에 저장소 이름이 없을 수
 * 있으므로 `base` 를 두지 않고, 줄마다 저장소 이름을 온전히 적게 한다. 핀을 꽂아 자동 이름을 `name` 에 굳혀도 줄이 바뀌지
 * 않도록, `name` 이 있는지가 아니라 저장소 이름과 같은지를 본다.
 */
export function labelBase<P extends Named>(w: NamedWorkspace<P>): P | undefined {
  const p = w.cells[0]?.panes[0]
  return w.name === undefined || w.name === p?.git?.repo ? p : undefined
}

export function windowTitle(label: Label): string {
  return label.branch ? `${label.name} — ${label.branch}` : label.name
}
