import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '../shared/protocol'
import {
  joinTables,
  layoutKeys,
  splitScreen,
  STATE_VERSIONS,
  type ScreenState
} from '../shared/screen'
import type { JobRecord } from './job'
import {
  createStateStore,
  initialState,
  readState,
  removeOldStateFiles,
  restorePlan,
  fullRestore,
  recoverPtys,
  restorePtys,
  sessionPtys,
  startRestore,
  type ReadState,
  type SessionsPart,
  type StateFile
} from './state'

const screen: ScreenState = {
  workspaces: [
    {
      key: 3,
      id: 'w-00000001',
      cells: [
        {
          key: 1,
          id: 'c-00000001',
          panes: [
            { key: 0, id: 'n-0000000a', ptyId: 'p-0000000a', cwd: '/tmp' },
            { key: 2, id: 'n-0000000b', ptyId: 'p-0000000b', command: ['sh'], title: 't' }
          ],
          layout: { split: 'right', first: { pane: 0 }, second: { pane: 2 } },
          focused: 2
        }
      ]
    }
  ],
  selected: 1,
  sidebar: { open: false, width: 300, folded: ['w-00000001'] },
  viewMode: 'columns'
}

const job: JobRecord = {
  pty: 'p-0000000c',
  cell: 'c-00000001',
  owner: 'p-0000000a',
  command: ['x'],
  pending: false
}

const { workspaces: screenWorkspaces, cells, panes, ptys } = splitScreen(screen)
// store 는 표끼리 맞는지 보지 않는다 — End everything 이 핀이나 즐겨찾기가 있는 줄만 남기는지 보려고 cell 없는 줄을 더한다.
const workspaces = {
  ...screenWorkspaces,
  rows: [
    ...screenWorkspaces.rows,
    { id: 'w-00000009', name: 'atlas', pinned: true as const },
    { id: 'w-0000000a', favorites: ['/r'] }
  ]
}
const sessions: SessionsPart = { version: STATE_VERSIONS.sessions, ptys, jobs: [job] }
const view = {
  version: STATE_VERSIONS.view,
  viewMode: 'single' as const,
  sidebar: { open: true, width: 250 },
  folded: ['w-00000001'],
  canvas: { width: 400 },
  window: { x: 1, y: 2, width: 800, height: 600, isMaximized: false, isFullScreen: true },
  theme: { background: '#101010', mode: 'dark' as const },
  selected: 'c-00000001'
}
const full: StateFile = { workspaces, cells, panes, sessions, view }
const none = { workspaces: null, cells: null, panes: null, sessions: null }

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maru-state-'))
  path = join(dir, 'state.json')
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

const write = (v: unknown): void => writeFileSync(path, JSON.stringify(v))
const saved = (): StateFile => JSON.parse(readFileSync(path, 'utf8'))
const ok = <T>(value: T) => ({ kind: 'ok' as const, value })

