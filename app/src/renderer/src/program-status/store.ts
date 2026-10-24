import { shallowReactive } from 'vue'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'

const NONE: readonly ProgramStatusRecord[] = []

/** Claude Code 2.1.310 이 OSC 7501 보고에 싣는 `app` 값이다. */
export const CLAUDE_APP = 'claude-code'

export function programName(app: string): string {
  if (app === CLAUDE_APP) return 'Claude'
  return app || 'Program'
}

export function createProgramStatuses() {
  // 목록은 메시지마다 통째로 바뀌고 안에서 고치지 않으므로 키 단위 반응이면 된다.
  const all = shallowReactive(new Map<string, ProgramStatusRecord[]>())
  const root = (session?: string): ProgramStatusRecord | undefined =>
    session === undefined ? undefined : all.get(session)?.find((r) => r.id === '')
  return {
    root,
    state: (session?: string): ProgramStatusState | undefined => root(session)?.state,
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
