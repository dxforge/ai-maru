import { readonly, ref } from 'vue'
import type { GitHead } from '../../../shared/git'
import type { ScreenState, ScreenWorkspace } from '../../../shared/screen'
import { newSessionId, randomId } from '../../../shared/session'
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
 * `startDir` 는 셸을 띄울 때 요청한 디렉토리, `command` 는 셸이 실행하고 끝날 명령, `cwd` 는 세션이 알려
 * 온 디렉토리, `title` 은 OSC 0/2 로 받은 창 제목이다. `attach` 는 재시작으로 되살린 pane 이 떠 있는
 * 세션에 붙어야 할 때 true 다.
 */
export type Pane = {
  key: number
  sessionId: string
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
export type Workspace = Omit<ScreenWorkspace, 'panes'> & { panes: Pane[] }

export function focusedPane(w: {
  readonly panes: readonly Pane[]
  readonly focused: number
}): Pane {
  return w.panes.find((p) => p.key === w.focused)!
}

export function createWorkspaces(
  readGit: (cwd: string) => Promise<GitHead | null> = async () => null,
  sessionId: () => string = newSessionId,
  workspaceId: () => string = () => randomId('w')
) {
  const list = ref<Workspace[]>([])
  const selectedKey = ref<number | null>(null)
  let nextKey = 0
  let reads = 0
  const lastRead = new Map<number, number>()

  const selected = (): Workspace | undefined => list.value.find((w) => w.key === selectedKey.value)

  function owner(pane: number): Workspace | undefined {
    return list.value.find((w) => w.panes.some((p) => p.key === pane))
  }

  function create(init: Pick<Pane, 'startDir' | 'command'>): Workspace {
    const pane = nextKey++
    const key = nextKey++
    return {
      key,
      id: workspaceId(),
      panes: [{ key: pane, sessionId: sessionId(), ...init }],
      layout: { pane },
      focused: pane
    }
  }

  function open(startDir?: string): void {
    const w = create({ startDir })
    list.value.push(w)
    selectedKey.value = w.key
  }

  /**
   * id 가 `from` 인 workspace 뒤에, 그 workspace 가 앞서 띄운 것들(그것들이 띄운 것 포함)을 지나 workspace 를
   * 넣는다. 그 workspace 가 없으면 목록 끝에 넣는다. 선택과 포커스는 바꾸지 않고, 새 pane 의 key 를 돌려준다.
   */
  function openFrom(from: string | undefined, init: Pick<Pane, 'startDir' | 'command'>): number {
    const w = create(init)
    let at = list.value.findIndex((x) => x.id === from)
    if (at === -1) {
      at = list.value.length
    } else {
      // 띄운 것은 늘 부른 workspace 바로 뒤에 이어 놓이므로, 묶음은 부른 workspace 뒤에서 끊기지 않고 이어진다.
      const caller = list.value[at++].key
      const group = new Set([caller])
      while (at < list.value.length && group.has(list.value[at].openedBy!))
        group.add(list.value[at++].key)
      w.openedBy = caller
    }
    list.value.splice(at, 0, w)
    return w.focused
  }

  function step(by: 1 | -1): number | undefined {
    const n = list.value.length
    if (!n) return undefined
    const i = list.value.findIndex((w) => w.key === selectedKey.value)
    return list.value[(i + by + n) % n].key
  }

  // 닫힌 workspace 가 띄운 것은 그것을 부른 workspace 가 띄운 것으로 옮겨, 처음 부른 workspace 뒤의 묶음에
  // 남긴다. 닫힌 workspace 는 재시작 때 저장되지 않으므로, 그것을 가리킨 채로 두면 재시작 뒤 묶음이 끊긴다.
  function close(key: number): void {
    const i = list.value.findIndex((w) => w.key === key)
    if (i === -1) return
    const [closed] = list.value.splice(i, 1)
    for (const w of list.value) if (w.openedBy === key) w.openedBy = closed.openedBy
    if (selectedKey.value !== key) return
    const next = list.value[i] ?? list.value[i - 1]
    selectedKey.value = next?.key ?? null
  }

  function split(direction: SplitDirection): void {
    const w = selected()
    if (!w) return
    const from = focusedPane(w)
    w.focused = splitFrom(from.key, direction, { startDir: from.cwd ?? from.startDir })
  }

  function splitFrom(
    from: number,
    direction: SplitDirection,
    init: Pick<Pane, 'startDir' | 'command'>,
    full = false
  ): number {
    const w = owner(from)!
    const pane = nextKey++
    w.panes.push({ key: pane, sessionId: sessionId(), ...init })
    w.layout = full
      ? splitRoot(w.layout, pane, direction)
      : splitPane(w.layout, from, pane, direction)
    return pane
  }

  function paneBySession(id: string): Pane | undefined {
    for (const w of list.value) for (const p of w.panes) if (p.sessionId === id) return p
    return undefined
  }

  function closePane(pane: number): void {
    lastRead.delete(pane)
    const w = owner(pane)
    if (!w) return
    if (w.panes.length === 1) return close(w.key)
    const removed = removePane(w.layout, pane)
    if (!removed) return
    w.panes = w.panes.filter((p) => p.key !== pane)
    w.layout = removed.layout
    if (w.focused === pane) w.focused = removed.next
  }

  function focusPane(pane: number): void {
    const w = owner(pane)
    if (w) w.focused = pane
  }

  function moveFocus(direction: FocusDirection, widths: Widths = 'half'): void {
    const w = selected()
    const to = w && neighbor(w.layout, w.focused, direction, widths)
    if (to !== undefined) w!.focused = to
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
  // 읽지 못하면 저장소 밖으로 본다. 이전 디렉토리의 저장소가 새 디렉토리에 남지 않게.
  function readGitFor(key: number, cwd: string): void {
    const read = ++reads
    lastRead.set(key, read)
    void readGit(cwd)
      .catch(() => null)
      .then((git) => setGit(key, read, git ?? undefined))
  }

  function setGit(key: number, read: number, git: GitHead | undefined): void {
    const p = pane(key)
    if (!p || lastRead.get(key) !== read) return
    if (p.git?.repo !== git?.repo || p.git?.branch !== git?.branch) p.git = git
  }

  function refreshSession(sessionId: string): void {
    for (const w of list.value)
      for (const p of w.panes) if (p.sessionId === sessionId && p.cwd) readGitFor(p.key, p.cwd)
  }

  function workspace(key: number): Workspace | undefined {
    return list.value.find((x) => x.key === key)
  }

  function setFontSize(key: number, size: number | undefined): void {
    const w = workspace(key)
    if (w) w.fontSize = size
  }

  function setPaneCols(key: number, cols: number | undefined): void {
    const w = workspace(key)
    if (!w) return
    if (cols === undefined) delete w.paneCols
    else w.paneCols = cols
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
      panes: w.panes.map((p) => ({ ...p, attach: true }))
    }))
    selectedKey.value = screen.selected
    const keys = screen.workspaces.flatMap((w) => [w.key, ...w.panes.map((p) => p.key)])
    nextKey = Math.max(nextKey, ...keys.map((k) => k + 1))
    for (const w of list.value) for (const p of w.panes) if (p.cwd) readGitFor(p.key, p.cwd)
  }

  return {
    list: readonly(list),
    selectedKey: readonly(selectedKey),
    open,
    openFrom,
    split,
    splitFrom,
    paneBySession,
    closePane,
    focusPane,
    moveFocus,
    setCwd,
    setTitle,
    setFontSize,
    setPaneCols,
    snapshot,
    restore,
    refreshSession,
    selected,
    step,
    select: (key: number): void => void (selectedKey.value = key)
  }
}
