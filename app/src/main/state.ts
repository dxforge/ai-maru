import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PROTOCOL_VERSION } from '../shared/protocol'
import {
  parseLayoutPart,
  parseViewPrefs,
  parseScreen,
  splitScreen,
  STATE_VERSIONS,
  type LayoutPart,
  type Restore,
  type ViewPrefs
} from '../shared/screen'
import { parseWindowTheme, type WindowTheme } from '../shared/theme'
import { isPtyId } from '../shared/pty'
import { parseJobRecords, type JobRecord } from './job'
import { writeJsonAtomicSync } from './json-file'
import { parseWindowState, type WindowState } from './window-state'

/**
 * `state.json` 은 상태가 바뀔 때마다 쓰고 다음에 뜬 앱이 읽는다. 두 앱의 빌드가 다를 수 있어 세 부분에 따로 버전
 * (`STATE_VERSIONS`)을 두고 따로 읽는다. 잃었을 때의 결과가 부분마다 다르기 때문이다.
 * - `layout` — workspace·cell·pane 의 배치. 잃으면 빈 화면으로 뜬다.
 * - `sessions` — pane 마다 붙은 pty 와 job 표. 잃으면 레이아웃만 되살리고 pane 마다 새 셸을 띄운다. 둘은 함께 잇거나
 *   함께 버린다 — pane 의 pty 만 잇고 job 표를 버리면 job 을 띄운 claude 가 종료 알림을 받지 못한다.
 * - `view` — 보기 설정과 창. 필드마다 따로 읽어 틀린 필드만 버린다.
 */
export type StateFile = {
  layout: LayoutPart | null
  sessions: SessionsPart | null
  view: ViewPart
}

export type SessionsPart = {
  version: number
  ptys: { pane: number; pty: string }[]
  jobs: JobRecord[]
}

/** `theme` 은 마지막으로 적용한 테마다. 다음 실행의 첫 창이 renderer 가 그리기 전부터 그 배경색으로 뜨게 한다. */
type ViewPart = ViewPrefs & { version: number; window?: WindowState; theme?: WindowTheme }

/** `absent` 는 부분이 없거나 null 이다 — 처음 실행이거나 끌 때 비웠다. `bad` 는 있는데 읽지 못했다. */
type Part<T> = { kind: 'absent' } | { kind: 'bad' } | { kind: 'ok'; value: T }

export type ReadState = {
  layout: Part<LayoutPart>
  sessions: Part<SessionsPart>
  view: ViewPart
}

export function stateFile(userData: string): string {
  return join(userData, 'state.json')
}

/** 이 파일들을 쓰던 빌드의 상태는 옮기지 않는다. 남겨 두면 그 빌드로 돌아갔을 때 오래된 상태가 되살아난다. */
export function removeOldStateFiles(userData: string): void {
  for (const name of ['restart.json', 'window-state.json'])
    rmSync(join(userData, name), { force: true })
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function parseSessionsPart(v: unknown): SessionsPart | null {
  if (!isObj(v) || v.version !== STATE_VERSIONS.sessions || !Array.isArray(v.ptys)) return null
  const ptys = v.ptys.map((p) =>
    isObj(p) && Number.isInteger(p.pane) && isPtyId(p.pty)
      ? { pane: p.pane as number, pty: p.pty }
      : null
  )
  const jobs = parseJobRecords(v.jobs)
  if (!jobs || !ptys.every((p) => p !== null)) return null
  return { version: STATE_VERSIONS.sessions, ptys: ptys as SessionsPart['ptys'], jobs }
}

function parseViewPart(v: unknown): ViewPart {
  const view: ViewPart = { version: STATE_VERSIONS.view }
  if (!isObj(v) || v.version !== STATE_VERSIONS.view) return view
  const window = parseWindowState(v.window)
  const theme = parseWindowTheme(v.theme)
  return { ...view, ...parseViewPrefs(v), ...(window && { window }), ...(theme && { theme }) }
}

function part<T>(v: unknown, parse: (v: unknown) => T | null): Part<T> {
  if (v === undefined || v === null) return { kind: 'absent' }
  const value = parse(v)
  return value === null ? { kind: 'bad' } : { kind: 'ok', value }
}

export function readState(path: string): ReadState {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { layout: { kind: 'absent' }, sessions: { kind: 'absent' }, view: parseViewPart(null) }
  }
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    v = null
  }
  if (!isObj(v))
    return { layout: { kind: 'bad' }, sessions: { kind: 'bad' }, view: parseViewPart(null) }
  return {
    layout: part(v.layout, parseLayoutPart),
    sessions: part(v.sessions, parseSessionsPart),
    view: parseViewPart(v.view)
  }
}

