import type { DeepReadonly } from 'vue'
import { matchesWords } from '../../../shared/commands'
import { labelBase, workspaceName } from '../../../shared/names'
import {
  dirLines,
  dirRow,
  favoriteRows,
  paneRow,
  type DirLine,
  type Row,
  type RowSource
} from './sidebarRows'
import { focusedPane, orderedPanes, workspaceDir, type Workspace } from './store'

export type SwitcherPane = Row & {
  cell: number
  workspace: number
  workspaceName: string
  search: string
}

export type SwitcherDir = DirLine & {
  workspace: number
  workspaceName: string
  search: string
}

export type SwitcherRows = { panes: SwitcherPane[]; dirs: SwitcherDir[] }

/**
 * ⌘P 전환기의 줄이다. pane 줄은 사이드바 순서(workspace → cell → pane)로 모든 pane 을 두고, 고른 cell 의 포커스된
 * pane 은 `focused` 로 표시한다.
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
        const r = paneRow(src, p, c.key === selected && p === current, base, true)
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
    const root = dir === undefined ? undefined : dirRow(dir, src.home)
    for (const f of dirLines(root, favoriteRows(w.favorites ?? [], dir, src.home), src.home)) {
      const words = [f.name, f.path, name]
      dirs.push({ ...f, workspace: w.key, workspaceName: name, search: join(words) })
    }
  }
  return { panes, dirs }
}

const join = (words: readonly (string | undefined)[]): string => words.filter(Boolean).join(' ')

export type SwitcherItem =
  | { kind: 'head'; key: string; title: string }
  | { kind: 'pane'; key: string; i: number; row: SwitcherPane }
  | { kind: 'dir'; key: string; i: number; row: SwitcherDir }

/**
 * 전환기가 그릴 줄을 DOM 순서로 둔다. `i` 는 고를 수 있는 줄의 번호로, pane 줄 다음에 디렉토리 줄이 이어진다. 묶음 이름
 * 줄은 그 묶음에 줄이 있을 때만 둔다. 아래 팔레트는 목록을 column-reverse 로 그리므로, `headLast` 면 묶음 이름 줄을 DOM
 * 에서 묶음 뒤에 두어 화면에서 묶음 위에 오게 한다.
 */
export function switcherItems({ panes, dirs }: SwitcherRows, headLast: boolean): SwitcherItem[] {
  const list: SwitcherItem[] = []
  const group = (title: string, rows: SwitcherItem[]): void => {
    if (!rows.length) return
    const head: SwitcherItem = { kind: 'head', key: `head:${title}`, title }
    list.push(...(headLast ? [...rows, head] : [head, ...rows]))
  }
  group(
    'Panes',
    panes.map((row, i) => ({ kind: 'pane', key: `pane:${row.pane}`, i, row }))
  )
  // workspace 디렉토리를 즐겨찾기에도 넣으면 두 줄의 `dir` 이 같으므로, workspace 디렉토리 줄은 `dir` 을 key 에 쓰지 않는다.
  group(
    'Favorites',
    dirs.map((row, i) => ({
      kind: 'dir',
      key: `dir:${row.workspace}:${row.root ? '' : row.dir}`,
      i: i + panes.length,
      row
    }))
  )
  return list
}

export function filterSwitcher({ panes, dirs }: SwitcherRows, query: string): SwitcherRows {
  return {
    panes: panes.filter((r) => matchesWords(r.search, query)),
    dirs: dirs.filter((r) => matchesWords(r.search, query))
  }
}
