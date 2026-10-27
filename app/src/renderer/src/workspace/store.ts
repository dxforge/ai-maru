import { readonly, ref } from 'vue'
import { sameGitHead, type GitHead } from '../../../shared/git'
import { focusedPane, startDirOf } from '../../../shared/names'
import type { ProgramStatusState } from '../../../shared/program-status'
import type { PtyState } from '../../../shared/pty-state'
import type { ScreenCell, ScreenState, ScreenWorkspace } from '../../../shared/screen'
import { newPtyId, randomId } from '../../../shared/pty'
import { paneCwd, paneTitle } from './display'
import {
  neighbor,
  removePane,
  splitPane,
  splitRoot,
  type FocusDirection,
  type SplitDirection,
  type Widths
} from './layout'

/**
 * `startDir` 는 셸을 띄울 때 요청한 디렉토리, `command` 는 셸이 실행하고 끝날 명령이다. `cwd`·`title` 은 화면에 보일
 * 값으로 `paneCwd`·`paneTitle` 이 고르고, `restoredCwd`·`restoredTitle`·`spawnedCwd` 는 그 재료다. `attach` 는
 * 재시작으로 되살린 pane 이 떠 있는 pty 에 붙어야 할 때 true 다.
 */
export type Pane = {
  key: number
  ptyId: string
  startDir?: string
  command?: readonly string[]
  cwd?: string
  title?: string
  git?: GitHead
  attach?: boolean
  restoredCwd?: string
  restoredTitle?: string
  spawnedCwd?: string
}

/** snapshot 에 싣지 않는 pane 필드. `attach` 는 `restore` 가 정하고, 나머지는 화면에 보이는 `cwd`·`title` 의 재료다. */
const UNSAVED = new Set(['attach', 'restoredCwd', 'restoredTitle', 'spawnedCwd'])

export type WorkspacesScreen = Pick<ScreenState, 'workspaces' | 'selected'>

/**
 * `panes` 는 연 순서다. 배치 순서로 그리면 나눌 때마다 터미널의 DOM 이 옮겨진다. `fontSize` 는 ⌘+ / ⌘- 로 바꾼
 * 터미널 글꼴 크기다. 없으면 설정 파일의 `font-size` 를 따른다.
 */
export type Cell = Omit<ScreenCell, 'panes'> & { panes: Pane[] }

/** `cells` 는 비지 않는다 — 마지막 cell 이 닫히면 workspace 도 닫힌다. */
export type Workspace = Omit<ScreenWorkspace, 'cells'> & { cells: Cell[] }

export { focusedPane, startDirOf }

export type PlaceError = 'no_caller' | 'no_cell' | 'other_workspace'

/** pty 상태 저장소(`pty/states.ts`)에서 store 가 읽는 것. */
export type PaneSource = {
  get(ptyId: string): PtyState | undefined
  /** 루트 OSC 7501 레코드의 상태 */
  state(ptyId: string): ProgramStatusState | undefined
  isOld(ptyId: string): boolean
}

