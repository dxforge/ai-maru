import { cellLabel, focusedPane, startDirOf, windowTitle, workspaceName, type Named } from './names'
import type { MateRow } from './pane'
import { CLAUDE_APP, type ProgramStatusRecord } from './program-status'

type MatePane = Named & { key: number; ptyId: string; startDir?: string }
type MateCell = { panes: readonly MatePane[]; focused: number }

export function mateRows(
  workspaces: readonly { cells: readonly MateCell[] }[],
  root: (pty: string) => ProgramStatusRecord | undefined
): MateRow[] {
  const rows: MateRow[] = []
  for (const w of workspaces) {
    const workspace = workspaceName(w.cells[0].panes[0])
    for (const c of w.cells) {
      const cell = windowTitle(cellLabel(focusedPane(c)), ' ')
      for (const p of c.panes) {
        const r = root(p.ptyId)
        if (r?.app !== CLAUDE_APP) continue
        rows.push({
          pty: p.ptyId,
          state: r.state,
          kind: r.kind,
          workspace,
          cell,
          dir: startDirOf(p) ?? '',
          message: r.message || r.title
        })
      }
    }
  }
  return rows
}
