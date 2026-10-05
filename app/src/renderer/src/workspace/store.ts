import { readonly, ref } from 'vue'

/** `startDir` 는 셸을 띄울 때 청한 디렉토리, `cwd` 는 세션이 알려 온 디렉토리다. */
export type Workspace = { key: number; sessionId?: string; startDir?: string; cwd?: string }

export function createWorkspaces() {
  const list = ref<Workspace[]>([])
  const selectedKey = ref<number | null>(null)
  let nextKey = 0

  function open(sessionId?: string, startDir?: string): void {
    const key = nextKey++
    list.value.push({ key, sessionId, startDir })
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

  function setSessionId(key: number, id: string): void {
    const w = list.value.find((w) => w.key === key)
    if (w) w.sessionId = id
  }

  function setCwd(key: number, cwd: string): void {
    const w = list.value.find((w) => w.key === key)
    if (w) w.cwd = cwd
  }

  return {
    list: readonly(list),
    selectedKey: readonly(selectedKey),
    open,
    close,
    setSessionId,
    setCwd,
    selected: (): Workspace | undefined => list.value.find((w) => w.key === selectedKey.value),
    select: (key: number): void => void (selectedKey.value = key)
  }
}