describe('readState', () => {
  it('다섯 표를 읽는다', () => {
    write(full)
    expect(readState(path)).toEqual({
      workspaces: ok(workspaces),
      cells: ok(cells),
      panes: ok(panes),
      sessions: ok(sessions),
      view
    })
  })

  it('파일이 없거나 표가 null 이면 absent 다', () => {
    const empty = {
      workspaces: { kind: 'absent' },
      cells: { kind: 'absent' },
      panes: { kind: 'absent' },
      sessions: { kind: 'absent' }
    }
    expect(readState(path)).toEqual({ ...empty, view: { version: STATE_VERSIONS.view } })
    write({ ...none, view })
    expect(readState(path)).toEqual({ ...empty, view })
  })

  it('JSON 이 깨졌으면 view 밖의 표는 모두 bad 다', () => {
    writeFileSync(path, '{nope')
    expect(readState(path)).toMatchObject({
      workspaces: { kind: 'bad' },
      cells: { kind: 'bad' },
      panes: { kind: 'bad' },
      sessions: { kind: 'bad' }
    })
  })

  it.each(['workspaces', 'cells', 'panes', 'sessions'] as const)(
    '%s 의 버전이 달라도 다른 표는 읽는다',
    (name) => {
      write({ ...full, [name]: { ...full[name], version: STATE_VERSIONS[name] + 1 } })
      const read = readState(path)
      expect(read[name]).toEqual({ kind: 'bad' })
      for (const other of ['workspaces', 'cells', 'panes', 'sessions'] as const)
        if (other !== name) expect(read[other].kind).toBe('ok')
      expect(read.view).toEqual(view)
    }
  )

  it('view 의 버전이 다르면 view 만 비운다', () => {
    write({ ...full, view: { ...view, version: STATE_VERSIONS.view + 1 } })
    expect(readState(path)).toMatchObject({
      cells: { kind: 'ok' },
      view: { version: STATE_VERSIONS.view }
    })
  })

  it('sessions 의 job 표나 pty 가 틀리면 sessions 를 통째로 버린다', () => {
    write({ ...full, sessions: { ...sessions, jobs: [{ ...job, pty: 'x' }] } })
    expect(readState(path).sessions).toEqual({ kind: 'bad' })
    write({ ...full, sessions: { ...sessions, ptys: [{ pane: 'n-0000000a', pty: '../x' }] } })
    expect(readState(path).sessions).toEqual({ kind: 'bad' })
    write({ ...full, sessions: { ...sessions, ptys: [{ pane: 0, pty: 'p-0000000a' }] } })
    expect(readState(path).sessions).toEqual({ kind: 'bad' })
  })

  it('view 는 틀린 필드만 버린다', () => {
    write({
      ...full,
      view: { ...view, viewMode: 'grid', window: { x: 1 }, theme: 'x', selected: 1 }
    })
    expect(readState(path).view).toEqual({
      version: view.version,
      sidebar: view.sidebar,
      folded: view.folded,
      canvas: view.canvas
    })
  })
})

describe('initialState', () => {
  const read = (over: Partial<ReadState> = {}): ReadState => ({
    workspaces: ok(workspaces),
    cells: ok(cells),
    panes: ok(panes),
    sessions: ok(sessions),
    view,
    ...over
  })

  it('읽은 표는 그대로 담고, 읽지 못한 표는 비운다', () => {
    expect(initialState(read({ workspaces: { kind: 'bad' } }))).toEqual({
      ...full,
      workspaces: null
    })
  })

  it.each(['absent', 'bad'] as const)(
    'cells 가 %s 면 panes·sessions 도 비우고 workspaces·view 는 남긴다',
    (kind) => {
      expect(initialState(read({ cells: { kind } }))).toEqual({ ...none, workspaces, view })
    }
  )

  it.each(['absent', 'bad'] as const)('panes 가 %s 면 sessions 도 비운다', (kind) => {
    expect(initialState(read({ panes: { kind } }))).toEqual({
      ...full,
      panes: null,
      sessions: null
    })
  })
})

describe('removeOldStateFiles', () => {
  it('restart.json·window-state.json 을 지우고 state.json 은 남긴다', () => {
    for (const name of ['restart.json', 'window-state.json', 'state.json'])
      writeFileSync(join(dir, name), '{}')
    removeOldStateFiles(dir)
    expect(existsSync(join(dir, 'restart.json'))).toBe(false)
    expect(existsSync(join(dir, 'window-state.json'))).toBe(false)
    expect(existsSync(join(dir, 'state.json'))).toBe(true)
  })
})

