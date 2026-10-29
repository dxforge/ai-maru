import { cellLabel, focusedPane, startDirOf, windowTitle, workspaceName } from './names'
import type { PaneRow } from './pane'
import { commandView, paneName } from './pane-name'
import { shownRecord } from './program-status'
import type { PtyState } from './pty-state'
import type { ScreenWorkspace } from './screen'

/**
 * `maru pane list` 가 화면과 같은 상태와 이름을 내도록 사이드바·pane 헤더·cell 헤더와 같은 함수로 줄을 짓는다(`docs/architecture.md`).
 */
export function paneRows(
  workspaces: readonly ScreenWorkspace[],
  state: (pty: string) => PtyState | undefined,
  shell: string | undefined,
  home?: string
): PaneRow[] {
  const rows: PaneRow[] = []
  for (const w of workspaces) {
    const workspace = workspaceName(w.cells[0].panes[0], home)
    for (const c of w.cells) {
      const cell = windowTitle(cellLabel(focusedPane(c)), ' ')
      for (const p of c.panes) {
        const s = state(p.ptyId)
        const r = s && shownRecord(s.records)
        rows.push({
          pty: p.ptyId,
          state: r?.state ?? '',
          kind: r?.kind ?? null,
          app: r?.app ?? '',
          workspace,
          cell,
          title: paneName(p, r, shell, commandView(s)),
          dir: startDirOf(p) ?? '',
          message: r?.message ?? ''
        })
      }
    }
  }
  return rows
}
