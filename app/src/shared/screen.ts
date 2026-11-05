import versions from '../../resources/state-versions.json'
import type { GitHead } from './git'
import { panes as leaves, type Layout } from './layout'
import { isPtyId, randomId } from './pty'

/**
 * `state.json` 의 표마다의 형식 버전이다. 번들의 `state-versions.json` 에서 읽어, 재시작 전 앱이 설치된 빌드의 같은 파일과
 * 견줄 수 있게 한다(`main/restart.ts`). 다음에 뜬 앱은 모르는 버전의 표를 버린다. 버전을 올리는 규칙은
 * `docs/architecture.md` 의 "끄기·뜨기·재시작" 에 있다. 없어도 되는 필드를 더할 때는 해당 parse 함수에서도 옮긴다.
 * parse 함수는 아는 필드만 옮기고, 선택 필드는 빠뜨려도 타입 검사를 통과하기 때문이다.
 */
export const STATE_VERSIONS: {
  workspaces: number
  cells: number
  panes: number
  sessions: number
  view: number
} = versions

/**
 * `id` 는 pane 을 만들 때 정하고 실행이 바뀌어도 그대로다. `key` 는 화면 안의 번호로, 뜰 때마다 새로 매긴다.
 * `cwd`·`title`·`git` 은 저장할 때 화면에 보이던 값이다. main 은 `maru pane list` 의 이름을 이 값으로 짓고, 다시 뜬
 * 앱은 pty 의 상태가 오기 전까지 이 값을 보인다. `keep` 은 런처로 띄운 pane 에 붙는다. 앱은 그 pane 의 pty 를
 * `--keep` 으로 띄우고, 명령이 실패하면(`failedExit`) pane 을 남긴다.
 */
export type LayoutPane = {
  key: number
  id: string
  command?: string[]
  keep?: true
  cwd?: string
  title?: string
  git?: GitHead
}

export type ScreenPane = LayoutPane & { ptyId: string }

type CellOf<P> = {
  key: number
  id: string
  panes: P[]
  layout: Layout
  focused: number
  fontSize?: number
  /** columns 보기에서 늘어선 pane 하나가 받는 터미널 열 수. 없으면 설정 파일의 `layout.column-cols` 다. */
  paneCols?: number
  /** 이 cell 이 맡은 즐겨찾기 디렉토리. 그 workspace 의 `favorites` 가운데 하나다. */
  favorite?: string
}

/**
 * `name` 은 사용자가 바꾼 이름이다. 없으면 `workspaceName` 이 짓는다. `dir` 이 첫 pane 의 작업 트리 안이면 그 저장소
 * 이름, 밖이면 `dir` 의 디렉토리 이름, `dir` 이 아직 없으면 첫 pane 의 저장소나 디렉토리 이름이다. `dir` 은 workspace 의
 * 디렉토리로, 홈 밖의 디렉토리로 한 번 정하면 바꾸지 않는다. 첫 cell 이 `cd` 하거나 다른 cell 이 첫 자리로 와도
 * workspace 의 경로가 따라 바뀌지 않게 하기 위해서다. `pinned` 인 workspace 는 마지막 cell 을 닫아도 남는다.
 * cell 이 없는 workspace 는 `pinned` 일 때만 있다. `favorites` 는 즐겨찾기 디렉토리의 절대경로로, 넣은 순서다.
 */
type WorkspaceOf<P> = {
  key: number
  id: string
  name?: string
  pinned?: true
  dir?: string
  favorites?: string[]
  cells: CellOf<P>[]
}

export type ScreenCell = CellOf<ScreenPane>
export type ScreenWorkspace = WorkspaceOf<ScreenPane>
type SavedWorkspace = WorkspaceOf<LayoutPane>

/** renderer 가 화면이 바뀔 때마다 main 에 보내는 화면이다. main 은 이것을 `state.json` 의 표로 나눠 쓴다. */
export type ScreenState = {
  workspaces: ScreenWorkspace[]
  /** 선택한 cell 의 key 다. */
  selected: number | null
  /**
   * `folded` 는 접힌 workspace 의 `id` 다. key 는 실행마다 새로 매길 수 있어, 저장한 key 가 다음 실행에서 다른
   * workspace 를 가리킬 수 있기 때문이다.
   */
  sidebar: { open: boolean; width: number; folded: string[] }
  viewMode: 'single' | 'columns'
  /** 폭을 끌어 바꾼 적이 없으면 없다 — 그동안은 창 폭에 비례하는 기본 폭을 쓴다. */
  canvas?: { width: number }
}

