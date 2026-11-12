import { computed, reactive, readonly, ref, shallowRef, toRaw } from 'vue'
import type { CanvasItem, CanvasOwner } from '../../../shared/canvas'
import {
  cellLabel,
  focusedPane,
  workspaceName,
  type Label,
  type Named
} from '../../../shared/names'
import { CodeBody } from './code'
import { MarkdownBody, prepareMarkdown } from './markdown'

// `at` 은 renderer 가 문서를 받은 시각(ms)이다. 문서를 고쳐 보냈으면 고친 시각이다.
export type CanvasEntry = CanvasOwner & { key: string } & (
    | { id: string; kind: 'markdown'; title: string; at: number }
    | { id: string; kind: 'image'; title: string; at: number; url: string }
    | { id: string; kind: 'code'; title: string; at: number }
  )

/**
 * 문서는 (cell, id) 로 구별한다. 같은 cell 이 같은 id 로 보내면 그 문서를 고치고, 다른 cell 이 같은 id 로 보내면 다른
 * 문서다. 링크로 연 파일은 경로가 id 라, 두 cell 이 같은 파일을 열어도 각자의 문서로 남게 하기 위해서다. 소속 없는
 * 문서끼리는 id 만으로 구별한다.
 */
export function docKey(id: string, cell?: string): string {
  return JSON.stringify([cell ?? null, id])
}

/** cell 의 workspace 이름과, 창 제목과 같은 cell 이름. workspace 는 cell 이 지금 속한 것이다. */
export type CellName = { workspace: string; cell: Label }

export type OpenCell = { id: string; group: string; name: CellName }

/**
 * `'current'` 는 선택된 cell 을 따라가고, `{ cell }` 은 그 cell 에 고정한다. `'workspace'` 는 선택된 cell 이 속한
 * workspace 를 따라가고, `{ workspace }` 는 그 workspace 에 고정한다. `{ workspace }` 의 값은 workspace 이름이 아니라
 * workspace id(`OpenCell.group`)다.
 */
export type CanvasView = 'current' | 'workspace' | 'all' | { cell: string } | { workspace: string }

export function viewKey(v: CanvasView): string {
  if (typeof v === 'string') return v
  return 'cell' in v ? `cell:${v.cell}` : `workspace:${v.workspace}`
}

export type CellChoice = OpenCell & { closed: boolean }

export type ChoiceGroup = { id: string; workspace: string; cells: CellChoice[] }

type NamedWorkspace = {
  id: string
  name?: string
  cells: readonly { id: string; focused: number; panes: readonly (Named & { key: number })[] }[]
}

