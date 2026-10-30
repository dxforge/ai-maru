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
export const STATE_VERSIONS: { layout: number; sessions: number; view: number } = versions

/**
 * `cwd`·`title`·`git` 은 저장할 때 화면에 보이던 값이다. main 은 `maru pane list` 의 이름을 이 값으로 짓고, 다시 뜬
 * 앱은 pty 의 상태가 오기 전까지 이 값을 보인다. `keep` 은 런처로 띄운 pane 에 붙는다. 앱은 그 pane 의 pty 를
 * `--keep` 으로 띄우고, 명령이 실패하면(`failedExit`) pane 을 남긴다.
 */
export type LayoutPane = {
  key: number
  startDir?: string
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
}

type WorkspaceOf<P> = { key: number; id: string; cells: CellOf<P>[] }

export type ScreenCell = CellOf<ScreenPane>
export type ScreenWorkspace = WorkspaceOf<ScreenPane>
type LayoutWorkspace = WorkspaceOf<LayoutPane>

/** renderer 가 화면이 바뀔 때마다 main 에 보내는 화면이다. main 은 이것을 `state.json` 의 세 부분으로 나눠 쓴다. */
export type ScreenState = {
  workspaces: ScreenWorkspace[]
  /** 선택한 cell 의 key 다. */
  selected: number | null
  sidebar: { open: boolean; width: number; folded: number[] }
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

/**
 * 뜰 때 main 이 renderer 에 주는 복원할 것이다. `ptys` 는 pane key 마다 붙을 pty 이고, null 이면 모든 pane 이 새 셸을
 * 띄운다. `notice` 는 사용자가 고르지 않았는데 세션이나 레이아웃을 잃은 이유다.
 */
export type Restore = {
  layout: LayoutPart | null
  ptys: Record<number, string> | null
  notice: 'layout' | 'sessions' | 'protocol' | null
}

const SIDEBAR_WIDTH = { min: 200, max: 480 }
const CANVAS_MIN_WIDTH = 240

/**
 * 첫 화면을 그리기 전에 renderer 가 받는 보기 설정이다. `folded` 는 접힌 workspace 의 key 다. 레이아웃을 되살리지
 * 않으면 가리킬 workspace 가 없어 renderer 가 쓰지 않는다.
 */
export type ViewPrefs = {
  viewMode?: ScreenState['viewMode']
  sidebar?: { open: boolean; width: number }
  folded?: number[]
  canvas?: ScreenState['canvas']
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKey = (v: unknown): v is number => Number.isInteger(v)
const optString = (v: unknown): v is string | undefined => v === undefined || typeof v === 'string'

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
  if (
    command !== undefined &&
    !(Array.isArray(command) && command.every((a): a is string => typeof a === 'string'))
  )
    return null
  const git = v.git === undefined ? undefined : parseGit(v.git)
  if (git === null) return null
  if (v.keep !== undefined && v.keep !== true) return null
  const keep = v.keep === true || undefined
  return compact({
    key: v.key,
    startDir: v.startDir,
    command,
    keep,
    cwd: v.cwd,
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
  const { fontSize, paneCols } = v
  if (fontSize !== undefined && !(typeof fontSize === 'number' && Number.isFinite(fontSize)))
    return null
  if (paneCols !== undefined && !(isKey(paneCols) && paneCols > 0)) return null
  const panes = parseList(v.panes, parsePane)
  const layout = parseLayout(v.layout)
  if (!panes || !layout) return null
  return compact({ key: v.key, id: v.id, panes, layout, focused: v.focused, fontSize, paneCols })
}

function parseWorkspaces<P>(
  v: unknown,
  parsePane: (x: unknown) => P | null
): WorkspaceOf<P>[] | null {
  return parseList(
    v,
    (w): WorkspaceOf<P> | null => {
      if (!isObj(w) || !isKey(w.key) || typeof w.id !== 'string') return null
      const cells = parseList(w.cells, (c) => parseCell(c, parsePane))
      return cells && { key: w.key, id: w.id, cells }
    },
    true
  )
}

export function parseScreen(v: unknown): ScreenState | null {
  if (!isObj(v)) return null
  const { selected, sidebar } = v
  const workspaces = parseWorkspaces(v.workspaces, parseScreenPane)
  if (!workspaces) return null
  if (selected !== null && !isKey(selected)) return null
  const prefs = parseViewPrefs(v)
  if (!prefs.viewMode || !prefs.sidebar) return null
  if (v.canvas !== undefined && !prefs.canvas) return null
  if (!isObj(sidebar) || !Array.isArray(sidebar.folded) || !sidebar.folded.every(isKey)) return null
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
  const workspaces = parseWorkspaces(v.workspaces, parseLayoutPane)
  if (!workspaces) return null
  if (v.selected !== null && !isKey(v.selected)) return null
  return { version: STATE_VERSIONS.layout, workspaces, selected: v.selected }
}

export function splitScreen(screen: ScreenState): {
  layout: LayoutPart
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
  return {
    layout: { version: STATE_VERSIONS.layout, workspaces, selected: screen.selected },
    ptys
  }
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
 * `state.json` 의 `view` 를 넘긴다. 그래서 `viewMode`·`sidebar`·`canvas`·`folded` 의 이름을 바꾸면 `ScreenState` 의
 * 것도 같이 바꾸고 `view` 의 버전을 올린다.
 */
export function parseViewPrefs(v: unknown): ViewPrefs {
  if (!isObj(v)) return {}
  const { viewMode, sidebar, canvas, folded } = v
  const prefs: ViewPrefs = {}
  if (viewMode === 'single' || viewMode === 'columns') prefs.viewMode = viewMode
  if (isObj(sidebar) && typeof sidebar.open === 'boolean' && typeof sidebar.width === 'number')
    prefs.sidebar = { open: sidebar.open, width: clampSidebarWidth(sidebar.width) }
  if (Array.isArray(folded) && folded.every(isKey)) prefs.folded = [...folded]
  if (isObj(canvas) && typeof canvas.width === 'number')
    prefs.canvas = { width: clampCanvasWidth(canvas.width) }
  return prefs
}
