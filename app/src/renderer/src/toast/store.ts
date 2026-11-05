import { readonly, ref } from 'vue'

/**
 * `action` 은 토스트에 버튼으로 보이고, 누르면 토스트를 닫은 뒤 `run` 을 부른다. `timeout` 을 주면 그 시간(ms)이 지나
 * 저절로 닫힌다. 없으면 사용자가 닫을 때까지 남는다.
 */
export type Toast = {
  level: 'error' | 'warning' | 'info'
  title: string
  lines: readonly string[]
  detail?: string
  action?: { label: string; run: () => void }
  timeout?: number
}

export type ToastEntry = { id: string } & Toast

/** 알리는 쪽마다 id 하나를 쓴다. 같은 id 로 다시 알리면 쌓지 않고 그 토스트를 바꾼다. */
export function createToasts() {
  const list = ref<ToastEntry[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function stopTimer(id: string): void {
    clearTimeout(timers.get(id))
    timers.delete(id)
  }

  function put(id: string, toast: Toast): void {
    const entry = { id, ...toast }
    const i = list.value.findIndex((t) => t.id === id)
    if (i === -1) list.value.push(entry)
    else list.value[i] = entry
    stopTimer(id)
    if (toast.timeout === undefined) return
    timers.set(
      id,
      setTimeout(() => close(id), toast.timeout)
    )
  }

  function close(id: string): void {
    stopTimer(id)
    list.value = list.value.filter((t) => t.id !== id)
  }

  function act(id: string): void {
    const t = list.value.find((x) => x.id === id)
    if (!t?.action) return
    close(id)
    t.action.run()
  }

  return { list: readonly(list), put, close, act }
}
