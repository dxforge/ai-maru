import { shallowReactive } from 'vue'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'

const NONE: readonly ProgramStatusRecord[] = []

export function createProgramStatuses() {
  // 목록은 메시지마다 통째로 바뀌고 안에서 고치지 않으므로 키 단위 반응이면 된다.
  const all = shallowReactive(new Map<string, ProgramStatusRecord[]>())
  return {
    state: (session?: string): ProgramStatusState | undefined =>
      session === undefined ? undefined : all.get(session)?.find((r) => r.id === '')?.state,
    records: (session: string): readonly ProgramStatusRecord[] => all.get(session) ?? NONE,
    set(session: string, records: ProgramStatusRecord[]): void {
      if (records.length) all.set(session, records)
      else all.delete(session)
    },
    remove(session: string): void {
      all.delete(session)
    }
  }
}
