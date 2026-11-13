import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseCellsTable,
  parsePanesTable,
  parseScreen,
  parseViewPrefs,
  parseWorkspacesTable,
  joinTables,
  layoutKeys,
  splitScreen,
  STATE_VERSIONS,
  type CellRow,
  type PanePty,
  type PaneRow,
  type RestoreNotice,
  type SavedLayout,
  type Table,
  type Tables,
  type ViewPrefs,
  type WorkspaceRow
} from '../shared/screen'
import { parseWindowTheme, type WindowTheme } from '../shared/theme'
import { isPtyId, randomId } from '../shared/pty'
import { parseJobRecords, type JobRecord } from './job'
import { writeJsonAtomicSync } from './json-file'
import { attachable } from './pty-protocol'
import type { PtyRecord } from './pty'
import { parseWindowState, type WindowState } from './window-state'

/**
 * `state.json` 은 상태가 바뀔 때마다 쓰고 다음에 뜬 앱이 읽는다. 두 앱의 빌드가 다를 수 있어 entity 마다 표를 두고, 표마다
 * 따로 버전(`STATE_VERSIONS`)을 두어 따로 읽는다. 표끼리는 id 로 잇고, 하나를 잃으면 그 표 만큼만 잃는다(`joinTables`).
 * - `workspaces` — workspace 의 순서와 이름·keep·`dir`·즐겨찾기. 잃으면 cell 이 가리키는 id 로 이름 없는 workspace 를
 *   다시 만들고, cell 이 없던 workspace 는 사라진다.
 * - `cells` — cell 과 pane 의 배치. 잃으면 keep 을 켠 workspace 만 cell 없이 뜬다.
 * - `panes` — pane 의 명령·디렉토리·제목. 잃으면 cell 마다 workspace 의 `dir` 에서 셸 하나를 띄운다.
 * - `sessions` — pane 마다 붙은 pty 와 job 표. 잃으면 배치만 되살리고 pane 마다 새 셸을 띄운다. 둘은 함께 잇거나
 *   함께 버린다 — pane 의 pty 만 잇고 job 표를 버리면 job 을 띄운 claude 가 종료 알림을 받지 못한다.
 * - `view` — 보기 설정과 창, 선택한 cell. 필드마다 따로 읽어 틀린 필드만 버린다.
 */
export type StateFile = Tables & {
  sessions: SessionsPart | null
  view: ViewPart
}

/** 끌 때나 재시작할 때 비울 수 있는 표다. */
export type TableName = 'workspaces' | 'cells' | 'panes' | 'sessions'

export type SessionsPart = {
  version: number
  ptys: PanePty[]
  jobs: JobRecord[]
}

/**
 * `theme` 은 마지막으로 적용한 테마다. 다음 실행의 첫 창이 renderer 가 그리기 전부터 그 배경색으로 뜨게 한다.
 * `selected` 는 선택한 cell 의 id 다.
 */
type ViewPart = ViewPrefs & {
  version: number
  window?: WindowState
  theme?: WindowTheme
  selected?: string
}

/** `absent` 는 표가 없거나 null 이다 — 처음 실행이거나 끌 때 비웠다. `bad` 는 있는데 읽지 못했다. */
type Part<T> = { kind: 'absent' } | { kind: 'bad' } | { kind: 'ok'; value: T }

export type ReadState = {
  workspaces: Part<Table<WorkspaceRow>>
  cells: Part<Table<CellRow>>
  panes: Part<Table<PaneRow>>
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
    isObj(p) && typeof p.pane === 'string' && isPtyId(p.pty) ? { pane: p.pane, pty: p.pty } : null
  )
  const jobs = parseJobRecords(v.jobs)
  if (!jobs || !ptys.every((p) => p !== null)) return null
  return { version: STATE_VERSIONS.sessions, ptys: ptys as PanePty[], jobs }
}

function parseViewPart(v: unknown): ViewPart {
  const view: ViewPart = { version: STATE_VERSIONS.view }
  if (!isObj(v) || v.version !== STATE_VERSIONS.view) return view
  const window = parseWindowState(v.window)
  const theme = parseWindowTheme(v.theme)
  const { selected } = v
  return {
    ...view,
    ...parseViewPrefs(v),
    ...(window && { window }),
    ...(theme && { theme }),
    ...(typeof selected === 'string' && { selected })
  }
}

function part<T>(v: unknown, parse: (v: unknown) => T | null): Part<T> {
  if (v === undefined || v === null) return { kind: 'absent' }
  const value = parse(v)
  return value === null ? { kind: 'bad' } : { kind: 'ok', value }
}

const unread = (kind: 'absent' | 'bad'): ReadState => ({
  workspaces: { kind },
  cells: { kind },
  panes: { kind },
  sessions: { kind },
  view: parseViewPart(null)
})