describe('restorePlan', () => {
  const read = (over: Partial<Omit<ReadState, 'view'>> = {}) => ({
    workspaces: ok(workspaces),
    cells: ok(cells),
    panes: ok(panes),
    sessions: ok(sessions),
    ...over
  })
  const live = (): number => PROTOCOL_VERSION

  it('다 읽고 프로토콜이 같으면 pty 에 다시 붙는다', () => {
    expect(restorePlan(read(), live)).toEqual({ mode: 'full', notice: [] })
  })

  it('cells 가 없으면 빈 화면이고, 읽지 못했으면 cells 만 알린다', () => {
    expect(restorePlan(read({ cells: { kind: 'absent' } }), live)).toEqual({
      mode: 'empty',
      notice: []
    })
    expect(restorePlan(read({ cells: { kind: 'bad' }, panes: { kind: 'bad' } }), live)).toEqual({
      mode: 'empty',
      notice: ['cells']
    })
  })

  it('panes 를 읽지 못했으면 panes 만 알리고 배치만 복원한다', () => {
    expect(restorePlan(read({ panes: { kind: 'bad' }, sessions: { kind: 'bad' } }), live)).toEqual({
      mode: 'layout',
      notice: ['panes']
    })
    expect(
      restorePlan(read({ panes: { kind: 'absent' }, sessions: { kind: 'absent' } }), live)
    ).toEqual({
      mode: 'layout',
      notice: []
    })
  })

  it('sessions 가 없으면 알리지 않고, 읽지 못했으면 알리며 배치만 복원한다', () => {
    expect(restorePlan(read({ sessions: { kind: 'absent' } }), live)).toEqual({
      mode: 'layout',
      notice: []
    })
    expect(restorePlan(read({ sessions: { kind: 'bad' } }), live)).toEqual({
      mode: 'layout',
      notice: ['sessions']
    })
  })

  it('workspaces 를 읽지 못했으면 알리고, 복원은 다른 표대로 한다 — 없으면 알리지 않는다', () => {
    expect(restorePlan(read({ workspaces: { kind: 'bad' } }), live)).toEqual({
      mode: 'full',
      notice: ['workspaces']
    })
    expect(
      restorePlan(read({ workspaces: { kind: 'bad' }, cells: { kind: 'bad' } }), live)
    ).toEqual({ mode: 'empty', notice: ['workspaces', 'cells'] })
    expect(restorePlan(read({ workspaces: { kind: 'absent' } }), live)).toEqual({
      mode: 'full',
      notice: []
    })
  })

  it('살아 있는 pty 하나라도 프로토콜이 다르면 배치만 복원하고 알린다 — job 의 pty 도 본다', () => {
    const other = (pty: string): number =>
      pty === job.pty ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION
    expect(restorePlan(read(), other)).toEqual({ mode: 'layout', notice: ['protocol'] })
    const unknown = (pty: string): number | null => (pty === job.pty ? null : PROTOCOL_VERSION)
    expect(restorePlan(read(), unknown).mode).toBe('layout')
  })

  it('죽은 pty 는 판정에 넣지 않는다', () => {
    const dead = (pty: string): number | undefined =>
      pty === job.pty ? undefined : PROTOCOL_VERSION
    expect(restorePlan(read(), dead)).toEqual({ mode: 'full', notice: [] })
  })
})

describe('sessionPtys', () => {
  it('pane 의 pty 와 끝난 job 을 포함한 모든 job 의 pty 다 — 끝난 job 도 maru job read 로 읽는다', () => {
    const ended = { ...sessions, jobs: [{ ...job, exit: { code: 3, signal: null } }] }
    expect(sessionPtys(ended)).toEqual(['p-0000000a', 'p-0000000b', job.pty])
  })
})

describe('restorePtys', () => {
  it('되살린 pane 의 key 마다 그 pane id 의 pty 를 주고, sessions 에 없는 pane 은 빼며, 되살리지 않은 pane 의 pty 는 주지 않는다', () => {
    const layout = joinTables({ workspaces, cells, panes })
    const keys = layout!.workspaces[0].cells[0].panes.map((p) => [p.id, p.key])
    expect(keys).toEqual([
      ['n-0000000a', 2],
      ['n-0000000b', 3]
    ])
    const s = {
      ...sessions,
      ptys: [
        { pane: 'n-0000000b', pty: 'p-0000000b' },
        { pane: 'n-0000000z', pty: 'p-0000000z' }
      ]
    }
    expect(restorePtys(layout, s)).toEqual({ 3: 'p-0000000b' })
    expect(restorePtys(null, sessions)).toEqual({})
    expect(fullRestore(layout, s)).toEqual({
      attach: { 3: 'p-0000000b' },
      keep: ['p-0000000b', job.pty]
    })
  })
})