/** `state.json` 의 표 하나다. 줄의 순서가 화면의 순서다. */
export type Table<R> = { version: number; rows: R[] }

export type WorkspaceRow = Omit<SavedWorkspace, 'key' | 'cells'>

/** `cells` 표의 줄이다. 같은 `workspace` 의 줄끼리는 줄의 순서가 cell 의 순서다. 배치의 잎은 pane 의 id 다. */
export type CellRow = Omit<CellOf<never>, 'key' | 'panes' | 'layout' | 'focused'> & {
  workspace: string
  layout: Layout<string>
  focused: string
}

/** `panes` 표의 줄이다. 같은 `cell` 의 줄끼리는 줄의 순서가 cell 의 `panes` 순서다. */
export type PaneRow = Omit<LayoutPane, 'key'> & { cell: string }

export type PanePty = { pane: string; pty: string }

/** 표를 `joinTables` 로 이은, renderer 가 되살릴 workspace 목록이다. key 는 0 부터 새로 매긴다. */
export type SavedLayout = { workspaces: SavedWorkspace[]; selected: number | null }

/** 사용자가 고르지 않았는데 잃은 표다. `protocol` 은 pty 프로토콜이 달라 `sessions` 를 버린 것이다. */
export type RestoreNotice = 'workspaces' | 'cells' | 'panes' | 'sessions' | 'protocol'

/**
 * 뜰 때 main 이 renderer 에 주는 복원할 것이다. `ptys` 는 pane key 마다 붙을 pty 이고, null 이면 모든 pane 이 새 셸을
 * 띄운다. 표는 여럿을 함께 잃을 수 있으므로 `notice` 는 목록이다.
 */
export type Restore = {
  layout: SavedLayout | null
  ptys: Record<number, string> | null
  notice: RestoreNotice[]
}

export const SIDEBAR_WIDTH = { min: 200, max: 480 }
const CANVAS_MIN_WIDTH = 240

/** 첫 화면을 그리기 전에 renderer 가 받는 보기 설정이다. `folded` 는 접힌 workspace 의 `id` 다. */
export type ViewPrefs = {
  viewMode?: ScreenState['viewMode']
  sidebar?: { open: boolean; width: number }
  folded?: string[]
  canvas?: ScreenState['canvas']
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKey = (v: unknown): v is number => Number.isInteger(v)
const optString = (v: unknown): v is string | undefined => v === undefined || typeof v === 'string'
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((a): a is string => typeof a === 'string')

function omit<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const r = { ...o }
  for (const k of keys) delete r[k]
  return r
}

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}

function parseList<T>(v: unknown, parse: (x: unknown) => T | null, empty = false): T[] | null {
  if (!Array.isArray(v) || (!empty && v.length === 0)) return null
  const out = v.map(parse)
  return out.every((x) => x !== null) ? (out as T[]) : null
}

// 아래 parse 함수는 검사한 필드만 새 객체로 옮긴다. 받은 객체를 그대로 돌려주면 옛 빌드가 쓴 필드가 메모리에 남아 다음 저장에 다시 쓰인다.

function parseLayout<P>(v: unknown, isLeaf: (x: unknown) => x is P): Layout<P> | null {
  if (!isObj(v)) return null
  if ('pane' in v) return isLeaf(v.pane) ? { pane: v.pane } : null
  if (v.split !== 'right' && v.split !== 'down') return null
  const first = parseLayout(v.first, isLeaf)
  const second = parseLayout(v.second, isLeaf)
  return first && second ? { split: v.split, first, second } : null
}

const isString = (v: unknown): v is string => typeof v === 'string'

function parseGit(v: unknown): GitHead | null {
  if (
    !isObj(v) ||
    typeof v.repo !== 'string' ||
    !optString(v.branch) ||
    !optString(v.common) ||
    !optString(v.sub)
  )
    return null
  return compact({ repo: v.repo, branch: v.branch, common: v.common, sub: v.sub })
}

