import { readonly, ref } from 'vue'
import type { GitHead } from '../../../shared/git'
import type { ScreenCell, ScreenState, ScreenWorkspace } from '../../../shared/screen'
import { newPtyId, randomId } from '../../../shared/pty'
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
 * `startDir` 는 셸을 띄울 때 요청한 디렉토리, `command` 는 셸이 실행하고 끝날 명령, `cwd` 는 pty 가 알려
 * 온 디렉토리, `title` 은 OSC 0/2 로 받은 창 제목이다. `attach` 는 재시작으로 되살린 pane 이 떠 있는
 * pty 에 붙어야 할 때 true 다.
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
}

export type WorkspacesScreen = Pick<ScreenState, 'workspaces' | 'selected'>

/**
 * `panes` 는 연 순서다. 배치 순서로 그리면 나눌 때마다 터미널의 DOM 이 옮겨진다. `fontSize` 는 ⌘+ / ⌘- 로 바꾼
 * 터미널 글꼴 크기다. 없으면 설정 파일의 `font-size` 를 따른다.
 */
export type Cell = Omit<ScreenCell, 'panes'> & { panes: Pane[] }

/** `cells` 는 비지 않는다 — 마지막 cell 이 닫히면 workspace 도 닫힌다. */
export type Workspace = Omit<ScreenWorkspace, 'cells'> & { cells: Cell[] }

export function focusedPane(c: {
  readonly panes: readonly Pane[]
  readonly focused: number
}): Pane {
  return c.panes.find((p) => p.key === c.focused)!
}

export function startDirOf(p: Pick<Pane, 'cwd' | 'startDir'>): string | undefined {
  return p.cwd ?? p.startDir
}