describe('recoverPtys', () => {
  const ids = (): ((prefix: string) => string) => {
    let n = 0
    return (prefix) => `${prefix}-r${n++}`
  }
  const rec = (id: string, created: number, protocol = PROTOCOL_VERSION) => ({
    id,
    protocol_version: protocol,
    created_at_ms: created
  })

  it('붙을 pane 이 없는 pty 가 없으면 받은 그대로 돌려준다', () => {
    const layout = joinTables({ workspaces, cells, panes })
    const restored = fullRestore(layout, sessions)
    expect(recoverPtys(layout, restored, [rec('p-0000000a', 1)], ids())).toEqual({
      layout,
      ...restored,
      recovered: 0
    })
  })

  it('남기지 않은 같은 프로토콜의 pty 를 띄운 순서로 목록 끝 Recovered workspace 의 cell 하나씩으로 열고, 다른 프로토콜의 pty 는 넣지 않는다', () => {
    const layout = joinTables({ workspaces, cells, panes }, 'c-00000001')!
    const restored = { attach: { 3: 'p-0000000b' }, keep: ['p-0000000b'] }
    const live = [
      rec('p-0000000b', 1),
      rec('p-0000000e', 30),
      rec('p-0000000d', 20),
      rec('p-0000000f', 10, PROTOCOL_VERSION + 1)
    ]
    const r = recoverPtys(layout, restored, live, ids())
    expect(r.layout!.workspaces.slice(0, -1)).toEqual(layout.workspaces)
    expect(r.layout!.selected).toBe(layout.selected)
    const k = Math.max(...layoutKeys(layout.workspaces)) + 1
    expect(r.layout!.workspaces.at(-1)).toEqual({
      key: k,
      id: 'w-r0',
      name: 'Recovered',
      cells: [
        {
          key: k + 1,
          id: 'c-r1',
          panes: [{ key: k + 2, id: 'n-r2' }],
          layout: { pane: k + 2 },
          focused: k + 2
        },
        {
          key: k + 3,
          id: 'c-r3',
          panes: [{ key: k + 4, id: 'n-r4' }],
          layout: { pane: k + 4 },
          focused: k + 4
        }
      ]
    })
    expect(r.attach).toEqual({ 3: 'p-0000000b', [k + 2]: 'p-0000000d', [k + 4]: 'p-0000000e' })
    expect(r.keep).toEqual(['p-0000000b', 'p-0000000d', 'p-0000000e'])
    expect(r.recovered).toBe(2)
  })

  it('저장한 배치가 없으면 Recovered workspace 만 두고 그 첫 cell 을 고른다', () => {
    const r = recoverPtys(null, { attach: {}, keep: [] }, [rec('p-0000000a', 1)], ids())
    expect(r.layout).toEqual({
      workspaces: [
        {
          key: 0,
          id: 'w-r0',
          name: 'Recovered',
          cells: [
            { key: 1, id: 'c-r1', panes: [{ key: 2, id: 'n-r2' }], layout: { pane: 2 }, focused: 2 }
          ]
        }
      ],
      selected: 1
    })
    expect(r.attach).toEqual({ 2: 'p-0000000a' })
  })

  it('고른 cell 이 없는 배치면 Recovered 의 첫 cell 을 고른다', () => {
    const layout = {
      workspaces: [{ key: 0, id: 'w-00000009', pinned: true as const, cells: [] }],
      selected: null
    }
    const r = recoverPtys(layout, { attach: {}, keep: [] }, [rec('p-0000000a', 1)], ids())
    expect(r.layout!.selected).toBe(r.layout!.workspaces[1].cells[0].key)
  })
})