function parsePaneFields(v: unknown): Omit<LayoutPane, 'key'> | null {
  if (!isObj(v) || typeof v.id !== 'string' || !optString(v.cwd) || !optString(v.title)) return null
  const { command } = v
  if (command !== undefined && !isStrings(command)) return null
  const git = v.git === undefined ? undefined : parseGit(v.git)
  if (git === null) return null
  if (v.keep !== undefined && v.keep !== true) return null
  const keep = v.keep === true || undefined
  return compact({ id: v.id, command, keep, cwd: v.cwd, title: v.title, git })
}

function parseScreenPane(v: unknown): ScreenPane | null {
  const pane = parsePaneFields(v)
  const { key, ptyId } = v as Obj
  return pane && isKey(key) && isPtyId(ptyId) ? { key, ...pane, ptyId } : null
}

function parseCellFields(v: Obj): Pick<CellOf<never>, 'fontSize' | 'paneCols' | 'favorite'> | null {
  const { fontSize, paneCols, favorite } = v
  if (!optString(favorite)) return null
  if (fontSize !== undefined && !(typeof fontSize === 'number' && Number.isFinite(fontSize)))
    return null
  if (paneCols !== undefined && !(isKey(paneCols) && paneCols > 0)) return null
  return { fontSize, paneCols, favorite }
}

function parseScreenCell(v: unknown): ScreenCell | null {
  if (!isObj(v) || !isKey(v.key) || typeof v.id !== 'string' || !isKey(v.focused)) return null
  const fields = parseCellFields(v)
  const panes = parseList(v.panes, parseScreenPane)
  const layout = parseLayout(v.layout, isKey)
  if (!fields || !panes || !layout) return null
  return compact({ key: v.key, id: v.id, panes, layout, focused: v.focused, ...fields })
}

function parseWorkspaceRow(w: unknown): WorkspaceRow | null {
  if (!isObj(w) || typeof w.id !== 'string') return null
  const { name: given, dir, favorites, pinned } = w
  if (!optString(given) || !optString(dir)) return null
  if (favorites !== undefined && !isStrings(favorites)) return null
  if (pinned !== undefined && pinned !== true) return null
  // `rename`(`store.ts`)이 빈 이름을 받으면 이름을 지우는 것과 맞춰, 비었거나 공백뿐인 이름은 이름이 없는 것으로 본다.
  const name = given?.trim() ? given : undefined
  return compact<WorkspaceRow>({
    id: w.id,
    name,
    pinned: pinned === true || undefined,
    dir,
    favorites: favorites?.length ? favorites : undefined
  })
}

function parseCellRow(v: unknown): CellRow | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.workspace !== 'string') return null
  if (typeof v.focused !== 'string') return null
  const fields = parseCellFields(v)
  const layout = parseLayout(v.layout, isString)
  if (!fields || !layout) return null
  return compact({ id: v.id, workspace: v.workspace, layout, focused: v.focused, ...fields })
}

function parsePaneRow(v: unknown): PaneRow | null {
  const pane = parsePaneFields(v)
  const { cell } = v as Obj
  return pane && typeof cell === 'string' ? { ...pane, cell } : null
}

export function parseScreen(v: unknown): ScreenState | null {
  if (!isObj(v)) return null
  const { selected, sidebar } = v
  const workspaces = parseList(
    v.workspaces,
    (w): ScreenWorkspace | null => {
      const row = parseWorkspaceRow(w)
      if (!row || !isKey((w as Obj).key)) return null
      const cells = parseList((w as Obj).cells, parseScreenCell, row.pinned)
      return cells && { key: (w as Obj).key as number, ...row, cells }
    },
    true
  )
  if (!workspaces) return null
  if (selected !== null && !isKey(selected)) return null
  const prefs = parseViewPrefs(v)
  if (!prefs.viewMode || !prefs.sidebar) return null
  if (v.canvas !== undefined && !prefs.canvas) return null
  if (!isObj(sidebar) || !isStrings(sidebar.folded)) return null
  return compact<ScreenState>({
    workspaces,
    selected,
    sidebar: { ...prefs.sidebar, folded: sidebar.folded },
    viewMode: prefs.viewMode,
    canvas: prefs.canvas
  })
}

/** 줄 하나라도 읽지 못하면 표를 잃는다. 일부 줄만 버리면 줄끼리 가리키는 id 가 어긋나기 때문이다. */
function parseTable<R>(
  v: unknown,
  version: number,
  parseRow: (x: unknown) => R | null
): Table<R> | null {
  if (!isObj(v) || v.version !== version) return null
  const rows = parseList(v.rows, parseRow, true)
  return rows && { version, rows }
}

