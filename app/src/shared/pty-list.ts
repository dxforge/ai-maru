import { workspaceName } from './names'
import { paneRows } from './pane-list'
import { type ProgramStatusKind, type ProgramStatusState, shownRecord } from './program-status'
import type { PtyExit } from './pty'
import type { PtyState } from './pty-state'
import type { ScreenWorkspace } from './screen'

/** `pty.list` 의 한 줄이다. 각 값은 `maru` 의 모듈 doc(`core/crates/maru/src/main.rs`)이 정한다. */
export type PtyRow = {
  pty: string
  kind: 'pane' | 'job'
  workspace: string
  cell: string
  state: ProgramStatusState | ''
  state_kind: ProgramStatusKind | null
  exit: PtyExit | null
  name: string
  dir: string
}

/** `pty.list` 에 싣는 job 이다. `exit` 는 셸이 끝났을 때만 있다. */
export type ListedJob = { pty: string; name?: string; cell: string; exit?: PtyExit }

export function ptyRows(
  workspaces: readonly ScreenWorkspace[],
  jobs: readonly ListedJob[],
  state: (pty: string) => PtyState | undefined,
  paneExit: (pty: string) => PtyExit | null,
  shell: string | undefined,
  home?: string
): PtyRow[] {
  const panes: PtyRow[] = paneRows(workspaces, state, shell, home).map((r) => ({
    pty: r.pty,
    kind: 'pane',
    workspace: r.workspace,
    cell: r.cell,
    state: r.state,
    state_kind: r.kind,
    exit: paneExit(r.pty),
    name: r.title,
    dir: r.dir
  }))
  const jobRows = jobs.map((j): PtyRow => {
    const s = state(j.pty)
    const r = s && shownRecord(s.records)
    const w = workspaces.find((w) => w.cells.some((c) => c.id === j.cell))
    return {
      pty: j.pty,
      kind: 'job',
      workspace: w ? workspaceName(w, home) : '',
      cell: j.cell,
      state: r?.state ?? '',
      state_kind: r?.kind ?? null,
      exit: j.exit ?? null,
      name: j.name ?? '',
      dir: s?.cwd ?? ''
    }
  })
  return [...panes, ...jobRows]
}