describe('startRestore', () => {
  const read = (over: Partial<Omit<ReadState, 'view'>> = {}) => ({
    workspaces: ok(workspaces),
    cells: ok(cells),
    panes: ok(panes),
    sessions: ok(sessions),
    ...over
  })
  const live = (ids: string[]) =>
    ids.map((id, i) => ({ id, protocol_version: PROTOCOL_VERSION, created_at_ms: i }))
  const recoveredPtys = (r: ReturnType<typeof startRestore>): string[] => {
    const ws = r.layout!.workspaces.at(-1)!
    if (ws.name !== 'Recovered') return []
    return ws.cells.map((c) => r.attach[c.panes[0].key])
  }

  it('전체 복원이면 job pty 는 남기고 Recovered 에 넣지 않으며, 붙을 pane 이 없는 pty 를 Recovered 로 옮긴 것은 알린다', () => {
    const layout = joinTables({ workspaces, cells, panes })
    const r = startRestore(read(), layout, sessions, live([...sessionPtys(sessions), 'p-000000ff']))
    expect(r.mode).toBe('full')
    expect(r.keep).toContain(job.pty)
    expect(recoveredPtys(r)).toEqual(['p-000000ff'])
    expect(r.notice).toEqual(['recovered'])
  })

  it('전체 복원에서 Recovered 로 옮길 pty 가 없으면 알리지 않는다', () => {
    const layout = joinTables({ workspaces, cells, panes })
    const r = startRestore(read(), layout, sessions, live(sessionPtys(sessions)))
    expect(r.mode).toBe('full')
    expect(r.notice).toEqual([])
  })

  it('sessions 를 읽지 못하면 pane·job 의 pty 를 모두 Recovered 에 열고 함께 알린다', () => {
    const layout = joinTables({ workspaces, cells, panes })
    const r = startRestore(
      read({ sessions: { kind: 'bad' } }),
      layout,
      null,
      live(sessionPtys(sessions))
    )
    expect(r.mode).toBe('layout')
    expect(recoveredPtys(r)).toEqual(sessionPtys(sessions))
    expect(r.notice).toEqual(['sessions', 'recovered'])
  })

  it('고른 재시작으로 표를 비웠으면 pty 를 Recovered 에 열되 알리지 않는다', () => {
    const r = startRestore(
      read({ cells: { kind: 'absent' }, panes: { kind: 'absent' }, sessions: { kind: 'absent' } }),
      null,
      null,
      live(['p-000000ff'])
    )
    expect(recoveredPtys(r)).toEqual(['p-000000ff'])
    expect(r.notice).toEqual([])
  })
})

