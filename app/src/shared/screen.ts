import type { GitHead } from './git'
import type { Layout } from './layout'
import { isPtyId } from './pty'

/**
 * 재시작 전 앱이 쓰고 다시 뜬 앱이 읽으므로 두 앱의 빌드가 다를 수 있다. 다시 뜬 앱이 옛 모양을 읽지 못하게
 * 바꾸면 버전을 올린다 — 다시 뜬 앱은 모르는 버전을 되살리지 않는다. 없어도 되는 필드를 더할 때는 올리지 않는다.
 * 그 필드는 해당 parse 함수에서도 옮긴다. `parseScreen` 은 아는 필드만 옮기고, 선택 필드는 빠뜨려도 타입 검사를
 * 통과하기 때문이다.
 */
export const SCREEN_VERSION = 3

/**
 * `cwd`·`title`·`git` 은 저장할 때 화면에 보이던 값이다. main 은 `maru mate list` 의 이름을 이 값으로 짓고, 다시 뜬
 * 앱은 pty 의 상태가 오기 전까지 이 값을 보인다. `keep` 은 런처로 띄운 pane 에 붙는다. pty 를 `--keep` 으로 띄우고,
 * 명령이 0 이 아닌 코드나 시그널로 끝나면 pane 을 남긴다.
 */
export type ScreenPane = {
  key: number
  ptyId: string
  startDir?: string
  command?: string[]
  keep?: true
  cwd?: string
  title?: string
  git?: GitHead
}

export type ScreenCell = {
  key: number
  id: string
  panes: ScreenPane[]
  layout: Layout
  focused: number
  fontSize?: number
  /** columns 보기에서 늘어선 pane 하나가 받는 터미널 열 수. 없으면 설정 파일의 `layout.column-cols` 다. */
  paneCols?: number
}

export type ScreenWorkspace = {
  key: number
  id: string
  cells: ScreenCell[]
}

export type ScreenState = {
  version: typeof SCREEN_VERSION
  workspaces: ScreenWorkspace[]
  /** 선택한 cell 의 key 다. */
  selected: number | null
  sidebar: { open: boolean; width: number; folded: number[] }
  viewMode: 'single' | 'columns'
  /** 폭을 끌어 바꾼 적이 없으면 없다 — 그동안은 창 폭에 비례하는 기본 폭을 쓴다. */
  canvas?: { width: number }
}

const SIDEBAR_WIDTH = { min: 200, max: 480 }
const CANVAS_MIN_WIDTH = 240

/**
 * 재시작이 아닌 실행에서도 되살리는 화면 설정이다. 사이드바의 접힌 workspace 목록(`folded`)은 넣지
 * 않는다. 일반 실행은 workspace 를 되살리지 않아 `folded` 의 key 가 가리킬 것이 없기 때문이다.
 */
export type ViewPrefs = {
  viewMode?: ScreenState['viewMode']
  sidebar?: { open: boolean; width: number }
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

function parsePane(v: unknown): ScreenPane | null {
  if (
    !isObj(v) ||
    !isKey(v.key) ||
    !isPtyId(v.ptyId) ||
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
    ptyId: v.ptyId,
    startDir: v.startDir,
    command,
    keep,
    cwd: v.cwd,
    title: v.title,
    git
  })
}

function parseCell(v: unknown): ScreenCell | null {
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

function parseWorkspace(v: unknown): ScreenWorkspace | null {
  if (!isObj(v) || !isKey(v.key) || typeof v.id !== 'string') return null
  const cells = parseList(v.cells, parseCell)
  return cells && { key: v.key, id: v.id, cells }
}

export function parseScreen(v: unknown): ScreenState | null {
  if (!isObj(v) || v.version !== SCREEN_VERSION) return null
  const { selected, sidebar } = v
  const workspaces = parseList(v.workspaces, parseWorkspace, true)
  if (!workspaces) return null
  if (selected !== null && !isKey(selected)) return null
  const prefs = parseViewPrefs(v)
  if (!prefs.viewMode || !prefs.sidebar) return null
  if (v.canvas !== undefined && !prefs.canvas) return null
  if (!isObj(sidebar) || !Array.isArray(sidebar.folded) || !sidebar.folded.every(isKey)) return null
  return compact<ScreenState>({
    version: SCREEN_VERSION,
    workspaces,
    selected,
    sidebar: { ...prefs.sidebar, folded: sidebar.folded },
    viewMode: prefs.viewMode,
    canvas: prefs.canvas
  })
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
 * `parseScreen` 과 `viewPrefs()`(`main/index.ts`)가 `ScreenState` 도 넘기므로, 이 함수는 그 안에서
 * `viewMode`, `sidebar` 의 열림·폭, `canvas` 의 폭만 골라 돌려준다. `ViewPrefs` 의 필드 이름을 바꾸면 `ScreenState` 의
 * 것도 같이 바꿔야 한다.
 */
export function parseViewPrefs(v: unknown): ViewPrefs {
  if (!isObj(v)) return {}
  const { viewMode, sidebar, canvas } = v
  const prefs: ViewPrefs = {}
  if (viewMode === 'single' || viewMode === 'columns') prefs.viewMode = viewMode
  if (isObj(sidebar) && typeof sidebar.open === 'boolean' && typeof sidebar.width === 'number')
    prefs.sidebar = { open: sidebar.open, width: clampSidebarWidth(sidebar.width) }
  if (isObj(canvas) && typeof canvas.width === 'number')
    prefs.canvas = { width: clampCanvasWidth(canvas.width) }
  return prefs
}
