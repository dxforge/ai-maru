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
  const root = (pty?: string): ProgramStatusRecord | undefined =>
    pty === undefined ? undefined : all.get(pty)?.find((r) => r.id === '')
  return {
    root,
    state: (pty?: string): ProgramStatusState | undefined => root(pty)?.state,
    records: (pty: string): readonly ProgramStatusRecord[] => all.get(pty) ?? NONE,
    set(pty: string, records: ProgramStatusRecord[]): void {
      if (records.length) all.set(pty, records)
      else all.delete(pty)
    },
    remove(pty: string): void {
      all.delete(pty)
    }
  }
}