export function createWorkspaces(
  readGit: (cwd: string) => Promise<GitHead | null> = async () => null,
  foregroundCwd: (ptyId: string, cwd?: string) => Promise<string | null> = async () => null,
  ptyId: () => string = newPtyId,
  cellId: () => string = () => randomId('c'),
  workspaceId: () => string = () => randomId('w')
) {
  const list = ref<Workspace[]>([])
  const selectedKey = ref<number | null>(null)
  let nextKey = 0
  let reads = 0
  const lastRead = new Map<number, number>()

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

  /**
   * id 가 `from` 인 cell 의 workspace 에서, 그 cell 뒤에 그 cell 이 앞서 띄운 것들(그것들이 띄운 것 포함)을 지나
   * cell 을 넣는다. 그 cell 이 없으면 새 workspace 를 목록 끝에 만들어 넣는다. 선택과 포커스는 바꾸지 않고,
   * 새 pane 의 key 를 돌려준다.
   */
  function openCellFrom(
    from: string | undefined,
    init: Pick<Pane, 'startDir' | 'command'>
  ): number {
    return insertCell(from, init).focused
  }

  function insertCell(from: string | undefined, init: Pick<Pane, 'startDir' | 'command'>): Cell {
    const c = createCell(init)
    const w = list.value.find((x) => x.cells.some((y) => y.id === from))
    if (!w) {
      list.value.push(createWorkspace(c))
      return c
    }
    let at = w.cells.findIndex((x) => x.id === from)
    // 띄운 것은 늘 부른 cell 바로 뒤에 이어 놓이므로, 묶음은 부른 cell 뒤에서 끊기지 않고 이어진다.
    const caller = w.cells[at++].key
    const group = new Set([caller])
    while (at < w.cells.length && group.has(w.cells[at].openedBy!)) group.add(w.cells[at++].key)
    c.openedBy = caller
    w.cells.splice(at, 0, c)
    return c
  }

  function openCell(startDir?: string): void {
    const from = selected()
    if (!from) return open(startDir)
    selectedKey.value = insertCell(from.id, { startDir }).key
  }

  function step(by: 1 | -1): number | undefined {
    const all = cells()
    const n = all.length
    if (!n) return undefined
    const i = all.findIndex((c) => c.key === selectedKey.value)
    return all[(i + by + n) % n].key
  }

  // 닫힌 cell 이 띄운 것은 그것을 부른 cell 이 띄운 것으로 옮겨, 처음 부른 cell 뒤의 묶음에 남긴다. 닫힌 cell 은
  // 재시작 때 저장되지 않으므로, 그것을 가리킨 채로 두면 재시작 뒤 묶음이 끊긴다.
  function close(key: number): void {
    const w = workspaceOf(key)
    if (!w) return
    const i = cells().findIndex((c) => c.key === key)
    const [closed] = w.cells.splice(
      w.cells.findIndex((c) => c.key === key),
      1
    )
    if (!w.cells.length) list.value.splice(list.value.indexOf(w), 1)
    for (const c of w.cells) if (c.openedBy === key) c.openedBy = closed.openedBy
    if (selectedKey.value !== key) return
    const rest = cells()
    selectedKey.value = (rest[i] ?? rest[i - 1])?.key ?? null
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

  function setCwd(key: number, cwd: string): void {
    const p = pane(key)
    if (!p) return
    p.cwd = cwd
    readGitFor(key, cwd)
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
    if (p.git?.repo !== git?.repo || p.git?.branch !== git?.branch) p.git = git
  }

  /**
   * pane 에서 돌고 있는 프로그램이 옮겨 간 디렉토리(claude 가 들어간 worktree 등)는 셸의 OSC 7 로 오지 않으므로,
   * foreground 프로세스의 cwd 를 물어 그 pane 의 cwd 로 삼는다. 프롬프트에서는 셸이 foreground 이므로, 답은 OSC 7 과 같은 디렉토리다.
   * 지금 cwd 를 함께 넘겨, 같은 디렉토리면 그 경로를 그대로 받는다. 셸이 심볼릭 링크 경로에 있을 때 경로가 실제 경로로 바뀌지 않게 하기 위해서다.
   */
  function refreshPty(ptyId: string): void {
    const p = paneByPty(ptyId)
    if (!p) return
    const latest = claim(p.key)
    void foregroundCwd(ptyId, p.cwd)
      .catch(() => null)
      .then((cwd) => {
        const dir = cwd ?? p.cwd
        if (latest() && dir !== undefined) setCwd(p.key, dir)
      })
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

  function setTitle(key: number, title: string): void {
    const p = pane(key)
    if (p) p.title = title
  }

  // IPC 로 보내므로 JSON 으로 reactive proxy 를 벗긴다. `git` 은 `restore` 가 cwd 로 다시 읽고, `attach` 는
  // `restore` 가 정한다.
  function snapshot(): WorkspacesScreen {
    const screen = { workspaces: list.value, selected: selectedKey.value }
    return JSON.parse(
      JSON.stringify(screen, (k, v) => (k === 'git' || k === 'attach' ? undefined : v))
    )
  }

  function restore(screen: WorkspacesScreen): void {
    list.value = screen.workspaces.map((w) => ({
      ...w,
      cells: w.cells.map((c) => ({ ...c, panes: c.panes.map((p) => ({ ...p, attach: true })) }))
    }))
    selectedKey.value = screen.selected
    const keys = screen.workspaces.flatMap((w) => [
      w.key,
      ...w.cells.flatMap((c) => [c.key, ...c.panes.map((p) => p.key)])
    ])
    nextKey = Math.max(nextKey, ...keys.map((k) => k + 1))
    for (const c of cells()) for (const p of c.panes) if (p.cwd) readGitFor(p.key, p.cwd)
  }

  return {
    list: readonly(list),
    selectedKey: readonly(selectedKey),
    cells,
    open,
    openCell,
    openCellFrom,
    split,
    splitFrom,
    pane,
    paneByPty,
    closePane,
    focusPane,
    moveFocus,
    owner,
    workspaceOf,
    setCwd,
    setTitle,
    setFontSize,
    setPaneCols,
    snapshot,
    restore,
    refreshPty,
    selected,
    step,
    select: (key: number): void => void (selectedKey.value = key)
  }
}