type RestorePlan = { mode: 'full' | 'layout' | 'empty'; notice: Restore['notice'] }

/** 끝난 job 의 pty 도 넣는다. job 은 `--keep` 으로 떠, 끝난 뒤에도 `maru job read` 가 그 pty 의 화면을 읽기 때문이다. */
export function sessionPtys(s: SessionsPart): string[] {
  return [...s.ptys.map((p) => p.pty), ...s.jobs.map((j) => j.pty)]
}

/**
 * `protocolOf` 는 살아 있는 pty 의 프로토콜 버전이고, 살아 있지 않으면 undefined 다. 죽은 pty 는 판정에 넣지 않는다 —
 * 그 pane 은 붙을 때 `gone` 을 받아 새 셸을 띄운다. 프로토콜이 하나라도 다르면 모두 버린다. 일부만 이으면 job 과
 * pane 이 어긋나기 때문이다.
 */
export function restorePlan(
  read: Pick<ReadState, 'layout' | 'sessions'>,
  protocolOf: (pty: string) => number | null | undefined
): RestorePlan {
  if (read.layout.kind !== 'ok')
    return { mode: 'empty', notice: read.layout.kind === 'bad' ? 'layout' : null }
  if (read.sessions.kind === 'absent') return { mode: 'layout', notice: null }
  if (read.sessions.kind === 'bad') return { mode: 'layout', notice: 'sessions' }
  const differs = sessionPtys(read.sessions.value).some((pty) => {
    const v = protocolOf(pty)
    return v !== undefined && v !== PROTOCOL_VERSION
  })
  return differs ? { mode: 'layout', notice: 'protocol' } : { mode: 'full', notice: null }
}

/**
 * `keep` 은 pty 를 남기고, `layout` 은 `sessions` 를 비운다. `end` 는 `sessions` 를 비우고 `layout` 에서 핀 workspace 만
 * cell 없이 남긴다(`pinnedOnly`). `empty` 는 `layout`·`sessions` 를 비운다. `view` 는 늘 남는다.
 */
export type Outcome = 'keep' | 'layout' | 'end' | 'empty'

export type StateStore = {
  /** renderer 가 보낸 화면을 그대로 받는다. 자주 오므로 쓸 때 `parseScreen` 으로 검사하고, 틀리면 버린다. */
  setScreen(screen: unknown): void
  setJobs(jobs: JobRecord[]): void
  setWindow(window: WindowState): void
  setTheme(theme: WindowTheme): void
  discard(outcome: Exclude<Outcome, 'keep'>): void
  /** 이 전의 변경은 담기만 하고 쓰지 않는다. job 표를 되살리기 전에 쓰면 job 을 잃기 때문이다. */
  enable(): void
  /**
   * 고른 결과로 바로 쓰고, 그 뒤의 변경은 버린다. 끄는 동안 pty 가 끝나 pane 이 닫혀도 고른 결과가 남게 하기
   * 위해서다. 쓰지 못하면 던지고 끝내지 않은 채로 둔다.
   */
  finish(outcome: Outcome): void
  /**
   * 쓰지 않고 끝낸다. `finish` 가 던진 뒤에도 끄는 쪽이 부른다. 끄는 동안 pty 가 끝나 pane 이 닫힌 화면을 타이머가
   * 쓰면, 디스크에 남은 마지막 상태가 그 화면으로 바뀌기 때문이다.
   */
  stop(): void
  current(): StateFile
  /** `view()`·`layout()` 은 `current()` 와 달리 복사하지 않는다. 받은 쪽은 고치지 않는다. */
  view(): Readonly<ViewPrefs>
  layout(): Readonly<LayoutPart> | null
}

