import { URGENCY, type ProgramStatusState } from '../../../shared/program-status'

type Tree = readonly {
  key: number
  cells: readonly { key: number; panes: readonly { ptyId: string }[] }[]
}[]

/**
 * cell 과 workspace 마다 그 안의 pane 상태 가운데 가장 급한 것(`URGENCY`). workspace 와 cell 의 key 는 겹치지 않으므로
 * 한 표에 둔다. 상태가 있는 pane 이 없으면 표에 넣지 않는다.
 */
export function urgentStates(
  workspaces: Tree,
  stateOf: (pty: string) => ProgramStatusState | undefined
): Map<number, ProgramStatusState> {
  const map = new Map<number, ProgramStatusState>()
  for (const w of workspaces) {
    const all = new Set<string | undefined>()
    for (const c of w.cells) {
      const states = new Set(c.panes.map((p) => stateOf(p.ptyId)))
      const state = URGENCY.find((s) => states.has(s))
      if (state) map.set(c.key, state)
      all.add(state)
    }
    const state = URGENCY.find((s) => all.has(s))
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
