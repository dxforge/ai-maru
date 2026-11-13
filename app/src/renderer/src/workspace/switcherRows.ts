import type { DeepReadonly } from 'vue'
import { matchesWords } from '../../../shared/commands'
import { labelBase, workspaceName } from '../../../shared/names'
import { tildePath } from './cwd'
import { dirRow, favoriteRows, paneRow, type DirRow, type Row, type RowSource } from './sidebarRows'
import { focusedPane, orderedPanes, workspaceDir, type Workspace } from './store'

export type SwitcherPane = Row & {
  cell: number
  workspace: number
  workspaceName: string
  /** 거르기에 맞춰 보는 글이다. */
  search: string
}

export type SwitcherDir = DirRow & {
  workspace: number
  workspaceName: string
  /** workspace 디렉토리(workspace 메뉴의 Favorites 맨 윗줄)면 true 다. */
  root: boolean
  search: string
}

export type SwitcherRows = { panes: SwitcherPane[]; dirs: SwitcherDir[] }

/**
 * ⌘P 전환기의 줄이다. pane 줄은 사이드바 순서(workspace → cell → pane)로 모든 pane 을 두고, 고른 cell 의 포커스된
 * pane 은 `focused` 로 표시한다. 디렉토리 줄은 workspace 순서대로 workspace 메뉴의 Favorites 와 같은 줄(workspace
 * 디렉토리, 그 아래 이름순 즐겨찾기)을 둔다.
 */
export function switcherRows(
  workspaces: readonly DeepReadonly<Workspace>[],
  src: RowSource,
  selected: number | null
): SwitcherRows {
  const panes: SwitcherPane[] = []
  const dirs: SwitcherDir[] = []
  for (const w of workspaces) {
    const name = workspaceName(w, src.home)
    const base = labelBase(w)
    for (const c of w.cells) {
      const current = focusedPane(c)
      for (const p of orderedPanes(c)) {
        const r = paneRow(src, p, c.key === selected && p === current, base)
        const words = [r.name, r.place?.name, r.place?.branch, r.place?.sub, r.path, name]
        panes.push({
          ...r,
          cell: c.key,
          workspace: w.key,
          workspaceName: name,
          search: join(words)
        })
      }
    }
    const dir = workspaceDir(w)
    const rows = [
      ...(dir === undefined ? [] : [{ ...dirRow(dir, src.home), root: true }]),
      ...favoriteRows(w.favorites ?? [], dir, src.home).map((f) => ({ ...f, root: false }))
    ]
    for (const f of rows) {
      const words = [f.name, f.path, tildePath(f.dir, src.home), name]
      dirs.push({ ...f, workspace: w.key, workspaceName: name, search: join(words) })
    }
  }
  return { panes, dirs }
}

const join = (words: readonly (string | undefined)[]): string => words.filter(Boolean).join(' ')

/** ⇧⌘P 팔레트(`filterCommands`)처럼 입력한 단어가 모두 들어 있는 줄만 남긴다. */
export function filterSwitcher({ panes, dirs }: SwitcherRows, query: string): SwitcherRows {
  return {
    panes: panes.filter((r) => matchesWords(r.search, query)),
    dirs: dirs.filter((r) => matchesWords(r.search, query))
  }
}
