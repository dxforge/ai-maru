import { readonly, ref } from 'vue'
import { sameGitHead, type GitHead } from '../../../shared/git'
import { samePath } from '../../../shared/launcher'
import { focusedPane, gitRootOf } from '../../../shared/names'
import type { ProgramStatusState } from '../../../shared/program-status'
import type { PtyState } from '../../../shared/pty-state'
import {
  layoutKeys,
  type LayoutPane,
  type SavedLayout,
  type ScreenCell,
  type ScreenState,
  type ScreenWorkspace
} from '../../../shared/screen'
import { newPtyId, randomId } from '../../../shared/pty'
import { paneCwd, paneTitle } from './display'
import {
  neighbor,
  panes,
  removePane,
  splitPane,
  splitRoot,
  type FocusDirection,
  type Layout,
  type SplitDirection,
  type Widths
} from './layout'

/**
 * `startDir` 는 셸이 뜬(또는 뜰) 디렉토리로, pty 상태가 cwd 를 주지 않을 때 `paneCwd` 가 화면 cwd 로 쓴다. 만들 때 요청한 디렉토리에서
 * 시작해, host 가 실제로 띄운 디렉토리(`setSpawnedDir`)나 되살린 cwd(`restore`)로 바뀐다. 셸을 띄울 때(`TerminalView`)와
 * `paneCwd` 만 읽고, 디렉토리가 필요한 나머지는 `cwd` 를 읽는다. `command` 는 셸이 실행하고 끝날 명령이다. `keep` 은
 * 런처로 띄운 pane 에 붙는다. 그 pane 은 명령이 실패해도 닫히지 않고 남는다(`ScreenPane`). `cwd`·`title` 은 화면에 보일
 * 값으로 `paneCwd`·`paneTitle` 이 고르고, `restoredTitle` 은 그 재료다. `cwd` 는 만들 때부터 채워 `startDir` 가 있으면 비지
 * 않는다. `attach` 는 재시작으로 되살린 pane 이 떠 있는 pty 에 붙어야 할 때 true 다. `gitRoot` 는 `git` 을 읽은 cwd 에서
 * 구한 작업 트리 최상위 경로이고, 구하지 못했으면 없다.
 */
export type Pane = {
  key: number
  id: string
  ptyId: string
  startDir?: string
  command?: readonly string[]
  keep?: true
  cwd?: string
  title?: string
  git?: GitHead
  gitRoot?: string
  attach?: boolean
  restoredTitle?: string
}

/**
 * snapshot 에 싣지 않는 pane 필드. `attach` 는 `restore` 가 정하고, `gitRoot` 는 `git` 을 다시 읽으면 생긴다. 나머지는
 * 화면에 보이는 `cwd`·`title` 의 재료다. `startDir` 는 저장하지 않고 `restore` 가 저장된 `cwd` 로 채운다. `cwd` 는
 * `startDir` 가 있으면 비지 않으므로, `cwd` 만 저장해도 잃는 디렉토리가 없다.
 */
const UNSAVED = new Set(['attach', 'gitRoot', 'restoredTitle', 'startDir'])

function within(cwd: string, root: string | undefined): boolean {
  return root !== undefined && (cwd === root || cwd.startsWith(`${root}/`))
}

export type WorkspacesScreen = Pick<ScreenState, 'workspaces' | 'selected'>

/**
 * `panes` 는 연 순서다. 배치 순서로 그리면 나눌 때마다 터미널의 DOM 이 옮겨진다. `fontSize` 는 ⌘+ / ⌘- 로 바꾼
 * 터미널 글꼴 크기다. 없으면 설정 파일의 `font-size` 를 따른다.
 */
export type Cell = Omit<ScreenCell, 'panes'> & { panes: Pane[] }

/**
 * 마지막 cell 이 닫히면 workspace 도 닫힌다. 핀을 꽂은 workspace(`pinned`)만 `cells` 가 빈 채로 남는다. 목록(`list`)에서는
 * 핀 workspace 가 앞에 모인다.
 */
export type Workspace = Omit<ScreenWorkspace, 'cells'> & { cells: Cell[] }

