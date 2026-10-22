import { readonly, ref } from 'vue'

export type Toast = {
  level: 'error' | 'warning'
  title: string
  lines: readonly string[]
  detail?: string
}

export type ToastEntry = { id: string } & Toast

/** 알리는 쪽마다 id 하나를 쓴다. 같은 id 로 다시 알리면 쌓지 않고 그 토스트를 바꾼다. */
export function createToasts() {
  const list = ref<ToastEntry[]>([])

  function put(id: string, toast: Toast): void {
    const entry = { id, ...toast }
    const i = list.value.findIndex((t) => t.id === id)
    if (i === -1) list.value.push(entry)
    else list.value[i] = entry
  }

  function close(id: string): void {
    list.value = list.value.filter((t) => t.id !== id)
  }

  return { list: readonly(list), put, close }
}
