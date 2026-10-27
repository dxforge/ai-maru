import { shallowReactive } from 'vue'
import {
  rootRecord,
  type ProgramStatusRecord,
  type ProgramStatusState
} from '../../../shared/program-status'
import type { PtyState, PtyStateEntry } from '../../../shared/pty-state'
import { commandView, type CommandView } from '../workspace/display'

const NONE: readonly ProgramStatusRecord[] = []

/**
 * pty 상태를 `ptyId` 로 찾는 저장소. 상태는 main 에서만 받는다(`apply`). 이전 maru-pty 의 pty(`old`)만은 상태가 오지
 * 않으므로 attach 스트림의 `program_status` 를 레코드로 쓴다(`setLegacyRecords`). 이 예외는 이전 maru-pty 의 pty 가
 * 모두 끝나면 지울 잠정 경로다.
 */
export function createPtyStates() {
  // 항목은 메시지마다 통째로 바뀌고 안에서 고치지 않으므로 키 단위 반응이면 된다.
  const entries = shallowReactive(new Map<string, PtyStateEntry>())
  const legacy = shallowReactive(new Map<string, ProgramStatusRecord[]>())

  const get = (pty: string): PtyState | undefined => {
    const e = entries.get(pty)
    return e && 'state' in e ? e.state : undefined
  }
  const records = (pty: string): readonly ProgramStatusRecord[] => {
    const e = entries.get(pty)
    if (!e) return NONE
    return 'state' in e ? e.state.records : (legacy.get(pty) ?? NONE)
  }
  const root = (pty?: string): ProgramStatusRecord | undefined =>
    pty === undefined ? undefined : rootRecord(records(pty))
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
    root,
    state: (pty?: string): ProgramStatusState | undefined => root(pty)?.state,
    command,
    isOld: (pty: string): boolean => {
      const e = entries.get(pty)
      return e !== undefined && 'old' in e
    },
    apply(pty: string, entry: PtyStateEntry | null): void {
      if (entry) entries.set(pty, entry)
      else entries.delete(pty)
    },
    /** 이전 maru-pty 의 pty 에서 attach 스트림으로 온 레코드. 그 pty 가 `old` 일 때만 쓰인다. */
    setLegacyRecords(pty: string, list: ProgramStatusRecord[]): void {
      legacy.set(pty, list)
    },
    remove(pty: string): void {
      entries.delete(pty)
      legacy.delete(pty)
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