export const parseWorkspacesTable = (v: unknown): Table<WorkspaceRow> | null =>
  parseTable(v, STATE_VERSIONS.workspaces, parseWorkspaceRow)
export const parseCellsTable = (v: unknown): Table<CellRow> | null =>
  parseTable(v, STATE_VERSIONS.cells, parseCellRow)
export const parsePanesTable = (v: unknown): Table<PaneRow> | null =>
  parseTable(v, STATE_VERSIONS.panes, parsePaneRow)

function mapLayout<P, Q>(l: Layout<P>, f: (p: P) => Q): Layout<Q> {
  return 'pane' in l
    ? { pane: f(l.pane) }
    : { split: l.split, first: mapLayout(l.first, f), second: mapLayout(l.second, f) }
}

export type SplitScreen = {
  workspaces: Table<WorkspaceRow>
  cells: Table<CellRow>
  panes: Table<PaneRow>
  ptys: PanePty[]
  /** 선택한 cell 의 id 다. `view` 에 둔다. */
  selected?: string
}

export function splitScreen(screen: ScreenState): SplitScreen {
  const workspaces: WorkspaceRow[] = []
  const cells: CellRow[] = []
  const panes: PaneRow[] = []
  const ptys: PanePty[] = []
  let selected: string | undefined
  for (const { cells: wCells, ...rest } of screen.workspaces) {
    const w = omit(rest, 'key')
    workspaces.push(compact(w))
    for (const { key, panes: cPanes, layout, focused, ...c } of wCells) {
      if (key === screen.selected) selected = c.id
      const ids = new Map(cPanes.map((p) => [p.key, p.id]))
      cells.push({
        ...c,
        workspace: w.id,
        layout: mapLayout(layout, (k) => ids.get(k) ?? ''),
        focused: ids.get(focused) ?? cPanes[0].id
      })
      for (const p of cPanes) {
        panes.push({ ...omit(p, 'key', 'ptyId'), cell: c.id })
        ptys.push({ pane: p.id, pty: p.ptyId })
      }
    }
  }
  const table = <R>(version: number, rows: R[]): Table<R> => ({ version, rows })
  return {
    workspaces: table(STATE_VERSIONS.workspaces, workspaces),
    cells: table(STATE_VERSIONS.cells, cells),
    panes: table(STATE_VERSIONS.panes, panes),
    ptys,
    ...(selected !== undefined && { selected })
  }
}

/**
 * cell 의 즐겨찾기 표시는 그 workspace 의 `favorites` 에 있을 때만 남긴다. `workspaces` 표를 잃으면 `favorites` 가 비어,
 * cell 에 남은 표시가 없는 즐겨찾기를 가리키기 때문이다.
 */
function keepFavorites(w: SavedWorkspace): SavedWorkspace {
  const cells = w.cells.map((c) =>
    c.favorite === undefined || w.favorites?.includes(c.favorite)
      ? c
      : compact({ ...c, favorite: undefined })
  )
  return { ...w, cells }
}

/** workspace·cell·pane 의 key 는 카운터 하나로 매기므로 셋을 모두 준다. */
export function layoutKeys(
  workspaces: { key: number; cells: { key: number; panes: { key: number }[] }[] }[]
): number[] {
  return workspaces.flatMap((w) => [
    w.key,
    ...w.cells.flatMap((c) => [c.key, ...c.panes.map((p) => p.key)])
  ])
}

function firstById<R extends { id: string }>(rows: R[]): R[] {
  const seen = new Set<string>()
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id))
}

export type Tables = {
  workspaces: Table<WorkspaceRow> | null
  cells: Table<CellRow> | null
  panes: Table<PaneRow> | null
}

/**
 * 표를 이어 renderer 가 되살릴 workspace 목록을 만든다. 잃은 표(null)는 그 표 만큼만 잃는다.
 * - `workspaces` 표에 없는 workspace 를 cell 이 가리키면, 그 id 로 이름 없는 workspace 를 cell 이 처음 나온 순서로 뒤에
 *   더한다.
 * - cell 의 배치가 가리키는 pane 이 `panes` 표에 그 cell 의 줄로 모두 있지 않거나 같은 pane 을 두 번 가리키면, 그 cell 을
 *   workspace 의 `dir` 에서 새 pane 하나로 연다.
 * - cell 이 없는 workspace 는 핀일 때만 남긴다.
 */
