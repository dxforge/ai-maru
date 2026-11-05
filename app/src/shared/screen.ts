import versions from '../../resources/state-versions.json'
import type { GitHead } from './git'
import type { Layout } from './layout'
import { isPtyId } from './pty'

/**
 * `state.json` 의 부분마다의 형식 버전이다. 번들의 `state-versions.json` 에서 읽어, 재시작 전 앱이 설치된 빌드의 같은 파일과
 * 견줄 수 있게 한다(`main/restart.ts`). 다음에 뜰 앱이 옛 모양을 읽지 못하게 바꾸면 그 부분의 버전을 올린다 — 다음에 뜬
 * 앱은 모르는 버전의 부분을 버린다. 없어도 되는 필드를 더할 때는 올리지 않는다. 그 필드는 해당 parse 함수에서도 옮긴다.
 * parse 함수는 아는 필드만 옮기고, 선택 필드는 빠뜨려도 타입 검사를 통과하기 때문이다.
 */
export const STATE_VERSIONS: { layout: number; sessions: number; view: number; pins: number } =
  versions

/**
 * `cwd`·`title`·`git` 은 저장할 때 화면에 보이던 값이다. main 은 `maru pane list` 의 이름을 이 값으로 짓고, 다시 뜬
 * 앱은 pty 의 상태가 오기 전까지 이 값을 보인다. `keep` 은 런처로 띄운 pane 에 붙는다. 앱은 그 pane 의 pty 를
 * `--keep` 으로 띄우고, 명령이 실패하면(`failedExit`) pane 을 남긴다.
 */