export function createWorkspaces(
  readGit: (cwd: string) => Promise<GitHead | null> = async () => null,
  source: PaneSource = { get: () => undefined, state: () => undefined, isOld: () => false },
  ptyId: () => string = newPtyId,
  cellId: () => string = () => randomId('c'),
  workspaceId: () => string = () => randomId('w')
) {
  const list = ref<Workspace[]>([])
  const selectedKey = ref<number | null>(null)
  let nextKey = 0
  let reads = 0
  const lastRead = new Map<number, number>()
  const seen = new Map<number, { reports?: number; program?: ProgramStatusState }>()

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

  function createCell(init: Pick<Pane, 'startDir' | 'command'>): Cell {
    const pane = nextKey++
    const key = nextKey++
    return {
      key,
      id: cellId(),
      panes: [{ key: pane, ptyId: ptyId(), ...init }],
      layout: { pane },
      focused: pane
    }
  }

  function createWorkspace(cell: Cell): Workspace {
    return { key: nextKey++, id: workspaceId(), cells: [cell] }
  }

  function open(startDir?: string): void {
    const c = createCell({ startDir })
    list.value.push(createWorkspace(c))
    selectedKey.value = c.key
  }

  function openCellFrom(
    from: string | undefined,
    init: Pick<Pane, 'startDir' | 'command'>,
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

  function insertCell(w: Workspace, at: number, init: Pick<Pane, 'startDir' | 'command'>): Cell {
    const c = createCell(init)
    w.cells.splice(at, 0, c)
    return c
  }

  function openCell(startDir?: string): void {
    const from = selected()
    if (!from) return open(startDir)
    const w = workspaceOf(from.key)!
    const at = w.cells.findIndex((c) => c.key === from.key) + 1
    selectedKey.value = insertCell(w, at, { startDir }).key
  }

  function step(by: 1 | -1): number | undefined {
    const all = cells()
    const n = all.length
    if (!n) return undefined
    const i = all.findIndex((c) => c.key === selectedKey.value)
    return all[(i + by + n) % n].key
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
   * workspace 를 목록 끝에 둔다. cell 이 하나뿐인 workspace 면 새로 만들지 않고 그 workspace 를 id 그대로 끝으로 옮긴다.
   * 선택·포커스는 바꾸지 않는다. 마지막 cell 이 빠진 workspace 는 닫는다.
   */
  function moveCell(key: number, to: { workspace: number; index: number } | 'new'): void {
    const from = workspaceOf(key)
    if (!from) return
    const at = from.cells.findIndex((c) => c.key === key)
    if (to === 'new') {
      // 새 workspace 를 만들지 않는 것은 `maru mate list` 의 workspace 열과 닫기 확인이 보는 workspace id 를 바꾸지 않기 위해서다.
      if (from.cells.length === 1) return moveWorkspace(from.key, list.value.length)
      list.value.push(createWorkspace(detach(from, at)))
      return
    }
    const dest = list.value.find((w) => w.key === to.workspace)
    // cell 이 하나뿐인 workspace 안에서 그 cell 을 옮기면 아무것도 하지 않는다. `detach` 가 cell 을 빼면서 그 workspace 를
    // 목록에서 지우므로, 그대로 넣으면 cell 이 목록에 없는 workspace 에 들어가 사라지기 때문이다.
    if (!dest || (dest === from && from.cells.length === 1)) return
    dest.cells.splice(dest === from && at < to.index ? to.index - 1 : to.index, 0, detach(from, at))
  }

  function detach(w: Workspace, at: number): Cell {
    const [c] = w.cells.splice(at, 1)
    if (!w.cells.length) list.value.splice(list.value.indexOf(w), 1)
    return c
  }

  /** workspace 를 `index` 번째 workspace 앞(옮기기 전 목록의 자리)으로 옮긴다. */
  function moveWorkspace(key: number, index: number): void {
    const at = list.value.findIndex((w) => w.key === key)
    if (at < 0) return
    const [w] = list.value.splice(at, 1)
    list.value.splice(at < index ? index - 1 : index, 0, w)
  }

  function split(direction: SplitDirection): void {
    const c = selected()
    if (!c) return
    const from = focusedPane(c)
    c.focused = splitFrom(from.key, direction, { startDir: startDirOf(from) })
  }

  function splitFrom(
    from: number,
    direction: SplitDirection,
    init: Pick<Pane, 'startDir' | 'command'>,
    full = false
  ): number {
    const c = owner(from)!
    const pane = nextKey++
    c.panes.push({ key: pane, ptyId: ptyId(), ...init })
    c.layout = full
      ? splitRoot(c.layout, pane, direction)
      : splitPane(c.layout, from, pane, direction)
    return pane
  }

  function paneByPty(id: string): Pane | undefined {
    for (const c of cells()) for (const p of c.panes) if (p.ptyId === id) return p
    return undefined
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

  function moveFocus(direction: FocusDirection, widths: Widths = 'half'): void {
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
  function refresh(p: Pane): boolean {
    const state = source.get(p.ptyId)
    const title = paneTitle({ state, restoredTitle: p.restoredTitle, old: source.isOld(p.ptyId) })
    if (p.title !== title) p.title = title
    const cwd = paneCwd({ ...p, state })
    const before = seen.get(p.key)
    const now = { reports: state?.cwdReports, program: source.state(p.ptyId) }
    seen.set(p.key, now)
    const reported =
      before?.reports !== undefined && now.reports !== undefined && now.reports !== before.reports
    const changed = cwd !== p.cwd
    if (changed) p.cwd = cwd
    if (cwd === undefined || !(changed || reported || now.program !== before?.program)) return false
    readGitFor(p.key, cwd)
    return true
  }

  /** main 이 그 pty 의 상태를 바꾸거나 지웠다. */
  function applyState(ptyId: string): void {
    const p = paneByPty(ptyId)
    if (p) refresh(p)
  }

  function setSpawnedCwd(key: number, cwd: string): void {
    const p = pane(key)
    if (!p) return
    p.spawnedCwd = cwd
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
        if (latest()) setGit(key, git ?? undefined)
      })
  }

  function setGit(key: number, git: GitHead | undefined): void {
    const p = pane(key)
    if (!p) return
    if (!sameGitHead(p.git, git)) p.git = git
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

  // IPC 로 보내므로 JSON 으로 reactive proxy 를 벗긴다. `git` 은 main 이 `maru mate list` 의 이름을 짓는 데 쓴다.
  function snapshot(): WorkspacesScreen {
    const screen = { workspaces: list.value, selected: selectedKey.value }
    return JSON.parse(JSON.stringify(screen, (k, v) => (UNSAVED.has(k) ? undefined : v)))
  }

  function restore(screen: WorkspacesScreen): void {
    list.value = screen.workspaces.map((w) => ({
      ...w,
      cells: w.cells.map((c) => ({
        ...c,
        panes: c.panes.map((p) => ({
          ...p,
          attach: true,
          restoredCwd: p.cwd,
          restoredTitle: p.title
        }))
      }))
    }))
    selectedKey.value = screen.selected
    const keys = screen.workspaces.flatMap((w) => [
      w.key,
      ...w.cells.flatMap((c) => [c.key, ...c.panes.map((p) => p.key)])
    ])
    nextKey = Math.max(nextKey, ...keys.map((k) => k + 1))
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
    split,
    splitFrom,
    pane,
    paneByPty,
    closePane,
    focusPane,
    moveFocus,
    owner,
    workspaceOf,
    applyState,
    setSpawnedCwd,
    setFontSize,
    setPaneCols,
    snapshot,
    restore,
    selected,
    step,
    select: (key: number): void => void (selectedKey.value = key)
  }
}
