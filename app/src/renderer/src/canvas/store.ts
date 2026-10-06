import { computed, readonly, ref } from 'vue'
import type { CanvasItem } from '../../../shared/canvas'
import { firstHeading } from './markdown'

export type CanvasEntry =
  | { id: string; kind: 'markdown'; title: string; text: string }
  | { id: string; kind: 'image'; title: string; url: string }

export type Canvas = ReturnType<typeof createCanvas>

export function createCanvas() {
  const docs = ref<CanvasEntry[]>([])
  const selectedId = ref<string | null>(null)
  const open = ref(false)
  const selected = computed(() => docs.value.find((d) => d.id === selectedId.value) ?? null)

  // 바뀐 문서를 위로 올리지 않는 건, 보낸 쪽이 문서를 고칠 때마다 목록이 뒤바뀌지 않게.
  function put(item: CanvasItem): void {
    const entry = toEntry(item)
    const i = docs.value.findIndex((d) => d.id === item.id)
    if (i === -1) {
      docs.value.unshift(entry)
    } else {
      const old = docs.value[i]
      if (old.kind === 'image') URL.revokeObjectURL(old.url)
      docs.value[i] = entry
    }
    selectedId.value = item.id
    open.value = true
  }

  return {
    docs: readonly(docs),
    selectedId: readonly(selectedId),
    selected,
    open: readonly(open),
    put,
    select: (id: string): void => void (selectedId.value = id),
    close: (): void => void (open.value = false),
    reopen: (): void => void (open.value = true),
    toggle: (): void => void (open.value = !open.value)
  }
}

function toEntry(item: CanvasItem): CanvasEntry {
  if (item.kind === 'markdown') {
    const title = item.title || firstHeading(item.text) || 'Markdown'
    return { id: item.id, kind: 'markdown', title, text: item.text }
  }
  const url = URL.createObjectURL(new Blob([item.bytes as BlobPart], { type: item.mime }))
  return { id: item.id, kind: 'image', title: item.name, url }
}