export type LayoutPane = {
  key: number
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
 * `name` 은 사용자가 바꾼 이름이다. 없으면 첫 cell 의 첫 pane 으로 이름을 짓고, cell 이 없으면 `dir` 로 짓는다
 * (`workspaceName`). `pinned` 인 workspace 는 마지막 cell 을 닫아도 남고, 그때 닫은 cell 의 디렉토리를 `dir` 에 적는다.
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

/**
 * `layout` 의 workspace 다. 핀 workspace 는 `key`·`id`·`cells` 만 두고, `id` 로 `pins` 의 항목과 잇는다. 핀 workspace 는
 * cell 이 없어도 key 를 남기려고 여기에 두므로 `cells` 가 비어 있을 수 있다. 핀이 없는 workspace 는 이름·`dir`·
 * `favorites` 도 여기에 둔다. `layout` 을 잃으면 어차피 함께 사라지기 때문이다.
 */
type LayoutWorkspace = Omit<SavedWorkspace, 'pinned'>

/** `pins` 의 항목이다. `dir` 은 cell 이 있으면 첫 cell 의 첫 pane 의 cwd 다. `layout` 만 잃으면 그 디렉토리로 이름을 짓는다. */
type PinnedWorkspace = Pick<SavedWorkspace, 'id' | 'name' | 'dir' | 'favorites'>

/** renderer 가 화면이 바뀔 때마다 main 에 보내는 화면이다. main 은 이것을 `state.json` 의 네 부분으로 나눠 쓴다. */
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

/** `state.json` 의 `layout`. pane 이 어느 pty 에 붙는지는 `sessions` 에 있다. */
export type LayoutPart = {
  version: number
  workspaces: LayoutWorkspace[]
  selected: number | null
}

/** `state.json` 의 `pins`. 핀 workspace 를 사이드바의 순서대로 둔다. */
export type PinsPart = {
  version: number
  workspaces: PinnedWorkspace[]
}

/** `layout`·`pins` 를 `joinLayout` 으로 이은, renderer 가 되살릴 workspace 목록이다. */
export type SavedLayout = { workspaces: SavedWorkspace[]; selected: number | null }

/** 사용자가 고르지 않았는데 잃은 부분이다. `protocol` 은 pty 프로토콜이 달라 `sessions` 를 버린 것이다. */
export type RestoreNotice = 'layout' | 'pins' | 'sessions' | 'protocol'

/**
 * 뜰 때 main 이 renderer 에 주는 복원할 것이다. `ptys` 는 pane key 마다 붙을 pty 이고, null 이면 모든 pane 이 새 셸을
 * 띄운다. `pins` 는 다른 부분과 함께 잃을 수 있으므로 `notice` 는 목록이다.
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

function parseLayout(v: unknown): Layout | null {
  if (!isObj(v)) return null
  if ('pane' in v) return isKey(v.pane) ? { pane: v.pane } : null
  if (v.split !== 'right' && v.split !== 'down') return null
  const first = parseLayout(v.first)
  const second = parseLayout(v.second)
  return first && second ? { split: v.split, first, second } : null
}

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

function parseLayoutPane(v: unknown): LayoutPane | null {
  if (
    !isObj(v) ||
    !isKey(v.key) ||
    !optString(v.startDir) ||
    !optString(v.cwd) ||
    !optString(v.title)
  )
    return null
  const { command } = v
  if (command !== undefined && !isStrings(command)) return null
  const git = v.git === undefined ? undefined : parseGit(v.git)
  if (git === null) return null
  if (v.keep !== undefined && v.keep !== true) return null
  const keep = v.keep === true || undefined
  return compact({
    key: v.key,
    command,
    keep,
    // 옛 앱은 pane 을 띄운 디렉토리를 `startDir` 에 따로 저장했다. `cwd` 를 모르던 pane 은 그 디렉토리로 되살린다.
    cwd: v.cwd ?? v.startDir,
    title: v.title,
    git
  })
}

function parseScreenPane(v: unknown): ScreenPane | null {
  const pane = parseLayoutPane(v)
  const { ptyId } = v as Obj
  return pane && isPtyId(ptyId) ? { ...pane, ptyId } : null
}

function parseCell<P>(v: unknown, parsePane: (x: unknown) => P | null): CellOf<P> | null {
  if (!isObj(v) || !isKey(v.key) || typeof v.id !== 'string' || !isKey(v.focused)) return null
  const { fontSize, paneCols, favorite } = v
  if (!optString(favorite)) return null
  if (fontSize !== undefined && !(typeof fontSize === 'number' && Number.isFinite(fontSize)))
    return null
  if (paneCols !== undefined && !(isKey(paneCols) && paneCols > 0)) return null
  const panes = parseList(v.panes, parsePane)
  const layout = parseLayout(v.layout)
  if (!panes || !layout) return null
  return compact({
    key: v.key,
    id: v.id,
    panes,
    layout,
    focused: v.focused,
    fontSize,
    paneCols,
    favorite
  })
}

function parseWorkspaceFields(w: unknown): PinnedWorkspace | null {
  if (!isObj(w) || typeof w.id !== 'string') return null
  const { name: given, dir, favorites } = w
  if (!optString(given) || !optString(dir)) return null
  if (favorites !== undefined && !isStrings(favorites)) return null
  // `rename`(`store.ts`)이 빈 이름을 받으면 이름을 지우는 것과 맞춰, 비었거나 공백뿐인 이름은 이름이 없는 것으로 본다.
  const name = given?.trim() ? given : undefined
  return compact({ id: w.id, name, dir, favorites: favorites?.length ? favorites : undefined })
}

/**
 * `pinnable` 이면 `pinned` 를 읽고, cell 이 빈 workspace 는 핀일 때만 받는다. 아니면(`layout`) `pinned` 를 읽지 않고
 * cell 이 빈 workspace 도 받는다. 핀인지는 `pins` 에 있으므로, 핀이 없는데 cell 이 빈 workspace 는 `joinLayout` 이
 * 버린다.
 */
function parseWorkspaces<P>(
  v: unknown,
  parsePane: (x: unknown) => P | null,
  pinnable: boolean
): WorkspaceOf<P>[] | null {
  return parseList(
    v,
    (w): WorkspaceOf<P> | null => {
      if (!isObj(w) || !isKey(w.key)) return null
      const fields = parseWorkspaceFields(w)
      const { pinned } = w
      if (!fields || (pinnable && pinned !== undefined && pinned !== true)) return null
      const isPinned = pinnable && pinned === true
      const allowEmpty = isPinned || !pinnable
      const cells = parseList(w.cells, (c) => parseCell(c, parsePane), allowEmpty)
      return cells && compact({ key: w.key, ...fields, pinned: isPinned || undefined, cells })
    },
    true
  )
}

export function parseScreen(v: unknown): ScreenState | null {
  if (!isObj(v)) return null
  const { selected, sidebar } = v
  const workspaces = parseWorkspaces(v.workspaces, parseScreenPane, true)
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

export function parseLayoutPart(v: unknown): LayoutPart | null {
  if (!isObj(v) || v.version !== STATE_VERSIONS.layout) return null
  const workspaces = parseWorkspaces(v.workspaces, parseLayoutPane, false)
  if (!workspaces) return null
  if (v.selected !== null && !isKey(v.selected)) return null
  return { version: STATE_VERSIONS.layout, workspaces, selected: v.selected }
}

export function parsePinsPart(v: unknown): PinsPart | null {
  if (!isObj(v) || v.version !== STATE_VERSIONS.pins) return null
  const workspaces = parseList(v.workspaces, parseWorkspaceFields, true)
  return workspaces && { version: STATE_VERSIONS.pins, workspaces }
}

type SplitLayout = { layout: LayoutPart; pins: PinsPart }

function splitLayout({ workspaces, selected }: SavedLayout): SplitLayout {
  const pins: PinnedWorkspace[] = []
  const laid = workspaces.map(({ pinned, ...w }): LayoutWorkspace => {
    if (!pinned) return w
    const { key, id, name, favorites, cells } = w
    // cell 이 있으면 첫 cell 의 첫 pane 의 cwd 를 `dir` 로 적는다. cell 이 있는 동안 `autoWorkspaceName`(`shared/names.ts`)이
    // 그 pane 으로 이름을 짓기 때문이다.
    const dir = cells.length ? cells[0].panes[0]?.cwd : w.dir
    pins.push(compact({ id, name, dir, favorites }))
    return { key, id, cells }
  })
  return {
    layout: { version: STATE_VERSIONS.layout, workspaces: laid, selected },
    pins: { version: STATE_VERSIONS.pins, workspaces: pins }
  }
}

export function splitScreen(screen: ScreenState): SplitLayout & {
  ptys: { pane: number; pty: string }[]
} {
  const ptys: { pane: number; pty: string }[] = []
  const workspaces = screen.workspaces.map((w) => ({
    ...w,
    cells: w.cells.map((c) => ({
      ...c,
      panes: c.panes.map(({ ptyId, ...p }) => {
        ptys.push({ pane: p.key, pty: ptyId })
        return p
      })
    }))
  }))
  return { ...splitLayout({ workspaces, selected: screen.selected }), ptys }
}

/**
 * cell 의 즐겨찾기 표시는 그 workspace 의 `favorites` 에 있을 때만 남긴다. `pins` 를 잃으면 `favorites` 가 비어, cell 에
 * 남은 표시가 없는 즐겨찾기를 가리키기 때문이다.
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

export function joinLayout(layout: LayoutPart | null, pins: PinsPart | null): SavedLayout | null {
  const laid = layout?.workspaces ?? []
  const byId = new Map(laid.map((w) => [w.id, w]))
  let next = Math.max(-1, ...layoutKeys(laid)) + 1
  const ids = new Set<string>()
  const pinned: SavedWorkspace[] = []
  for (const p of pins?.workspaces ?? []) {
    if (ids.has(p.id)) continue
    ids.add(p.id)
    const w = byId.get(p.id)
    pinned.push({ ...p, key: w?.key ?? next++, pinned: true, cells: w?.cells ?? [] })
  }
  const rest = laid.filter((w) => !ids.has(w.id) && w.cells.length)
  const workspaces = [...pinned, ...rest].map(keepFavorites)
  return workspaces.length ? { workspaces, selected: layout?.selected ?? null } : null
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