export const holdsFavorite = (c: { favorite?: string }, dir: string): boolean =>
  c.favorite !== undefined && samePath(c.favorite, dir)

/** 핀을 꽂은 workspace 의 수. 핀이 없는 workspace 는 이 자리부터 온다. */
export function pinnedCount(list: readonly { pinned?: true }[]): number {
  const i = list.findIndex((w) => !w.pinned)
  return i < 0 ? list.length : i
}

export { focusedPane }

/**
 * `WorkspaceSidebar.vue` 가 cell 의 pane 을 이 순서로 나열한다. `stepPane` 은 같은 순서를 `panes(layout)` 으로 직접
 * 돌므로 한쪽 순서를 바꾸면 다른 쪽도 같이 바꾼다.
 */
export function orderedPanes<P extends { key: number }>(c: {
  layout: Layout
  panes: readonly P[]
}): P[] {
  return panes(c.layout).map((key) => c.panes.find((p) => p.key === key)!)
}

export type PlaceError = 'no_caller' | 'no_cell' | 'other_workspace'

export type Removed = { workspace: Workspace; at: number }

export type PaneCommand = Pick<Pane, 'command' | 'keep'>

export type PaneInit = Pick<Pane, 'startDir'> & PaneCommand

/** pty 상태 저장소(`pty/states.ts`)에서 store 가 읽는 것. */
export type PaneSource = {
  get(ptyId: string): PtyState | undefined
  /** 루트 OSC 7501 레코드의 상태 */
  rootState(ptyId: string): ProgramStatusState | undefined
  isOld(ptyId: string): boolean
}

