import { computed, reactive, readonly, ref, shallowRef } from 'vue'
import type { CanvasItem, CanvasOwner } from '../../../shared/canvas'
import {
  cellLabel,
  focusedPane,
  workspaceName,
  type Label,
  type Named
} from '../../../shared/names'
import { firstHeading } from './markdown'

// `at` 은 renderer 가 문서를 받은 시각(ms)이다. 같은 id 로 고친 문서는 고친 시각이다.
export type CanvasEntry = CanvasOwner &
  (
    | { id: string; kind: 'markdown'; title: string; at: number; text: string }
    | { id: string; kind: 'image'; title: string; at: number; url: string }
  )

/** cell 의 `workspace / cell` 이름. workspace 는 cell 이 지금 속한 것이다. */
export type CellName = { workspace: string; cell: Label }

export type OpenCell = { id: string; name: CellName }

/** 「현재 cell」 은 선택된 cell 을 따라가고, `{ cell }` 은 그 cell 에 고정한다. */
export type CanvasView = 'current' | 'all' | { cell: string }

export type CellChoice = OpenCell & { closed: boolean }

type NamedWorkspace = {
  name?: string
  cells: readonly { id: string; focused: number; panes: readonly (Named & { key: number })[] }[]
}

export function openCells(workspaces: readonly NamedWorkspace[], home?: string): OpenCell[] {
  return workspaces.flatMap((w) => {
    const workspace = workspaceName(w, home)
    return w.cells.map((c) => ({ id: c.id, name: { workspace, cell: cellLabel(focusedPane(c)) } }))
  })
}

export type Canvas = ReturnType<typeof createCanvas>

export function createCanvas(now: () => number = Date.now) {
  const docs = ref<CanvasEntry[]>([])
  const expanded = reactive(new Set<string>())
  const open = ref(false)

  // 붙잡은 동안(`hold(true)`) 온 문서는 목록에 넣지 않고 쌓아 둔다. 목록이 바뀌면 커서 아래의 버튼이 다른 문서의
  // 것으로 바뀌어, 누르려던 것과 다른 문서가 지워지기 때문이다. 닫힌 패널은 누를 수 없으므로 붙잡지 않는다.
  let holding = false
  const held = ref<CanvasEntry[]>([])

  const view = ref<CanvasView>('current')
  const cells = shallowRef<readonly OpenCell[]>([])
  const current = ref<string>()
  // 닫힌 cell 은 workspace 목록에서 빠져 이름을 구할 수 없으므로, 빠지기 직전의 이름을 기억해 둔다.
  const closed = reactive(new Map<string, CellName>())

  /** 열린 cell 과 선택된 cell 이 바뀔 때마다 부른다. */
  function sync(next: { cells: readonly OpenCell[]; current?: string }): void {
    const ids = new Set(next.cells.map((c) => c.id))
    for (const c of cells.value) if (!ids.has(c.id)) closed.set(c.id, c.name)
    for (const id of ids) closed.delete(id)
    cells.value = next.cells
    current.value = next.current
  }

  /** 보기가 고른 cell 의 id. 「모든 문서」 면 null, 「현재 cell」 인데 선택된 cell 이 없으면 undefined 다. */
  const viewCell = computed((): string | null | undefined => {
    const v = view.value
    if (v === 'all') return null
    return v === 'current' ? current.value : v.cell
  })

  function inView(entry: CanvasEntry): boolean {
    const cell = viewCell.value
    return cell === null || (cell !== undefined && entry.cell === cell)
  }

  function nameOf(cell: string | undefined): CellName | undefined {
    if (cell === undefined) return undefined
    return cells.value.find((c) => c.id === cell)?.name ?? closed.get(cell)
  }

  // 고른 닫힌 cell 은 문서가 모두 지워져도 남긴다. 빠지면 드롭다운에 체크된 항목이 없어지기 때문이다.
  const choices = computed((): CellChoice[] => [
    ...cells.value.map((c) => ({ ...c, closed: false })),
    ...[...closed]
      .filter(([id]) => id === viewCell.value || docs.value.some((d) => d.cell === id))
      .map(([id, name]) => ({ id, name, closed: true }))
  ])

  function put(item: CanvasItem): void {
    const entry = toEntry(item, now())
    if (holding) return void held.value.push(entry)
    place(entry)
    open.value = true
  }

  function flush(): void {
    for (const entry of held.value.splice(0)) place(entry)
  }

  function hold(on: boolean): void {
    holding = on && open.value
    if (!holding) flush()
  }

  // 닫으면서 쌓인 문서는 목록에 넣기만 하고 패널은 열지 않는다. put 처럼 패널을 열면 닫은 패널이 바로 다시 열리기 때문이다.
  function setOpen(on: boolean): void {
    if (!on) {
      holding = false
      flush()
    }
    open.value = on
  }

  // 바뀐 문서는 위로 올리지 않는다. 올리면 보낸 쪽이 문서를 고칠 때마다 목록 순서가 바뀌기 때문이다.
  function place(entry: CanvasEntry): void {
    const { id } = entry
    const i = docs.value.findIndex((d) => d.id === id)
    if (i === -1) {
      docs.value.unshift(entry)
      expanded.add(id)
    } else {
      release(docs.value[i])
      docs.value[i] = entry
    }
  }

  function remove(id: string): void {
    const i = docs.value.findIndex((d) => d.id === id)
    if (i === -1) return
    release(docs.value[i])
    docs.value.splice(i, 1)
    expanded.delete(id)
  }

  function expand(id: string, on: boolean): void {
    if (on) expanded.add(id)
    else expanded.delete(id)
  }

  return {
    docs: readonly(docs),
    shown: computed(() => docs.value.filter(inView)),
    expanded: readonly(expanded),
    open: readonly(open),
    held: computed(() => held.value.filter(inView).length),
    view: readonly(view),
    viewCell,
    choices,
    nameOf,
    isClosed: (cell: string): boolean => closed.has(cell),
    sync,
    choose: (v: CanvasView): void => void (view.value = v),
    put,
    hold,
    flush,
    remove,
    expand,
    expandAll: (): void => docs.value.filter(inView).forEach((d) => expanded.add(d.id)),
    collapseAll: (): void => docs.value.filter(inView).forEach((d) => expanded.delete(d.id)),
    close: (): void => setOpen(false),
    reopen: (): void => setOpen(true),
    toggle: (): void => setOpen(!open.value)
  }
}

function release(entry: CanvasEntry): void {
  if (entry.kind === 'image') URL.revokeObjectURL(entry.url)
}

function toEntry(item: CanvasItem, at: number): CanvasEntry {
  const owner: CanvasOwner = {
    ...(item.pty === undefined ? {} : { pty: item.pty }),
    ...(item.cell === undefined ? {} : { cell: item.cell })
  }
  if (item.kind === 'markdown') {
    const title = item.title || firstHeading(item.text) || 'Markdown'
    return { id: item.id, kind: 'markdown', title, at, text: item.text, ...owner }
  }
  const url = URL.createObjectURL(new Blob([item.bytes as BlobPart], { type: item.mime }))
  return { id: item.id, kind: 'image', title: item.name, at, url, ...owner }
}

export function clockTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
