import { computed, reactive, readonly, ref } from 'vue'
import type { CanvasItem } from '../../../shared/canvas'
import { firstHeading } from './markdown'

// `at` 은 renderer 가 문서를 받은 시각(ms)이다. 같은 id 로 고친 문서는 고친 시각이다.
export type CanvasEntry =
  | { id: string; kind: 'markdown'; title: string; at: number; text: string }
  | { id: string; kind: 'image'; title: string; at: number; url: string }

export type Canvas = ReturnType<typeof createCanvas>

export function createCanvas(now: () => number = Date.now) {
  const docs = ref<CanvasEntry[]>([])
  const expanded = reactive(new Set<string>())
  const open = ref(false)

  // 붙잡은 동안(`hold(true)`) 온 문서는 목록에 넣지 않고 쌓아 둔다. 목록이 바뀌면 커서 아래의 버튼이 다른 문서의
  // 것으로 바뀌어, 누르려던 것과 다른 문서가 지워지기 때문이다. 닫힌 패널은 누를 수 없으므로 붙잡지 않는다.
  let holding = false
  const held = ref<CanvasEntry[]>([])

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
    expanded: readonly(expanded),
    open: readonly(open),
    held: computed(() => held.value.length),
    put,
    hold,
    flush,
    remove,
    expand,
    expandAll: (): void => docs.value.forEach((d) => expanded.add(d.id)),
    collapseAll: (): void => expanded.clear(),
    close: (): void => setOpen(false),
    reopen: (): void => setOpen(true),
    toggle: (): void => setOpen(!open.value)
  }
}

function release(entry: CanvasEntry): void {
  if (entry.kind === 'image') URL.revokeObjectURL(entry.url)
}

function toEntry(item: CanvasItem, at: number): CanvasEntry {
  if (item.kind === 'markdown') {
    const title = item.title || firstHeading(item.text) || 'Markdown'
    return { id: item.id, kind: 'markdown', title, at, text: item.text }
  }
  const url = URL.createObjectURL(new Blob([item.bytes as BlobPart], { type: item.mime }))
  return { id: item.id, kind: 'image', title: item.name, at, url }
}

export function clockTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