describe('createStateStore', () => {
  const MS = 500
  const store = (initial: StateFile = { ...none, view }) =>
    createStateStore({ path, debounceMs: MS, initial })

  it('enable 전의 변경은 쓰지 않고, enable 뒤 debounce 가 지나면 한 번에 쓴다', () => {
    vi.useFakeTimers()
    const s = store()
    s.setScreen(screen)
    vi.advanceTimersByTime(MS)
    expect(existsSync(path)).toBe(false)
    s.enable()
    s.setJobs([job])
    vi.advanceTimersByTime(MS - 1)
    expect(existsSync(path)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(saved()).toEqual({
      workspaces: screenWorkspaces,
      cells,
      panes,
      sessions,
      view: {
        version: view.version,
        viewMode: 'columns',
        sidebar: { open: false, width: 300 },
        folded: ['w-00000001'],
        window: view.window,
        theme: view.theme,
        selected: 'c-00000001'
      }
    })
  })

  it('화면에 canvas 폭이 없거나 선택한 cell 이 없으면 view 에서 지운다', () => {
    const s = store()
    s.setScreen(screen)
    expect(s.current().view.canvas).toBeUndefined()
    s.setScreen({ ...screen, canvas: { width: 500 }, selected: null })
    expect(s.current().view.canvas).toEqual({ width: 500 })
    expect(s.current().view).not.toHaveProperty('selected')
  })

  it('틀린 화면은 버리고 앞의 표를 둔다', () => {
    const s = store(full)
    s.setScreen({ workspaces: 'x' })
    expect(s.current()).toEqual(full)
  })

  it('paneCount 는 다음에 뜰 화면의 pane 수라, panes 표가 없어도 cell 마다 하나를 센다', () => {
    expect(store().paneCount()).toBe(0)
    expect(store(full).paneCount()).toBe(2)
    expect(store({ ...full, panes: null, sessions: null }).paneCount()).toBe(1)
  })

  it('창·테마도 view 에 담는다', () => {
    const s = store()
    const window = { ...view.window, x: 50 }
    s.setWindow(window)
    s.setTheme({ background: '#ffffff', mode: 'light' })
    expect(s.current().view).toMatchObject({ window, theme: { background: '#ffffff' } })
  })

  const kept = { ...workspaces, rows: workspaces.rows.slice(1) }
  it.each([
    ['keep', full],
    ['layout', { ...full, sessions: null }],
    ['end', { ...none, workspaces: kept, view }]
  ] as const)('finish(%s) 는 바로 쓰고 view 는 남긴다', (outcome, expected) => {
    const s = store(full)
    s.finish(outcome)
    expect(saved()).toEqual(expected)
  })

  it('drop 의 표는 결과와 상관없이 비워 쓴다', () => {
    store(full).finish('keep', { drop: ['workspaces', 'sessions'] })
    expect(saved()).toEqual({ ...full, workspaces: null, sessions: null })
  })

  it('finish 뒤의 변경은 버린다 — 끄며 닫힌 pane 이 고른 결과를 덮지 않는다', () => {
    vi.useFakeTimers()
    const s = store(full)
    s.enable()
    s.finish('layout')
    s.setScreen({ ...screen, workspaces: [] })
    s.setJobs([])
    vi.advanceTimersByTime(MS)
    expect(saved()).toEqual({ ...full, sessions: null })
  })

  it('쓰지 못하면 finish 가 던지고, 끝내지 않은 채로 둔다', () => {
    mkdirSync(path)
    const s = store(full)
    expect(() => s.finish('keep')).toThrow()
    rmSync(path, { recursive: true })
    s.finish('end')
    expect(saved()).toEqual({ ...none, workspaces: kept, view })
  })

  it('finish 가 던져도 끝내지 않았으므로 그 뒤의 변경을 타이머가 쓴다 — 끄지 않고 이어 쓰는 경우', () => {
    vi.useFakeTimers()
    mkdirSync(path)
    const s = store(full)
    s.enable()
    s.setJobs([])
    expect(() => s.finish('end')).toThrow()
    rmSync(path, { recursive: true })
    vi.advanceTimersByTime(MS)
    expect(saved()).toEqual({ ...full, sessions: { ...sessions, jobs: [] } })
  })

  it('finish 가 던진 뒤 stop 하면 쓰지 않는다 — 끄는 동안의 변경이 디스크에 남은 마지막 상태를 덮지 않는다', () => {
    vi.useFakeTimers()
    mkdirSync(path)
    const s = store(full)
    s.enable()
    s.setJobs([])
    expect(() => s.finish('end')).toThrow()
    s.stop()
    rmSync(path, { recursive: true })
    s.setScreen(screen)
    s.setJobs([job])
    vi.advanceTimersByTime(MS)
    expect(existsSync(path)).toBe(false)
  })

  it('화면의 핀 workspace 는 workspaces 표의 줄에 pinned 로 담는다', () => {
    const w = {
      ...screen.workspaces[0],
      name: 'atlas',
      dir: '/tmp',
      pinned: true as const,
      favorites: ['/tmp']
    }
    const s = store(full)
    s.setScreen({ ...screen, workspaces: [w] })
    expect(s.current()).toMatchObject({
      workspaces: {
        rows: [{ id: 'w-00000001', name: 'atlas', pinned: true, dir: '/tmp', favorites: ['/tmp'] }]
      },
      cells,
      panes
    })
  })

  it('discard 는 판정이 버린 표를 비운다', () => {
    const s = store(full)
    s.discard('layout')
    expect(s.current()).toEqual({ ...full, sessions: null })
    s.discard('end')
    expect(s.current()).toEqual({ ...none, workspaces: kept, view })
  })
})
