import type { Layout } from './layout'
import { isSessionId } from './session'

/**
 * 재시작 전 앱이 쓰고 다시 뜬 앱이 읽으므로 두 앱의 빌드가 다를 수 있다. 모양을 바꾸면 버전을 올린다 —
 * 다시 뜬 앱은 모르는 버전을 되살리지 않는다.
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
}

export type ScreenState = {
  version: typeof SCREEN_VERSION
  workspaces: ScreenWorkspace[]
  selected: number | null
  sidebar: { open: boolean; width: number; folded: number[] }
  viewMode: 'single' | 'columns'
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKey = (v: unknown): v is number => Number.isInteger(v)
const optString = (v: unknown): boolean => v === undefined || typeof v === 'string'

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
    isKey(v.focused)
  )
}

export function parseScreen(v: unknown): ScreenState | null {
  if (!isObj(v) || v.version !== SCREEN_VERSION) return null
  const { workspaces, selected, sidebar, viewMode } = v
  if (!Array.isArray(workspaces) || !workspaces.every(isWorkspace)) return null
  if (selected !== null && !isKey(selected)) return null
  if (
    !isObj(sidebar) ||
    typeof sidebar.open !== 'boolean' ||
    typeof sidebar.width !== 'number' ||
    !Array.isArray(sidebar.folded) ||
    !sidebar.folded.every(isKey)
  )
    return null
  if (viewMode !== 'single' && viewMode !== 'columns') return null
  return v as ScreenState
}
