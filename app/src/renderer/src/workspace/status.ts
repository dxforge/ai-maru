import { URGENCY, type ProgramStatusState } from '../../../shared/program-status'

type Tree = readonly {
  key: number
  cells: readonly { key: number; panes: readonly { ptyId: string }[] }[]
}[]

export function urgentStates(
  workspaces: Tree,
  stateOf: (pty: string) => ProgramStatusState | undefined
): Map<number, ProgramStatusState> {
  const map = new Map<number, ProgramStatusState>()
  for (const w of workspaces) {
    const states = new Set(w.cells.flatMap((c) => c.panes.map((p) => stateOf(p.ptyId))))
    const state = URGENCY.find((s) => states.has(s))
    if (state) map.set(w.key, state)
  }
  return map
}

export function unreadWorkspaces(
  workspaces: Tree,
  notified: (pty: string) => unknown
): Set<number> {
  return new Set(
    workspaces
      .filter((w) => w.cells.some((c) => c.panes.some((p) => notified(p.ptyId))))
      .map((w) => w.key)
  )
}