export function readState(path: string): ReadState {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return unread('absent')
  }
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    v = null
  }
  if (!isObj(v)) return unread('bad')
  return {
    workspaces: part(v.workspaces, parseWorkspacesTable),
    cells: part(v.cells, parseCellsTable),
    panes: part(v.panes, parsePanesTable),
    sessions: part(v.sessions, parseSessionsPart),
    view: parseViewPart(v.view)
  }
}

const okValue = <T>(p: Part<T>): T | null => (p.kind === 'ok' ? p.value : null)

/** `cells` 를 잃으면 `panes`·`sessions` 를, `panes` 를 잃으면 `sessions` 를 비운다. 이을 cell·pane 이 없기 때문이다. */
export function initialState(read: ReadState): StateFile {
  const cells = okValue(read.cells)
  const panes = cells && okValue(read.panes)
  return {
    workspaces: okValue(read.workspaces),
    cells,
    panes,
    sessions: panes && okValue(read.sessions),
    view: read.view
  }
}

type RestorePlan = { mode: 'full' | 'layout' | 'empty'; notice: RestoreNotice[] }

/** 끝난 job 의 pty 도 넣는다. job 은 `--keep` 으로 떠, 끝난 뒤에도 `maru job read` 가 그 pty 의 화면을 읽기 때문이다. */
export function sessionPtys(s: SessionsPart): string[] {
  return [...s.ptys.map((p) => p.pty), ...s.jobs.map((j) => j.pty)]
}

/**
 * `protocolOf` 는 살아 있는 pty 의 프로토콜 버전이고, 살아 있지 않으면 undefined 다. 죽은 pty 는 판정에 넣지 않는다 —
 * 그 pane 은 붙을 때 `gone` 을 받아 새 셸을 띄운다. 앱이 붙을 수 없는 버전의 pty 가 하나라도 있으면 `sessions` 를 모두 버린다. 일부만
 * 이으면 job 과 pane 이 어긋나기 때문이다. 잃은 표는 그 아래 표를 함께 잃으므로(`initialState`), 아래 표의 손실은 알리지 않는다.
 */
export function restorePlan(
  read: Omit<ReadState, 'view'>,
  protocolOf: (pty: string) => number | null | undefined
): RestorePlan {
  const notice: RestoreNotice[] = []
  const check = (name: TableName): boolean => {
    if (read[name].kind === 'bad') notice.push(name)
    return read[name].kind === 'ok'
  }
  check('workspaces')
  if (!check('cells')) return { mode: 'empty', notice }
  if (!check('panes') || !check('sessions')) return { mode: 'layout', notice }
  const sessions = okValue(read.sessions)!
  const differs = sessionPtys(sessions).some((pty) => {
    const v = protocolOf(pty)
    return v !== undefined && !attachable(v)
  })
  if (differs) return { mode: 'layout', notice: [...notice, 'protocol'] }
  return { mode: 'full', notice }
}

/**
 * 전체 복원에서 되살린 pane 의 key 마다 붙을 pty(`attach`)와 남길 pty(`keep`)다. 되살리지 못한 pane 의 pty 는
 * `recoverPtys` 가 `Recovered` workspace 로 연다.
 */
export function fullRestore(
  layout: SavedLayout | null,
  s: SessionsPart
): { attach: Record<number, string>; keep: string[] } {
  const attach = restorePtys(layout, s)
  return { attach, keep: [...Object.values(attach), ...s.jobs.map((j) => j.pty)] }
}

/** 되살린 pane 의 key 마다 붙을 pty 다. `sessions` 에 없는 pane(새로 연 pane)은 새 셸을 띄운다. */
export function restorePtys(layout: SavedLayout | null, s: SessionsPart): Record<number, string> {
  const ptyOf = new Map(s.ptys.map((p) => [p.pane, p.pty]))
  const panes = (layout?.workspaces ?? []).flatMap((w) => w.cells.flatMap((c) => c.panes))
  return Object.fromEntries(
    panes.flatMap((p) => {
      const pty = ptyOf.get(p.id)
      return pty ? [[p.key, pty]] : []
    })
  )
}

const RECOVERED_NAME = 'Recovered'

/**
 * 붙을 pane 이 없는 살아 있는 pty 를 끄지 않고, 목록 끝에 더한 `Recovered` workspace 에 pty 하나를 cell 하나로 연다.
 * 표를 잃어도 그 pty 에서 돌던 프로그램이 꺼지지 않게 하기 위해서다. 앱이 붙을 수 없는 버전의 pty 는 넣지 않는다.
 */