export function openCells(workspaces: readonly NamedWorkspace[], home?: string): OpenCell[] {
  return workspaces.flatMap((w) => {
    const workspace = workspaceName(w, home)
    return w.cells.map((c) => ({
      id: c.id,
      group: w.id,
      name: { workspace, cell: cellLabel(focusedPane(c)) }
    }))
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
  // 고정한 workspace 의 cell 이 모두 닫히거나 다른 workspace 로 옮겨지면 `choices` 에 그 workspace 의 cell 이 없어 이름을
  // 구할 수 없으므로, 이름을 따로 기억해 둔다.
  const workspaceNames = new Map<string, string>()

  /** 열린 cell 과 선택된 cell 이 바뀔 때마다 부른다. */
  function sync(next: { cells: readonly OpenCell[]; current?: string }): void {
    const ids = new Set(next.cells.map((c) => c.id))
    for (const c of cells.value) if (!ids.has(c.id)) closed.set(c.id, c)
    for (const id of ids) closed.delete(id)
    for (const c of next.cells) workspaceNames.set(c.group, c.name.workspace)
    // `App.vue` 의 watch 는 다른 cell 을 고를 때도 `sync` 를 부른다. 목록이 그대로이면 `cells` 를 바꾸지 않는다. 바꾸면 `cells` 를 읽는 `choices` 와 드롭다운이 다시 그려지기 때문이다.
    if (JSON.stringify(next.cells) !== JSON.stringify(cells.value)) cells.value = next.cells
    current.value = next.current
  }

  function cellOf(cell: string | undefined): OpenCell | undefined {
    if (cell === undefined) return undefined
    return cells.value.find((c) => c.id === cell) ?? closed.get(cell)
  }

  const target = computed((): 'all' | { cell: string } | { workspace: string } | undefined => {
    const v = view.value
    if (v === 'current') return current.value === undefined ? undefined : { cell: current.value }
    if (v === 'workspace') {
      const workspace = cellOf(current.value)?.group
      return workspace === undefined ? undefined : { workspace }
    }
    return v
  })

  /** 보기가 고른 cell 의 id. cell 보기가 아니면 null, 「현재 cell」 인데 선택된 cell 이 없으면 undefined 다. */
  const viewCell = computed((): string | null | undefined => {
    const t = target.value
    if (typeof t === 'object' && 'cell' in t) return t.cell
    return view.value === 'current' ? undefined : null
  })

  /** 보기가 고른 workspace 의 id. workspace 보기가 아니면 null, 「현재 workspace」 인데 선택된 cell 이 없으면 undefined 다. */
  const viewWorkspace = computed((): string | null | undefined => {
    const t = target.value
    if (typeof t === 'object' && 'workspace' in t) return t.workspace
    return view.value === 'workspace' ? undefined : null
  })

  function inView(entry: CanvasEntry): boolean {
    const t = target.value
    if (t === undefined) return false
    if (t === 'all') return true
    return 'cell' in t ? entry.cell === t.cell : cellOf(entry.cell)?.group === t.workspace
  }

  // 고른 닫힌 cell 은 문서가 모두 지워져도 남긴다. 빠지면 드롭다운에 체크된 항목이 없어지기 때문이다.
  const choices = computed((): ChoiceGroup[] => {
    const groups = groupChoices([
      ...cells.value.map((c) => ({ ...c, closed: false })),
      ...[...closed.values()]
        .filter((c) => c.id === viewCell.value || docs.value.some((d) => d.cell === c.id))
        .map((c) => ({ ...c, closed: true }))
    ])
    // 고정한 workspace 의 그룹이 없으면(cell 이 모두 닫혔거나 다른 workspace 로 옮겨졌으면) 빈 `ChoiceGroup` 으로
    // 남긴다. 빠지면 드롭다운에 체크된 항목이 없어지기 때문이다. `'workspace'` 보기의 workspace 에는 선택된 열린 cell 이
    // 늘 있어 그 그룹이 빠지지 않는다.
    const fixed = view.value === 'workspace' ? null : viewWorkspace.value
    const name = typeof fixed === 'string' ? workspaceNames.get(fixed) : undefined
    if (typeof fixed === 'string' && name !== undefined && !groups.some((g) => g.id === fixed))
      groups.push({ id: fixed, workspace: name, cells: [] })
    return groups
  })

  // 같은 문서가 강조를 기다리는 동안 다시 오면, 늦게 끝난 앞 것이 새 것을 덮지 않게 마지막으로 온 것만 넣는다.
  const waiting = new Map<string, CanvasEntry>()

  // 코드 문서는 강조를 잠깐 기다렸다 넣는다. 강조가 제때 오면 색 없는 글자를 그렸다가 색을 입히는 깜빡임 없이 처음부터
  // 색 입힌 화면을 그린다.
  function put(item: CanvasItem): void {
    const entry = toEntry(item, now())
    const code = codeBodyOf(entry)
    if (!code) {
      waiting.delete(entry.key)
      return show(entry)
    }
    waiting.set(entry.key, entry)
    void code.ready(CODE_WAIT_MS).then(() => {
      if (waiting.get(entry.key) !== entry) return
      waiting.delete(entry.key)
      show(entry)
    })
  }

  // 지금 보기에 들지 않는 문서로는 닫힌 패널을 열지 않는다. 열어도 그 문서는 보이지 않고 터미널 영역만 좁아지기 때문이다.
  function show(entry: CanvasEntry): void {
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
    viewWorkspace,
    /** 보기가 고른 workspace 의 이름. workspace 보기가 아니거나 선택된 cell 이 없으면 undefined 다. */
    workspaceName: computed((): string | undefined => {
      const ws = viewWorkspace.value
      return typeof ws === 'string' ? choices.value.find((g) => g.id === ws)?.workspace : undefined
    }),
    // 거르는 대상이 같은 보기는 같은 key 다. 따라가는 보기는 지금 따라간 cell 또는 workspace 의 key 를 쓰므로,
    // `'current'` 와 그 cell 에 고정한 `{ cell }` 은 key 가 같다.
    shownKey: computed((): string =>
      target.value === undefined ? viewKey(view.value) : viewKey(target.value)
    ),
    choices,
    nameOf: (cell: string | undefined): CellName | undefined => cellOf(cell)?.name,
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
    toggle: (): void => setOpen(!open.value)
  }
}

function release(entry: CanvasEntry): void {
  if (entry.kind === 'image') URL.revokeObjectURL(entry.url)
}

// 렌더한 HTML 은 문서마다 담아 두어, 카드를 접었다 펴거나 보기를 바꿔 본문을 다시 그릴 때 렌더하지 않는다. 같은 id 로
// 다시 오면 새 entry 라 새로 렌더한다. reactive 한 목록에 넣으면 Vue 가 토큰까지 proxy 로 감싸므로 entry 밖에 둔다.
const bodies = new WeakMap<CanvasEntry, MarkdownBody>()
const codeBodies = new WeakMap<CanvasEntry, CodeBody>()

/** 코드 문서를 넣기 전에 강조를 기다리는 시간. 넘으면 강조 없이 넣고, 받으면 색을 입힌다. */
export const CODE_WAIT_MS = 100

export function bodyOf(entry: CanvasEntry): MarkdownBody | undefined {
  return bodies.get(toRaw(entry))
}

export function codeBodyOf(entry: CanvasEntry): CodeBody | undefined {
  return codeBodies.get(toRaw(entry))
}

function toEntry(item: CanvasItem, at: number): CanvasEntry {
  const owner: CanvasOwner & { key: string } = {
    key: docKey(item.id, item.cell),
    ...(item.pty === undefined ? {} : { pty: item.pty }),
    ...(item.cell === undefined ? {} : { cell: item.cell })
  }
  if (item.kind === 'markdown') {
    const { heading, parts } = prepareMarkdown(item.text)
    const title = item.title || heading || 'Markdown'
    const entry: CanvasEntry = { id: item.id, kind: 'markdown', title, at, ...owner }
    bodies.set(entry, new MarkdownBody(parts))
    return entry
  }
  if (item.kind === 'code') {
    const entry: CanvasEntry = { id: item.id, kind: 'code', title: item.name, at, ...owner }
    codeBodies.set(entry, new CodeBody(item.text, item.name, item.line))
    return entry
  }
  const url = URL.createObjectURL(new Blob([item.bytes as BlobPart], { type: item.mime }))
  return { id: item.id, kind: 'image', title: item.name, at, url, ...owner }
}

export function clockTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
