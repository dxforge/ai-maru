import type { ProgramStatusRecord } from '../shared/program-status'
import type { PtyCommand, PtyState, PtyStateEntry } from '../shared/pty-state'
import type { StateHandlers } from './pty'

export type PtyStatesDeps = {
  subscribe(id: string, on: StateHandlers): () => void
  isLive(id: string): Promise<boolean>
  /** `entry` 가 null 이면 그 pty 의 상태를 지웠다. */
  emit(pty: string, entry: PtyStateEntry | null): void
}

/**
 * main 이 pty(pane 과 job) 마다 상태 구독을 열고 마지막 상태를 든다. renderer 가 붙어 있든 아니든 든다.
 *
 * 구독이 끊기면 그 구독이 상태를 하나라도 받았고 pty 가 살아 있을 때만 마지막 상태를 둔 채 다시 구독한다. 그 밖에는
 * 상태를 지운다 — 다시 연 구독이 첫 상태를 받기 전에 또 끊긴 것도 여기에 든다. 끊긴 것만으로 셸이 끝났다고 보지 않는다.
 */
export function createPtyStates(deps: PtyStatesDeps) {
  type Watch = { entry?: PtyStateEntry; close: () => void }
  const watches = new Map<string, Watch>()

  function open(id: string, entry?: PtyStateEntry): void {
    let got = false
    const w: Watch = { entry, close: () => {} }
    const current = (): boolean => watches.get(id) === w
    const set = (next: PtyStateEntry): void => {
      if (!current()) return
      w.entry = next
      deps.emit(id, next)
    }
    watches.set(id, w)
    w.close = deps.subscribe(id, {
      state: (state) => {
        got = true
        set({ state })
      },
      old: () => set({ old: true }),
      closed: () => void reopen(id, w, got)
    })
  }

  async function reopen(id: string, w: Watch, got: boolean): Promise<void> {
    const live = got && (await deps.isLive(id))
    if (watches.get(id) !== w) return
    if (live) open(id, w.entry)
    else forget(id)
  }

  function forget(id: string): void {
    const w = watches.get(id)
    if (!w) return
    watches.delete(id)
    w.close()
    if (w.entry) deps.emit(id, null)
  }

  return {
    watch(id: string): void {
      if (!watches.has(id)) open(id)
    },
    /** 구독을 닫고 상태를 지운다. 끝낸 pty 에 부른다 — 이전 maru-pty 의 pty 는 끝나도 main 이 알 수 없다. */
    forget,
    entries(): Record<string, PtyStateEntry> {
      return Object.fromEntries([...watches].flatMap(([id, w]) => (w.entry ? [[id, w.entry]] : [])))
    },
    state: stateOf,
    command(pty: string): PtyCommand | null {
      return stateOf(pty)?.command ?? null
    },
    records(pty: string): readonly ProgramStatusRecord[] {
      return stateOf(pty)?.records ?? []
    }
  }

  function stateOf(pty: string): PtyState | undefined {
    const entry = watches.get(pty)?.entry
    return entry && 'state' in entry ? entry.state : undefined
  }
}