export function createWorkspaces(
  readGit: (cwd: string) => Promise<GitHead | null> = async () => null,
  source: PaneSource = { get: () => undefined, rootState: () => undefined, isOld: () => false },
  ptyId: () => string = newPtyId,
  cellId: () => string = () => randomId('c'),
  workspaceId: () => string = () => randomId('w'),
  paneId: () => string = () => randomId('n'),
  home?: string
) {
  const list = ref<Workspace[]>([])
  const selectedKey = ref<number | null>(null)
  let nextKey = 0
  let reads = 0
  const lastRead = new Map<number, number>()
  const seen = new Map<
    number,
    { reports?: number; program?: ProgramStatusState; fromState: boolean }
  >()

  const cells = (): Cell[] => list.value.flatMap((w) => w.cells)

  const cell = (key: number): Cell | undefined => cells().find((c) => c.key === key)

  const selected = (): Cell | undefined =>
    selectedKey.value === null ? undefined : cell(selectedKey.value)

  function owner(pane: number): Cell | undefined {
    return cells().find((c) => c.panes.some((p) => p.key === pane))
  }

  function workspaceOf(cell: number): Workspace | undefined {
    return list.value.find((w) => w.cells.some((c) => c.key === cell))
  }

  const workspaceByKey = (key: number): Workspace | undefined =>
    list.value.find((w) => w.key === key)

  function newPane(init: PaneInit): Pane {
    const p: Pane = { key: nextKey++, id: paneId(), ptyId: ptyId(), ...init }
    refresh(p)
    return p
  }

  function createCell(init: PaneInit): Cell {
    const pane = newPane(init)
    return {
      key: nextKey++,
      id: cellId(),
      panes: [pane],
      layout: { pane: pane.key },
      focused: pane.key
    }
  }

  const isHome = (dir: string): boolean =>
    home !== undefined && dir.replace(/\/+$/, '') === home.replace(/\/+$/, '')

  /**
   * 홈 디렉토리인 `dir` 은 첫 pane 이 홈 밖으로 가면 바꾼다. 앱을 처음 열면 셸이 홈에서 뜨고, 홈으로 고정하면 셸이 어디로
   * 가든 workspace 이름이 늘 `~` 가 되기 때문이다.
   */
  function settleDir(w: Workspace, dir: string | undefined): void {
    if (dir === undefined || (w.dir !== undefined && !isHome(w.dir))) return
    w.dir = dir
  }

  const headOf = (p: Pane): Workspace | undefined =>
    list.value.find((w) => w.cells[0]?.panes[0] === p)

  function createWorkspace(cell: Cell): Workspace {
    return { key: nextKey++, id: workspaceId(), cells: [cell] }
  }

  function open(startDir?: string, extra: PaneCommand = {}): void {
    const c = createCell({ startDir, ...extra })
    list.value.push(createWorkspace(c))
    selectedKey.value = c.key
  }

  function openCellFrom(
    from: string | undefined,
    init: PaneInit,
    place?: { cell: string; before: boolean }
  ): number | PlaceError {
    const w = list.value.find((x) => x.cells.some((y) => y.id === from))
    if (!w) {
      if (place) return 'no_caller'
      const c = createCell(init)
      list.value.push(createWorkspace(c))
      return c.focused
    }
    const { cell, before } = place ?? { cell: from!, before: false }
    const at = w.cells.findIndex((x) => x.id === cell)
    if (at < 0) return cells().some((x) => x.id === cell) ? 'other_workspace' : 'no_cell'
    return insertCell(w, before ? at : at + 1, init).focused
  }

  function insertCell(w: Workspace, at: number, init: PaneInit): Cell {
    const c = createCell(init)
    w.cells.splice(at, 0, c)
    return c
  }

  /**
   * 핀을 꽂으면 핀 묶음 끝으로, 빼면 핀이 없는 묶음 앞으로 옮긴다. cell 이 없는 workspace 는 핀을 빼면 닫는다. 그때는
   * `reinstate` 로 되살릴 수 있게 그 workspace 와 자리를 돌려주고, 아니면 `undefined` 를 돌려준다.
   */
  function togglePin(key: number): Removed | undefined {
    const w = workspaceByKey(key)
    if (!w) return undefined
    const at = list.value.indexOf(w)
    setPinned(w, !w.pinned)
    return list.value.includes(w) ? undefined : { workspace: w, at }
  }

  function reinstate({ workspace: w, at }: Removed): void {
    if (workspaceByKey(w.key)) return
    w.pinned = true
    list.value.splice(Math.min(at, pinnedCount(list.value)), 0, w)
  }

  function setPinned(w: Workspace, on: boolean): void {
    list.value.splice(list.value.indexOf(w), 1)
    if (on) w.pinned = true
    else delete w.pinned
    if (on || w.cells.length) list.value.splice(pinnedCount(list.value), 0, w)
  }

  /**
   * cell 을 즐겨찾기에 넣거나 뺀다. 넣을 때는 첫 pane 의 cwd 를 즐겨찾기 디렉토리로 삼는다.
   * 첫 pane 의 cwd 를 몰라 넣지 못했으면 false 다.
   */
  function toggleFavorite(key: number): boolean {
    const w = workspaceOf(key)
    const c = w?.cells.find((x) => x.key === key)
    if (!w || !c) return true
    if (c.favorite !== undefined) {
      removeFavorite(w.key, c.favorite)
      return true
    }
    const cwd = c.panes[0].cwd
    if (cwd === undefined) return false
    c.favorite = addFavorite(w, cwd)
    return true
  }

  const findFavorite = (w: Workspace, dir: string): string | undefined =>
    w.favorites?.find((f) => samePath(f, dir))

  /**
   * `w` 의 즐겨찾기 끝에 `dir` 을 넣고 그 항목을 돌려준다. 이미 있으면 넣지 않고 있는 항목을 돌려준다. `w` 에 핀이 없으면
   * 꽂는다. 핀이 없으면 즐겨찾기를 맡은 cell 을 닫을 때 workspace 와 함께 즐겨찾기가 사라지기 때문이다.
   */
  function addFavorite(w: Workspace, dir: string): string {
    if (!w.pinned) setPinned(w, true)
    const had = findFavorite(w, dir)
    if (had !== undefined) return had
    w.favorites = [...(w.favorites ?? []), dir]
    return dir
  }

  function dropFavorite(w: Workspace, dir: string): void {
    const rest = w.favorites?.filter((f) => !samePath(f, dir))
    if (rest?.length) w.favorites = rest
    else delete w.favorites
  }

  function removeFavorite(workspace: number, dir: string): void {
    const w = workspaceByKey(workspace)
    if (!w) return
    dropFavorite(w, dir)
    for (const c of w.cells) if (holdsFavorite(c, dir)) delete c.favorite
  }

  /** 사이드바가 닫힌 즐겨찾기 줄을 cell 앞에 그리므로, 첫 자리에 연 cell 은 남은 닫힌 줄 바로 아래에 보인다. */
  function openIn(workspace: number, dir: string, extra: PaneCommand = {}): number | undefined {
    const w = workspaceByKey(workspace)
    if (!w) return undefined
    const c = insertCell(w, 0, { startDir: dir, ...extra })
    const favorite = findFavorite(w, dir)
    if (favorite !== undefined) c.favorite = favorite
    selectedKey.value = c.key
    return c.key
  }

  function discard(key: number): void {
    const w = workspaceByKey(key)
    if (w && !w.cells.length) list.value.splice(list.value.indexOf(w), 1)
  }

  function openCell(startDir?: string, extra: PaneCommand = {}): void {
    const from = selected()
    if (!from) return open(startDir, extra)
    const w = workspaceOf(from.key)!
    const at = w.cells.findIndex((c) => c.key === from.key) + 1
    selectedKey.value = insertCell(w, at, { startDir, ...extra }).key
  }

  function step(by: 1 | -1): number | undefined {
    const all = cells()
    const n = all.length
    if (!n) return undefined
    const i = all.findIndex((c) => c.key === selectedKey.value)
    return all[(i + by + n) % n].key
  }

  function stepPane(by: 1 | -1): number | undefined {
    const c = selected()
    if (c) {
      const order = panes(c.layout)
      const to = order[order.indexOf(c.focused) + by]
      if (to !== undefined) {
        c.focused = to
        return c.key
      }
    }
    const key = step(by)
    if (key === undefined) return undefined
    const next = cell(key)!
    next.focused = panes(next.layout).at(by === 1 ? 0 : -1)!
    return key
  }

  function close(key: number): void {
    const w = workspaceOf(key)
    if (!w) return
    const i = cells().findIndex((c) => c.key === key)
    detach(
      w,
      w.cells.findIndex((c) => c.key === key)
    )
    if (selectedKey.value !== key) return
    const rest = cells()
    selectedKey.value = (rest[i] ?? rest[i - 1])?.key ?? null
  }

  /**
   * cell 을 `to.workspace` 의 `to.index` 번째 cell 앞(옮기기 전 목록의 자리)으로 옮긴다. `'new'` 면 그 cell 하나로 된
   * workspace 를 목록 끝에 둔다. 핀이 없고 cell 이 하나뿐인 workspace 면 새로 만들지 않고 그 workspace 를 id 그대로 끝으로
   * 옮긴다. 다른 workspace 로 옮긴 즐겨찾기 cell 은 즐겨찾기를 가지고 간다. 선택·포커스는 바꾸지 않는다.
   * 마지막 cell 이 빠진 workspace 는 핀이 없으면 닫는다.
   */
  function moveCell(key: number, to: { workspace: number; index: number } | 'new'): void {
    const from = workspaceOf(key)
    if (!from) return
    const at = from.cells.findIndex((c) => c.key === key)
    if (to === 'new') {
      // 새 workspace 를 만들지 않는 것은 닫기 확인이 보는 workspace id 를 바꾸지 않기 위해서다.
      if (from.cells.length === 1 && !from.pinned) return moveWorkspace(from.key, list.value.length)
      const c = detach(from, at)
      const w = createWorkspace(c)
      settleDir(w, c.panes[0].cwd)
      list.value.push(w)
      carry(from, c, w)
      return
    }
    const dest = workspaceByKey(to.workspace)
    // cell 이 하나뿐인 workspace 안에서 그 cell 을 옮기면 아무것도 하지 않는다. 핀이 없으면 `detach` 가 cell 을 빼면서 그
    // workspace 를 목록에서 지우므로, 그대로 넣으면 cell 이 목록에 없는 workspace 에 들어가 사라지기 때문이다.
    if (!dest || (dest === from && from.cells.length === 1)) return
    const c = detach(from, at)
    if (dest !== from) carry(from, c, dest)
    dest.cells.splice(dest === from && at < to.index ? to.index - 1 : to.index, 0, c)
  }

  function carry(from: Workspace, c: Cell, to: Workspace): void {
    const dir = c.favorite
    if (dir === undefined) return
    if (!from.cells.some((x) => holdsFavorite(x, dir))) dropFavorite(from, dir)
    c.favorite = addFavorite(to, dir)
  }

  function detach(w: Workspace, at: number): Cell {
    const [c] = w.cells.splice(at, 1)
    if (w.cells.length) return c
    if (!w.pinned) list.value.splice(list.value.indexOf(w), 1)
    else settleDir(w, c.panes[0].cwd ?? c.panes[0].startDir)
    return c
  }

  /** workspace 를 `index` 번째 workspace 앞(옮기기 전 목록의 자리)으로 옮긴다. 핀 묶음을 넘어가지 않는다. */
  function moveWorkspace(key: number, index: number): void {
    const at = list.value.findIndex((w) => w.key === key)
    if (at < 0) return
    const head = pinnedCount(list.value)
    const to = list.value[at].pinned ? Math.min(index, head) : Math.max(index, head)
    const [w] = list.value.splice(at, 1)
    list.value.splice(at < to ? to - 1 : to, 0, w)
  }

  function rename(key: number, name: string): void {
    const w = workspaceByKey(key)
    if (!w) return
    const trimmed = name.trim()
    if (trimmed) w.name = trimmed
    else delete w.name
  }

  function split(direction: SplitDirection, init?: PaneInit): void {
    const c = selected()
    if (!c) return
    const from = focusedPane(c)
    c.focused = splitFrom(from.key, direction, init ?? { startDir: from.cwd })
  }

  function splitFrom(
    from: number,
    direction: SplitDirection,
    init: PaneInit,
    full = false
  ): number {
    const c = owner(from)!
    const p = newPane(init)
    c.panes.push(p)
    const pane = p.key
    c.layout = full
      ? splitRoot(c.layout, pane, direction)
      : splitPane(c.layout, from, pane, direction)
    return pane
  }

  function cellById(id: string): Cell | undefined {
    return cells().find((c) => c.id === id)
  }

  function paneByPty(id: string): Pane | undefined {
    for (const c of cells()) for (const p of c.panes) if (p.ptyId === id) return p
    return undefined
  }

  /**
   * pty `pty` 가 있는 자리. pane 의 pty 가 아니면 `jobCell`(그 pty 로 도는 job 이 든 cell 의 id)의 cell 이고, 이때
   * `pane` 은 없다.
   */
  function locate(
    pty: string,
    jobCell?: string
  ): { workspace: number; cell: number; pane?: number } | undefined {
    const pane = paneByPty(pty)
    const c = pane ? owner(pane.key) : jobCell === undefined ? undefined : cellById(jobCell)
    const w = c && workspaceOf(c.key)
    return w && { workspace: w.key, cell: c.key, pane: pane?.key }
  }

  function closePane(pane: number): void {
    lastRead.delete(pane)
    seen.delete(pane)
    const c = owner(pane)
    if (!c) return
    if (c.panes.length === 1) return close(c.key)
    const removed = removePane(c.layout, pane)
    if (!removed) return
    c.panes = c.panes.filter((p) => p.key !== pane)
    c.layout = removed.layout
    if (c.focused === pane) c.focused = removed.next
  }

  function focusPane(pane: number): void {
    const c = owner(pane)
    if (c) c.focused = pane
  }

  function moveFocus(direction: FocusDirection, widths: Widths = 'even'): void {
    const c = selected()
    const to = c && neighbor(c.layout, c.focused, direction, widths)
    if (to !== undefined) c!.focused = to
  }

  function pane(key: number): Pane | undefined {
    return owner(key)?.panes.find((p) => p.key === key)
  }

  /**
   * 화면에 보일 cwd 를 다시 고르고, 바뀌었거나 셸이 cwd 를 다시 보고했거나 루트 레코드의 상태가 바뀌었으면 git 을 다시
   * 읽는다. 셸은 프롬프트마다 cwd 를 보고하므로 같은 디렉토리에서 바꾼 branch 가 다음 프롬프트에 반영된다. Claude 를 띄운
   * pane 에는 프롬프트가 뜨지 않아 루트 레코드의 상태가 바뀔 때 읽는다. 한 턴에 `msg` 만 다른 working 보고가 여러 번
   * 오므로 레코드가 올 때마다 읽지는 않는다. 제목도 다시 고른다. git 을 읽었으면 true 다.
   */
  function refresh(p: Pane, keepCwd = false): boolean {
    const state = source.get(p.ptyId)
    const title = paneTitle({ state, restoredTitle: p.restoredTitle, old: source.isOld(p.ptyId) })
    if (p.title !== title) p.title = title
    const cwd = keepCwd && p.cwd !== undefined ? p.cwd : paneCwd({ ...p, state })
    const before = seen.get(p.key)
    const now = {
      reports: state?.cwdReports,
      program: source.rootState(p.ptyId),
      fromState: (state?.foregroundCwd ?? state?.cwd) != null
    }
    seen.set(p.key, now)
    const reported =
      before?.reports !== undefined && now.reports !== undefined && now.reports !== before.reports
    const changed = cwd !== p.cwd
    if (changed) {
      p.cwd = cwd
      const w = headOf(p)
      if (w) settleDir(w, cwd)
    }
    if (cwd === undefined || !(changed || reported || now.program !== before?.program)) return false
    // 작업 트리 밖으로 옮기면 답을 기다리지 않고 이전 저장소를 지운다. reftable 저장소는 `git` 을 실행해 읽으므로 답이
    // 늦게 오고, 그동안 이전 저장소의 이름과 branch 가 보이기 때문이다. 작업 트리 안이면 이름이 깜빡이지 않게 둔다.
    // 이전 cwd 를 셸이나 프로그램이 알리지 않았으면(띄운 경로·되살린 경로) 지우지 않는다. 셸은 띄운 경로를 심링크를 푼
    // 경로나 끝의 `/` 를 뺀 경로로 처음 보고하므로, 옮기지 않았어도 글자가 다를 수 있기 때문이다.
    if (changed && before?.fromState && p.git && !within(cwd, p.gitRoot)) {
      p.git = undefined
      p.gitRoot = undefined
    }
    readGitFor(p.key, cwd)
    return true
  }

  /** main 이 그 pty 의 상태를 바꾸거나 지웠다. */
  function applyState(ptyId: string): void {
    const p = paneByPty(ptyId)
    // main 은 끝난 pty 의 상태를 지우고, 그러면 cwd 는 셸을 띄운 디렉토리로 돌아간다. 그 알림이 셸의 exit 보다 먼저 오면
    // `dir` 이 없거나 홈인 핀 workspace 에서는 cell 을 닫는 `detach` 가 그 디렉토리를 workspace 의 디렉토리로 적으므로, 상태가 지워졌을 때는 마지막 cwd 를 둔다.
    if (p) refresh(p, source.get(ptyId) === undefined)
  }

  /**
   * host 가 셸을 실제로 띄운 디렉토리 `dir` 을 `startDir` 에 넣는다. 요청한 디렉토리가 없거나, 절대 경로가 아니거나,
   * 디렉토리가 아니거나, 들어갈 권한이 없으면 `dir` 은 `$HOME` 이다(`main/pty.ts` 의 `startDir`).
   */
  function setSpawnedDir(key: number, dir: string): void {
    const p = pane(key)
    if (!p) return
    p.startDir = dir
    const w = headOf(p)
    if (w) settleDir(w, dir)
    refresh(p)
  }

  /** 되살린 pane 의 pty 가 없어 host 가 같은 id 로 새 셸을 띄웠다. 앞의 명령과 제목은 그 셸의 것이 아니다. */
  function respawned(key: number): void {
    const p = pane(key)
    if (!p) return
    delete p.command
    delete p.keep
    p.restoredTitle = undefined
    refresh(p)
  }

  // pane 마다 마지막으로 청한 답만 쓴다. 답은 청한 순서대로 오지 않아, 늦게 온 답이 새 답을 덮을 수 있다.
  function claim(key: number): () => boolean {
    const read = ++reads
    lastRead.set(key, read)
    return () => lastRead.get(key) === read
  }

  // 읽지 못하면 저장소 밖으로 본다. 이전 디렉토리의 저장소가 새 디렉토리에 남지 않게 하기 위해서다.
  function readGitFor(key: number, cwd: string): void {
    const latest = claim(key)
    void readGit(cwd)
      .catch(() => null)
      .then((git) => {
        if (latest()) setGit(key, git ?? undefined, cwd)
      })
  }

  function setGit(key: number, git: GitHead | undefined, cwd: string): void {
    const p = pane(key)
    if (!p) return
    if (!sameGitHead(p.git, git)) p.git = git
    const root = git && gitRootOf(cwd, git.sub)
    if (p.gitRoot !== root) p.gitRoot = root
  }

  function setFontSize(key: number, size: number | undefined): void {
    const c = cell(key)
    if (c) c.fontSize = size
  }

  function setPaneCols(key: number, cols: number | undefined): void {
    const c = cell(key)
    if (!c) return
    if (cols === undefined) delete c.paneCols
    else c.paneCols = cols
  }

  // IPC 로 보내므로 JSON 으로 reactive proxy 를 벗긴다. `git` 은 main 이 `maru pane list` 의 이름을 짓는 데 쓴다.
  function snapshot(): WorkspacesScreen {
    const screen = { workspaces: list.value, selected: selectedKey.value }
    return JSON.parse(JSON.stringify(screen, (k, v) => (UNSAVED.has(k) ? undefined : v)))
  }

  /**
   * `ptys` 에 없는 pane 은 저장한 cwd 에서 새 셸을 띄운다. 명령은 다시 돌리지 않고, 앞의 프로그램이 정한 제목도
   * 쓰지 않는다.
   */
  function restore(layout: SavedLayout, ptys: Readonly<Record<number, string>> | null): void {
    const restorePane = (p: LayoutPane): Pane => {
      const pty = ptys?.[p.key]
      if (pty) return { ...p, ptyId: pty, startDir: p.cwd, attach: true, restoredTitle: p.title }
      const fresh: Pane = { key: p.key, id: p.id, ptyId: ptyId(), startDir: p.cwd }
      if (p.git) fresh.git = p.git
      return fresh
    }
    list.value = layout.workspaces.map((w) => {
      const r: Workspace = {
        ...w,
        cells: w.cells.map((c) => ({ ...c, panes: c.panes.map(restorePane) }))
      }
      // pty 에 다시 붙는 pane 은 `setSpawnedDir` 를 부르지 않으므로, `dir` 이 없으면 저장한 cwd 로 정한다.
      settleDir(r, w.cells[0]?.panes[0]?.cwd)
      return r
    })
    selectedKey.value = layout.selected
    nextKey = Math.max(nextKey, ...layoutKeys(layout.workspaces).map((k) => k + 1))
    // main 의 상태가 화면보다 먼저 왔을 수 있다. 저장한 git 은 재시작하는 동안 바뀌었을 수 있어 다시 읽는다.
    for (const c of cells())
      for (const p of c.panes) if (!refresh(p) && p.cwd) readGitFor(p.key, p.cwd)
  }

  return {
    list: readonly(list),
    selectedKey: readonly(selectedKey),
    cells,
    open,
    openCell,
    openCellFrom,
    moveCell,
    moveWorkspace,
    rename,
    togglePin,
    reinstate,
    toggleFavorite,
    removeFavorite,
    openIn,
    discard,
    split,
    splitFrom,
    pane,
    cellById,
    paneByPty,
    locate,
    closePane,
    focusPane,
    moveFocus,
    owner,
    workspaceOf,
    applyState,
    setSpawnedDir,
    respawned,
    setFontSize,
    setPaneCols,
    snapshot,
    restore,
    selected,
    step,
    stepPane,
    select: (key: number): void => void (selectedKey.value = key)
  }
}
