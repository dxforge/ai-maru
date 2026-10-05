import { readonly, ref } from 'vue'

export type Workspace = { key: number; sessionId?: string }

export function createWorkspaces() {
  const list = ref<Workspace[]>([])
  const selectedKey = ref<number | null>(null)
  let nextKey = 0

  function open(sessionId?: string): void {
    const key = nextKey++
    list.value.push({ key, sessionId })
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

  return {
    list: readonly(list),
    selectedKey: readonly(selectedKey),
    open,
    close,
    select: (key: number): void => void (selectedKey.value = key)
  }
}