/**
 * 핀 workspace 만 cell 을 모두 닫은 모양으로 남긴다. cell 이 있던 workspace 의 `dir` 은 첫 cell 의 첫 pane 의 cwd 다.
 * cell 이 있는 동안 `autoWorkspaceName`(`shared/names.ts`)이 그 pane 으로 이름을 짓기 때문이다. 핀 workspace 가 없으면 null 이다.
 */
export function pinnedOnly(layout: LayoutPart): LayoutPart | null {
  const workspaces = layout.workspaces
    .filter((w) => w.pinned)
    .map((w) => {
      if (!w.cells.length) return w
      const dir = w.cells[0].panes[0]?.cwd
      const next = { ...w, cells: [] }
      if (dir === undefined) delete next.dir
      else next.dir = dir
      return next
    })
  return workspaces.length ? { ...layout, workspaces, selected: null } : null
}

function droppedLayout(layout: LayoutPart | null, outcome: Outcome): LayoutPart | null {
  if (outcome === 'empty') return null
  return outcome === 'end' && layout ? pinnedOnly(layout) : layout
}

function dropped(state: StateFile, outcome: Outcome): StateFile {
  return {
    ...state,
    sessions: outcome === 'keep' ? state.sessions : null,
    layout: droppedLayout(state.layout, outcome)
  }
}

export function createStateStore(o: {
  path: string
  debounceMs: number
  initial: StateFile
  onError?: (err: unknown) => void
}): StateStore {
  let state: StateFile = structuredClone(o.initial)
  let screen: unknown
  let enabled = false
  let finished = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const applyScreen = (): void => {
    if (screen === undefined) return
    const parsed = parseScreen(screen)
    screen = undefined
    if (!parsed) return
    const { layout, ptys } = splitScreen(parsed)
    const { viewMode, sidebar, canvas } = parsed
    const view: ViewPart = {
      ...state.view,
      viewMode,
      sidebar: { open: sidebar.open, width: sidebar.width },
      folded: [...sidebar.folded]
    }
    if (canvas) view.canvas = { ...canvas }
    else delete view.canvas
    state = { layout, sessions: { ...sessions(), ptys }, view }
  }
  const write = (): void => {
    clearTimeout(timer)
    timer = undefined
    applyScreen()
    try {
      writeJsonAtomicSync(o.path, state)
    } catch (err) {
      ;(o.onError ?? ((e) => console.error(`maru: cannot save ${o.path}:`, e)))(err)
    }
  }
  const changed = (): void => {
    if (enabled && !finished && timer === undefined) timer = setTimeout(write, o.debounceMs)
  }
  const sessions = (): SessionsPart =>
    state.sessions ?? { version: STATE_VERSIONS.sessions, ptys: [], jobs: [] }
  const update = (apply: () => void): void => {
    if (finished) return
    apply()
    changed()
  }
  const stop = (): void => {
    finished = true
    clearTimeout(timer)
    timer = undefined
  }
  return {
    setScreen: (next) => update(() => (screen = next)),
    // 넘겨받은 표를 그대로 둔다 — 부르는 쪽(`jobs.list()`)이 이미 복사해 준다.
    setJobs: (jobs) => update(() => (state.sessions = { ...sessions(), jobs })),
    setWindow: (window) => update(() => (state.view = { ...state.view, window })),
    setTheme: (theme) => update(() => (state.view = { ...state.view, theme })),
    discard(outcome) {
      applyScreen()
      state = dropped(state, outcome)
      changed()
    },
    enable() {
      enabled = true
      changed()
    },
    finish(outcome) {
      if (finished) return
      applyScreen()
      const next = dropped(state, outcome)
      writeJsonAtomicSync(o.path, next)
      state = next
      stop()
    },
    stop,
    current: () => {
      applyScreen()
      return structuredClone(state)
    },
    view: () => {
      applyScreen()
      return state.view
    },
    layout: () => {
      applyScreen()
      return state.layout
    }
  }
}
