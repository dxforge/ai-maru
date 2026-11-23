import { shallowReactive } from 'vue'
import { commandView, type CommandView } from '../../../shared/pane-name'
import {
  runningTasks,
  shownRecord,
  type ProgramStatusRecord,
  type ProgramStatusState
} from '../../../shared/program-status'
import type { PtyNotification, PtyState, PtyStateEntry } from '../../../shared/pty-state'

const NONE: readonly ProgramStatusRecord[] = []

export function createPtyStates() {
  // 항목은 메시지마다 통째로 바뀌고 안에서 고치지 않으므로 키 단위 반응이면 된다.
  const entries = shallowReactive(new Map<string, PtyStateEntry>())

  const get = (pty: string): PtyState | undefined => entries.get(pty)?.state
  const records = (pty: string): readonly ProgramStatusRecord[] => get(pty)?.records ?? NONE
  // 같은 레코드 배열에는 같은 객체를 돌려준다. `shownRecord` 는 고른 하위 레코드의 `app` 이 루트와 다르면 부를 때마다 루트의 `app` 을 단 새 객체를 만든다.
  // 매번 새 객체를 돌려주면 그것을 prop 으로 받은 pane 헤더가 다른 pane 의 상태가 바뀔 때도 다시 그려진다.
  const perList = <T>(f: (list: readonly ProgramStatusRecord[]) => T, none: T) => {
    const cache = new WeakMap<readonly ProgramStatusRecord[], T>()
    return (pty?: string): T => {
      if (pty === undefined) return none
      const list = records(pty)
      if (!cache.has(list)) cache.set(list, f(list))
      return cache.get(list) as T
    }
  }
  const shown = perList(shownRecord, undefined)
  const tasks = perList<readonly ProgramStatusRecord[]>(runningTasks, NONE)
  // 상태가 같으면 같은 객체를 돌려준다. 매번 새 객체를 돌려주면, 그것을 prop 으로 받은 pane 헤더가 다른 pane 의 상태가 바뀔 때도 다시 그려지기 때문이다.
  const views = new WeakMap<PtyState, CommandView | undefined>()
  const command = (pty?: string): CommandView | undefined => {
    const state = pty === undefined ? undefined : get(pty)
    if (!state) return undefined
    if (!views.has(state)) views.set(state, commandView(state))
    return views.get(state)
  }

  return {
    get,
    shown,
    tasks,
    state: (pty?: string): ProgramStatusState | undefined => shown(pty)?.state,
    rootState: (pty: string): ProgramStatusState | undefined =>
      records(pty).find((r) => r.id === '')?.state,
    command,
    /** 사용자가 아직 보지 않은 마지막 알림 */
    notification: (pty?: string): PtyNotification | undefined =>
      pty === undefined ? undefined : entries.get(pty)?.notification,
    apply(pty: string, entry: PtyStateEntry | null): void {
      if (entry) entries.set(pty, entry)
      else entries.delete(pty)
    },
    remove(pty: string): void {
      entries.delete(pty)
    }
  }
}

/**
 * main 에 상태 전체를 물어 `apply` 로 넣고, 그 뒤 main 이 보내는 것도 넣는다. 묻는 동안 push 로 온 pty 는 받은 전체로
 * 덮지 않는다 — push 가 더 새것이다.
 */
export function syncPtyStates(
  apply: (pty: string, entry: PtyStateEntry | null) => void,
  api: {
    onPtyState(cb: (pty: string, entry: PtyStateEntry | null) => void): void
    ptyStates(): Promise<Record<string, PtyStateEntry>>
  }
): void {
  const pushed = new Set<string>()
  let loaded = false
  api.onPtyState((pty, entry) => {
    if (!loaded) pushed.add(pty)
    apply(pty, entry)
  })
  void api.ptyStates().then((all) => {
    loaded = true
    for (const [pty, entry] of Object.entries(all)) if (!pushed.has(pty)) apply(pty, entry)
    pushed.clear()
  })
}