export function recoverPtys(
  layout: SavedLayout | null,
  restored: { attach: Record<number, string>; keep: string[] },
  live: Pick<PtyRecord, 'id' | 'protocol_version' | 'created_at_ms'>[],
  newId: (prefix: string) => string = randomId
): {
  layout: SavedLayout | null
  attach: Record<number, string>
  keep: string[]
  recovered: number
} {
  const kept = new Set(restored.keep)
  const orphans = live
    .filter((r) => attachable(r.protocol_version) && !kept.has(r.id))
    .sort((a, b) => a.created_at_ms - b.created_at_ms)
  if (!orphans.length) return { layout, ...restored, recovered: 0 }
  let next = Math.max(-1, ...layoutKeys(layout?.workspaces ?? [])) + 1
  const attach = { ...restored.attach }
  const workspace = {
    key: next++,
    id: newId('w'),
    name: RECOVERED_NAME,
    cells: orphans.map((r) => {
      const key = next++
      const pane = next++
      attach[pane] = r.id
      return {
        key,
        id: newId('c'),
        panes: [{ key: pane, id: newId('n') }],
        layout: { pane },
        focused: pane
      }
    })
  }
  return {
    layout: {
      workspaces: [...(layout?.workspaces ?? []), workspace],
      selected: layout?.selected ?? workspace.cells[0].key
    },
    attach,
    keep: [...restored.keep, ...orphans.map((r) => r.id)],
    recovered: orphans.length
  }
}

/**
 * 뜰 때 붙을 pty, Recovered workspace 를 더한 배치, 알릴 것을 정한다. 재시작 대화창에서 고른 결과로
 * `cells`·`panes`·`sessions` 가운데 하나를 비웠으면 전체 복원이 아니고 `restorePlan` 의 `notice` 도 비어 있으므로
 * Recovered 를 알리지 않는다. 사용자가 대화창에서 이미 보았기 때문이다. 전체 복원에서 Recovered 가 생기면 사용자가
 * 모르는 사이에 pty 가 남은 것이라 알린다. 앱이 강제로 끝났거나 pty host 를 기다리다 시간을 넘긴 때가 그렇다.
 */
export function startRestore(
  read: Omit<ReadState, 'view'>,
  layout: SavedLayout | null,
  sessions: SessionsPart | null,
  live: Pick<PtyRecord, 'id' | 'protocol_version' | 'created_at_ms'>[],
  newId: (prefix: string) => string = randomId
): ReturnType<typeof recoverPtys> & RestorePlan {
  const protocols = new Map(live.map((r) => [r.id, r.protocol_version ?? null]))
  const p = restorePlan(read, (pty) => protocols.get(pty))
  const full = p.mode === 'full' && sessions ? fullRestore(layout, sessions) : null
  const r = recoverPtys(layout, full ?? { attach: {}, keep: [] }, live, newId)
  const notice: RestoreNotice[] =
    r.recovered && (p.mode === 'full' || p.notice.length) ? [...p.notice, 'recovered'] : p.notice
  return { ...r, mode: p.mode, notice }
}

/**
 * `keep` 은 pty 를 남기고, `layout` 은 `sessions` 를 비운다. `end` 는 `cells`·`panes`·`sessions` 를 비우고
 * `workspaces` 에는 keep 을 켠 workspace 줄만 남긴다. `view` 는 늘 남는다.
 */
export type Outcome = 'keep' | 'layout' | 'end'

/** `drop` 의 표는 결과와 상관없이 비운다. */
export type FinishOptions = { drop?: TableName[] }

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
  finish(outcome: Outcome, options?: FinishOptions): void
  /**
   * 쓰지 않고 끝낸다. `finish` 가 던진 뒤에도 끄는 쪽이 부른다. 끄는 동안 pty 가 끝나 pane 이 닫힌 화면을 타이머가
   * 쓰면, 디스크에 남은 마지막 상태가 그 화면으로 바뀌기 때문이다.
   */
  stop(): void
  current(): StateFile
  /** `current()` 와 달리 복사하지 않는다. 받은 쪽은 고치지 않는다. */
  view(): Readonly<ViewPrefs>
  paneCount(): number
}

function dropped(state: StateFile, outcome: Outcome): StateFile {
  if (outcome === 'keep') return state
  if (outcome === 'layout') return { ...state, sessions: null }
  const { workspaces } = state
  return {
    ...state,
    workspaces: workspaces && { ...workspaces, rows: workspaces.rows.filter((w) => w.kept) },
    cells: null,
    panes: null,
    sessions: null
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
    const { workspaces, cells, panes, ptys, selected } = splitScreen(parsed)
    const { viewMode, sidebar, canvas } = parsed
    const view: ViewPart = {
      ...state.view,
      viewMode,
      sidebar: { open: sidebar.open, width: sidebar.width },
      folded: [...sidebar.folded]
    }
    if (canvas) view.canvas = { ...canvas }
    else delete view.canvas
    if (selected !== undefined) view.selected = selected
    else delete view.selected
    state = { workspaces, cells, panes, sessions: { ...sessions(), ptys }, view }
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
    finish(outcome, options) {
      if (finished) return
      applyScreen()
      const next = dropped(state, outcome)
      for (const name of options?.drop ?? []) next[name] = null
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
    paneCount: () => {
      applyScreen()
      // `panes` 를 잃은 cell 도 pane 하나로 열리므로, 표의 줄 수가 아니라 다음에 뜰 화면의 pane 을 센다.
      const ws = joinTables(state)?.workspaces ?? []
      return ws.reduce((n, w) => n + w.cells.reduce((m, c) => m + c.panes.length, 0), 0)
    }
  }
}