export function joinTables(
  t: Tables,
  selected?: string,
  newPaneId = (): string => randomId('n')
): SavedLayout | null {
  type Pane = Omit<LayoutPane, 'key'>
  type Cell = Omit<CellRow, 'workspace'> & { panes: Pane[] }
  type Building = WorkspaceRow & { cells: Cell[] }
  const list: Building[] = firstById(t.workspaces?.rows ?? []).map((w) => ({ ...w, cells: [] }))
  const byId = new Map(list.map((w) => [w.id, w]))
  const panesOf = new Map<string, PaneRow[]>()
  for (const p of firstById(t.panes?.rows ?? []))
    panesOf.set(p.cell, [...(panesOf.get(p.cell) ?? []), p])
  for (const { workspace, ...c } of firstById(t.cells?.rows ?? [])) {
    let w = byId.get(workspace)
    if (!w) {
      w = { id: workspace, cells: [] }
      byId.set(workspace, w)
      list.push(w)
    }
    const ids = leaves(c.layout)
    const own = (panesOf.get(c.id) ?? []).filter((p) => ids.includes(p.id))
    if (own.length === ids.length && new Set(ids).size === ids.length) {
      const focused = ids.includes(c.focused) ? c.focused : ids[0]
      w.cells.push({ ...c, focused, panes: own.map((p) => omit(p, 'cell')) })
    } else {
      const pane = compact({ id: newPaneId(), cwd: w.dir })
      w.cells.push({ ...c, layout: { pane: pane.id }, focused: pane.id, panes: [pane] })
    }
  }
  let next = 0
  let selectedKey: number | null = null
  const workspaces = list
    .filter((w) => w.pinned || w.cells.length)
    .map(({ cells: built, ...w }): SavedWorkspace => {
      const key = next++
      const cells = built.map(({ panes: rows, layout, focused, ...c }) => {
        const cellKey = next++
        if (c.id === selected) selectedKey = cellKey
        const keys = new Map<string, number>()
        const panes = rows.map((p) => {
          keys.set(p.id, next)
          return { key: next++, ...p }
        })
        const keyOf = (id: string): number => keys.get(id) as number
        return {
          key: cellKey,
          ...c,
          panes,
          layout: mapLayout(layout, keyOf),
          focused: keyOf(focused)
        }
      })
      return keepFavorites({ key, ...w, cells })
    })
  return workspaces.length ? { workspaces, selected: selectedKey } : null
}

export function screenPanes(
  screen: ScreenState | null,
  workspace?: string
): { panes: ScreenPane[]; cells: string[] } {
  const cells = (screen?.workspaces ?? [])
    .filter((w) => workspace === undefined || w.id === workspace)
    .flatMap((w) => w.cells)
  return { panes: cells.flatMap((c) => c.panes), cells: cells.map((c) => c.id) }
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width))
}

export function clampCanvasWidth(width: number): number {
  return Math.max(CANVAS_MIN_WIDTH, width)
}

/**
 * 필드마다 따로 읽어 틀린 필드만 버린다. `parseScreen` 이 `ScreenState` 를, `parseViewPart`(`main/state.ts`)가
 * `state.json` 의 `view` 를 넘긴다. 그래서 `viewMode`·`sidebar`·`canvas` 의 이름을 바꾸면 `ScreenState` 의 것도
 * 같이 바꾸고 `view` 의 버전을 올린다.
 */
export function parseViewPrefs(v: unknown): ViewPrefs {
  if (!isObj(v)) return {}
  const { viewMode, sidebar, canvas, folded } = v
  const prefs: ViewPrefs = {}
  if (viewMode === 'single' || viewMode === 'columns') prefs.viewMode = viewMode
  if (isObj(sidebar) && typeof sidebar.open === 'boolean' && typeof sidebar.width === 'number')
    prefs.sidebar = { open: sidebar.open, width: clampSidebarWidth(sidebar.width) }
  if (isStrings(folded)) prefs.folded = [...folded]
  if (isObj(canvas) && typeof canvas.width === 'number')
    prefs.canvas = { width: clampCanvasWidth(canvas.width) }
  return prefs
}
