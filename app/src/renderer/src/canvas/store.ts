import { reactive, readonly, ref } from 'vue'
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

  // 바뀐 문서를 위로 올리지 않는 건, 보낸 쪽이 문서를 고칠 때마다 목록이 뒤바뀌지 않게.
  function put(item: CanvasItem): void {
    const entry = toEntry(item, now())
    const i = docs.value.findIndex((d) => d.id === item.id)
    if (i === -1) {
      docs.value.unshift(entry)
      expanded.add(item.id)
    } else {
      release(docs.value[i])
      docs.value[i] = entry
    }
    open.value = true
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
    put,
    remove,
    expand,
    expandAll: (): void => docs.value.forEach((d) => expanded.add(d.id)),
    collapseAll: (): void => expanded.clear(),
    close: (): void => void (open.value = false),
    reopen: (): void => void (open.value = true),
    toggle: (): void => void (open.value = !open.value)
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
