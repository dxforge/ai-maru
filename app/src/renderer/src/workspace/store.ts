import { readonly, ref } from 'vue'
import {
  neighbor,
  removePane,
  splitPane,
  type FocusDirection,
  type Layout,
  type SplitDirection
} from './layout'

/** `startDir` 는 셸을 띄울 때 청한 디렉토리, `cwd` 는 세션이 알려 온 디렉토리다. */
export type Pane = { key: number; sessionId?: string; startDir?: string; cwd?: string }

/** `panes` 는 연 순서다. 배치 순서로 그리면 나눌 때마다 터미널의 DOM 이 옮겨진다. */
export type Workspace = { key: number; panes: Pane[]; layout: Layout; focused: number }

export function focusedPane(w: {
  readonly panes: readonly Pane[]
  readonly focused: number
}): Pane {
  return w.panes.find((p) => p.key === w.focused)!
}

export function createWorkspaces() {
  const list = ref<Workspace[]>([])
  const selectedKey = ref<number | null>(null)
  let nextKey = 0

  const selected = (): Workspace | undefined => list.value.find((w) => w.key === selectedKey.value)

  function owner(pane: number): Workspace | undefined {
    return list.value.find((w) => w.panes.some((p) => p.key === pane))
  }

  function open(sessionId?: string, startDir?: string): void {
    const pane = nextKey++
    const key = nextKey++
    list.value.push({
      key,
      panes: [{ key: pane, sessionId, startDir }],
      layout: { pane },
      focused: pane
    })
    selectedKey.value = key
  }

  function close(key: number): void {
    const i = list.value.findIndex((w) => w.key === key)
    if (i === -1) return
    list.value.splice(i, 1)
    if (selectedKey.value !== key) return
    const next = list.value[i] ?? list.value[i - 1]
    selectedKey.value = next?.key ?? null
  }

  function split(direction: SplitDirection): void {
    const w = selected()
    if (!w) return
    const from = focusedPane(w)
    const pane = nextKey++
    w.panes.push({ key: pane, startDir: from.cwd ?? from.startDir })
    w.layout = splitPane(w.layout, from.key, pane, direction)
    w.focused = pane
  }

  function closePane(pane: number): void {
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

  function moveFocus(direction: FocusDirection): void {
    const w = selected()
    const to = w && neighbor(w.layout, w.focused, direction)
    if (to !== undefined) w!.focused = to
  }

  function pane(key: number): Pane | undefined {
    return owner(key)?.panes.find((p) => p.key === key)
  }

  function setSessionId(key: number, id: string): void {
    const p = pane(key)
    if (p) p.sessionId = id
  }

  function setCwd(key: number, cwd: string): void {
    const p = pane(key)
    if (p) p.cwd = cwd
  }

  return {
    list: readonly(list),
    selectedKey: readonly(selectedKey),
    open,
    split,
    closePane,
    focusPane,
    moveFocus,
    setSessionId,
    setCwd,
    selected,
    select: (key: number): void => void (selectedKey.value = key)
  }
}
