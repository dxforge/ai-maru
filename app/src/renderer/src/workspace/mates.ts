import type { DeepReadonly } from 'vue'
import type { MateRow } from '../../../shared/pane'
import type { ProgramStatusRecord } from '../../../shared/program-status'
import { CLAUDE_APP } from '../program-status/store'
import { cellLabel, windowTitle, workspaceName } from './cwd'
import { focusedPane, startDirOf, type Workspace } from './store'

export function mateRows(
  workspaces: DeepReadonly<Workspace[]>,
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
