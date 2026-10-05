import { reactive } from 'vue'
import type { ClaudeState } from '../../../shared/claude'

export function createClaudeStatuses() {
  const states = reactive(new Map<string, ClaudeState>())
  return {
    state: (session?: string): ClaudeState | undefined =>
      session === undefined ? undefined : states.get(session),
    set(session: string, state: ClaudeState | null): void {
      if (state) states.set(session, state)
      else states.delete(session)
    },
    replace(all: Record<string, ClaudeState>): void {
      states.clear()
      for (const [session, state] of Object.entries(all)) states.set(session, state)
    }
  }
}
