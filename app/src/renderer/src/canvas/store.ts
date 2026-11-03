import { computed, reactive, readonly, ref, shallowRef } from 'vue'
import type { CanvasItem, CanvasOwner } from '../../../shared/canvas'
import {
  labelBase,
  sidebarLabel,
  workspaceName,
  type Named,
  type SidebarLabel
} from '../../../shared/names'
import { paneName } from '../../../shared/pane-name'
import type { Layout } from '../../../shared/layout'
import { orderedPanes } from '../workspace/store'
import type { RowSource } from '../workspace/sidebarRows'
import { firstHeading } from './markdown'

// `at` 은 renderer 가 문서를 받은 시각(ms)이다. 문서를 고쳐 보냈으면 고친 시각이다.
export type CanvasEntry = CanvasOwner & { key: string } & (
    | { id: string; kind: 'markdown'; title: string; at: number; text: string }
    | { id: string; kind: 'image'; title: string; at: number; url: string }
  )

/**
 * 문서는 (cell, id) 로 구별한다. 같은 cell 이 같은 id 로 보내면 그 문서를 고치고, 다른 cell 이 같은 id 로 보내면 다른
 * 문서다. 링크로 연 파일은 경로가 id 라, 두 cell 이 같은 파일을 열어도 각자의 문서로 남게 하기 위해서다. 소속 없는
 * 문서끼리는 id 만으로 구별한다.
 */
export function docKey(id: string, cell?: string): string {
  return JSON.stringify([cell ?? null, id])
}

/**
 * cell 을 사이드바의 pane 줄처럼 부르는 이름이다. `title`·`place` 는 그 cell 의 사이드바 첫 줄(화면에 놓인 순서로 첫 pane)과 같은 값이고,
 * `more` 는 그 밖의 pane 수다. 포커스된 pane 을 쓰지 않는 것은 pane 을 누를 때마다 이름이 바뀌지 않게 하기 위해서다.
 */
export type CellName = { workspace: string; title: string; more: number; place?: SidebarLabel }

export type OpenCell = { id: string; group: string; name: CellName }

/** 「현재 cell」 은 선택된 cell 을 따라가고, `{ cell }` 은 그 cell 에 고정한다. */
export type CanvasView = 'current' | 'all' | { cell: string }

export type CellChoice = OpenCell & { closed: boolean }

export type ChoiceGroup = { id: string; workspace: string; cells: CellChoice[] }

type NamedPane = Named & {
  key: number
  ptyId?: string
  title?: string
  command?: readonly string[]
}

type NamedWorkspace = {
  id: string
  name?: string
  cells: readonly { id: string; layout: Layout; panes: readonly NamedPane[] }[]
}

export type NameSource = Omit<RowSource, 'notification'>

export function openCells(workspaces: readonly NamedWorkspace[], src: NameSource): OpenCell[] {
  return workspaces.flatMap((w) => {
    const workspace = workspaceName(w, src.home)
    const base = labelBase(w)
    return w.cells.map((c) => {
      const p = orderedPanes(c)[0]
      const title = paneName(p, src.shown(p.ptyId), src.shell, src.command(p.ptyId))
      const place = p.cwd === undefined ? undefined : sidebarLabel(p, base, src.home)
      return {
        id: c.id,
        group: w.id,
        name: { workspace, title, more: c.panes.length - 1, ...(place && { place }) }
      }
    })
  })
}

export function groupChoices(choices: readonly CellChoice[]): ChoiceGroup[] {
  const groups = new Map<string, ChoiceGroup>()
  for (const c of [...choices].sort((a, b) => Number(a.closed) - Number(b.closed))) {
    const g = groups.get(c.group)
    if (g) g.cells.push(c)
    else groups.set(c.group, { id: c.group, workspace: c.name.workspace, cells: [c] })
  }
  return [...groups.values()]
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
  const closed = reactive(new Map<string, OpenCell>())

  /** 열린 cell 과 선택된 cell 이 바뀔 때마다 부른다. */
  function sync(next: { cells: readonly OpenCell[]; current?: string }): void {
    const ids = new Set(next.cells.map((c) => c.id))
    for (const c of cells.value) if (!ids.has(c.id)) closed.set(c.id, c)
    for (const id of ids) closed.delete(id)
    // `App.vue` 의 watch 는 pty 상태에서 이름과 상관없는 값(알림, cwd 보고 횟수 등)이 바뀌어도 다시 부르므로, 이름이 그대로면 목록을 바꾸지 않아 그것을 그리는 화면도 다시 만들지 않는다.
    if (JSON.stringify(next.cells) !== JSON.stringify(cells.value)) cells.value = next.cells
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
    return (cells.value.find((c) => c.id === cell) ?? closed.get(cell))?.name
  }

  // 고른 닫힌 cell 은 문서가 모두 지워져도 남긴다. 빠지면 드롭다운에 체크된 항목이 없어지기 때문이다.
  const choices = computed((): ChoiceGroup[] =>
    groupChoices([
      ...cells.value.map((c) => ({ ...c, closed: false })),
      ...[...closed.values()]
        .filter((c) => c.id === viewCell.value || docs.value.some((d) => d.cell === c.id))
        .map((c) => ({ ...c, closed: true }))
    ])
  )

  // 지금 보기에 들지 않는 문서로는 닫힌 패널을 열지 않는다. 열어도 그 문서는 보이지 않고 터미널 영역만 좁아지기 때문이다.
  function put(item: CanvasItem): void {
    const entry = toEntry(item, now())
    if (holding) return void held.value.push(entry)
    place(entry)
    if (inView(entry)) open.value = true
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
    const { key } = entry
    const i = docs.value.findIndex((d) => d.key === key)
    if (i === -1) {
      docs.value.unshift(entry)
      expanded.add(key)
    } else {
      release(docs.value[i])
      docs.value[i] = entry
    }
  }

  function remove(key: string): void {
    const i = docs.value.findIndex((d) => d.key === key)
    if (i === -1) return
    release(docs.value[i])
    docs.value.splice(i, 1)
    expanded.delete(key)
  }

  function expand(key: string, on: boolean): void {
    if (on) expanded.add(key)
    else expanded.delete(key)
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
    expandAll: (): void => docs.value.filter(inView).forEach((d) => expanded.add(d.key)),
    collapseAll: (): void => docs.value.filter(inView).forEach((d) => expanded.delete(d.key)),
    close: (): void => setOpen(false),
    reopen: (): void => setOpen(true),
    toggle: (): void => setOpen(!open.value)
  }
}

function release(entry: CanvasEntry): void {
  if (entry.kind === 'image') URL.revokeObjectURL(entry.url)
}

function toEntry(item: CanvasItem, at: number): CanvasEntry {
  const owner: CanvasOwner & { key: string } = {
    key: docKey(item.id, item.cell),
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
