import type { Layout } from './layout'
import { isSessionId } from './session'

/**
 * 재시작 전 앱이 쓰고 다시 뜬 앱이 읽으므로 두 앱의 빌드가 다를 수 있다. 다시 뜬 앱이 옛 모양을 읽지 못하게
 * 바꾸면 버전을 올린다 — 다시 뜬 앱은 모르는 버전을 되살리지 않는다. 없어도 되는 필드를 더할 때는 올리지 않는다.
 */
export const SCREEN_VERSION = 1

export type ScreenPane = {
  key: number
  sessionId: string
  startDir?: string
  command?: string[]
  cwd?: string
  title?: string
}

export type ScreenWorkspace = {
  key: number
  id: string
  panes: ScreenPane[]
  layout: Layout
  focused: number
  /**
   * `openFrom` 으로 띄웠을 때 부른 workspace 의 key 다. 부른 workspace 가 닫히면 그것을 부른 workspace 의 key 로
   * 바뀌고, 부른 쪽이 모두 닫혔으면 없다. 이 필드를 더하기 전 빌드가 쓴 화면에도 없다.
   */
  openedBy?: number
}

export type ScreenState = {
  version: typeof SCREEN_VERSION
  workspaces: ScreenWorkspace[]
  selected: number | null
  sidebar: { open: boolean; width: number; folded: number[] }
  viewMode: 'single' | 'columns'
  /** 폭을 끌어 바꾼 적이 없으면 없다 — 그동안은 창 폭에 비례하는 기본 폭을 쓴다. */
  canvas?: { width: number }
}

const SIDEBAR_WIDTH = { min: 200, max: 480 }
const CANVAS_MIN_WIDTH = 240

/**
 * 재시작이 아닌 실행에서도 되살리는 화면 설정이다. 사이드바의 접힌 workspace 목록(`folded`)은 넣지 않는다.
 * 일반 실행은 workspace 를 되살리지 않아 `folded` 의 key 가 가리킬 workspace 가 없기 때문이다.
 */
export type ViewPrefs = {
  viewMode?: ScreenState['viewMode']
  sidebar?: { open: boolean; width: number }
  canvas?: ScreenState['canvas']
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKey = (v: unknown): v is number => Number.isInteger(v)
const optString = (v: unknown): boolean => v === undefined || typeof v === 'string'
const optKey = (v: unknown): boolean => v === undefined || isKey(v)

function isLayout(v: unknown): v is Layout {
  if (!isObj(v)) return false
  if ('pane' in v) return isKey(v.pane)
  return (v.split === 'right' || v.split === 'down') && isLayout(v.first) && isLayout(v.second)
}

function isPane(v: unknown): v is ScreenPane {
  return (
    isObj(v) &&
    isKey(v.key) &&
    isSessionId(v.sessionId) &&
    optString(v.startDir) &&
    optString(v.cwd) &&
    optString(v.title) &&
    (v.command === undefined ||
      (Array.isArray(v.command) && v.command.every((a) => typeof a === 'string')))
  )
}

function isWorkspace(v: unknown): v is ScreenWorkspace {
  return (
    isObj(v) &&
    isKey(v.key) &&
    typeof v.id === 'string' &&
    Array.isArray(v.panes) &&
    v.panes.length > 0 &&
    v.panes.every(isPane) &&
    isLayout(v.layout) &&
    isKey(v.focused) &&
    optKey(v.openedBy)
  )
}

export function parseScreen(v: unknown): ScreenState | null {
  if (!isObj(v) || v.version !== SCREEN_VERSION) return null
  const { workspaces, selected, sidebar } = v
  if (!Array.isArray(workspaces) || !workspaces.every(isWorkspace)) return null
  if (selected !== null && !isKey(selected)) return null
  const prefs = parseViewPrefs(v)
  if (!prefs.viewMode || !prefs.sidebar) return null
  if (v.canvas !== undefined && !prefs.canvas) return null
  if (!isObj(sidebar) || !Array.isArray(sidebar.folded) || !sidebar.folded.every(isKey)) return null
  return v as ScreenState
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
