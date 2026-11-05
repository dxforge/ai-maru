import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { splitScreen, STATE_VERSIONS, type PinsPart, type ScreenState } from '../shared/screen'
import type { JobRecord } from './job'
import {
  createStateStore,
  initialState,
  readState,
  removeOldStateFiles,
  restorePlan,
  sessionPtys,
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
            { key: 0, ptyId: 'p-0000000a', cwd: '/tmp' },
            { key: 2, ptyId: 'p-0000000b', command: ['sh'], title: 't' }
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

const { layout, ptys } = splitScreen(screen)
const sessions: SessionsPart = { version: STATE_VERSIONS.sessions, ptys, jobs: [job] }
const view = {
  version: STATE_VERSIONS.view,
  viewMode: 'single' as const,
  sidebar: { open: true, width: 250 },
  folded: ['w-00000001'],
  canvas: { width: 400 },
  window: { x: 1, y: 2, width: 800, height: 600, isMaximized: false, isFullScreen: true },
  theme: { background: '#101010', mode: 'dark' as const }
}
// `pins` 는 `screen` 의 workspace 와 맞추지 않는다 — store 는 `layout`·`pins` 가 서로 맞는지 보지 않는다.
const pins: PinsPart = {
  version: STATE_VERSIONS.pins,
  workspaces: [{ id: 'w-00000009', name: 'atlas', favorites: ['/tmp'] }]
}
const full: StateFile = { layout, pins, sessions, view }

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

describe('readState', () => {
  it('네 부분을 읽는다', () => {
    write(full)
    expect(readState(path)).toEqual({
      layout: { kind: 'ok', value: layout },
      pins: { kind: 'ok', value: pins },
      sessions: { kind: 'ok', value: sessions },
      view
    })
  })

  it('파일이 없거나 부분이 null 이면 absent 다', () => {
    const empty = {
      layout: { kind: 'absent' },
      pins: { kind: 'absent' },
      sessions: { kind: 'absent' }
    }
    expect(readState(path)).toEqual({ ...empty, view: { version: STATE_VERSIONS.view } })
    write({ layout: null, pins: null, sessions: null, view })
    expect(readState(path)).toEqual({ ...empty, view })
  })

  it('JSON 이 깨졌으면 layout·pins·sessions 는 bad 다', () => {
    writeFileSync(path, '{nope')
    expect(readState(path)).toMatchObject({
      layout: { kind: 'bad' },
      pins: { kind: 'bad' },
      sessions: { kind: 'bad' }
    })
  })

  it('한 부분의 버전이 달라도 다른 부분은 읽는다', () => {
    write({ ...full, sessions: { ...sessions, version: STATE_VERSIONS.sessions + 1 } })
    expect(readState(path)).toMatchObject({
      layout: { kind: 'ok' },
      sessions: { kind: 'bad' },
      view
    })
    write({ ...full, layout: { ...layout, version: STATE_VERSIONS.layout + 1 } })
    expect(readState(path)).toMatchObject({
      layout: { kind: 'bad' },
      pins: { kind: 'ok' },
      sessions: { kind: 'ok' }
    })
    write({ ...full, pins: { ...pins, version: STATE_VERSIONS.pins + 1 } })
    expect(readState(path)).toMatchObject({
      layout: { kind: 'ok' },
      pins: { kind: 'bad' },
      sessions: { kind: 'ok' }
    })
    write({ ...full, view: { ...view, version: STATE_VERSIONS.view + 1 } })
    expect(readState(path)).toMatchObject({
      layout: { kind: 'ok' },
      view: { version: STATE_VERSIONS.view }
    })
  })

  it('sessions 의 job 표나 pty 가 틀리면 sessions 를 통째로 버린다', () => {
    write({ ...full, sessions: { ...sessions, jobs: [{ ...job, pty: 'x' }] } })
    expect(readState(path).sessions).toEqual({ kind: 'bad' })
    write({ ...full, sessions: { ...sessions, ptys: [{ pane: 0, pty: '../x' }] } })
    expect(readState(path).sessions).toEqual({ kind: 'bad' })
  })

  it('view 는 틀린 필드만 버린다', () => {
    write({ ...full, view: { ...view, viewMode: 'grid', window: { x: 1 }, theme: 'x' } })
    expect(readState(path).view).toEqual({
      version: view.version,
      sidebar: view.sidebar,
      folded: view.folded,
      canvas: view.canvas
    })
  })
})

describe('initialState', () => {
  const ok = <T>(value: T) => ({ kind: 'ok' as const, value })

  it('읽은 부분은 그대로 담고, 읽지 못한 부분은 비운다', () => {
    const read: ReadState = {
      layout: ok(layout),
      pins: { kind: 'bad' },
      sessions: ok(sessions),
      view
    }
    expect(initialState(read)).toEqual({ layout, pins: null, sessions, view })
  })

  it.each(['absent', 'bad'] as const)(
    'layout 이 %s 면 sessions 도 비우고, 접은 workspace 는 남긴다 — 접힘은 workspace 의 id 로 둔다',
    (kind) => {
      const read: ReadState = { layout: { kind }, pins: ok(pins), sessions: ok(sessions), view }
      expect(initialState(read)).toEqual({ layout: null, pins, sessions: null, view })
    }
  )
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
  const ok = <T>(value: T) => ({ kind: 'ok' as const, value })
  const read = (
    l: ReadState['layout'],
    s: ReadState['sessions'],
    p: ReadState['pins'] = ok(pins)
  ) => ({ layout: l, pins: p, sessions: s })
  const live = (): number => PROTOCOL_VERSION

  it('layout 이 없으면 빈 화면, 읽지 못했으면 알린다', () => {
    expect(restorePlan(read({ kind: 'absent' }, ok(sessions)), live)).toEqual({
      mode: 'empty',
      notice: []
    })
    expect(restorePlan(read({ kind: 'bad' }, ok(sessions)), live)).toEqual({
      mode: 'empty',
      notice: ['layout']
    })
  })

  it('sessions 가 없으면 알리지 않고, 읽지 못했으면 알리며 레이아웃만 복원한다', () => {
    expect(restorePlan(read(ok(layout), { kind: 'absent' }), live)).toEqual({
      mode: 'layout',
      notice: []
    })
    expect(restorePlan(read(ok(layout), { kind: 'bad' }), live)).toEqual({
      mode: 'layout',
      notice: ['sessions']
    })
  })

  it('살아 있는 pty 하나라도 프로토콜이 다르면 레이아웃만 복원하고 알린다 — job 의 pty 도 본다', () => {
    const other = (pty: string): number =>
      pty === job.pty ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION
    expect(restorePlan(read(ok(layout), ok(sessions)), other)).toEqual({
      mode: 'layout',
      notice: ['protocol']
    })
    const unknown = (pty: string): number | null => (pty === job.pty ? null : PROTOCOL_VERSION)
    expect(restorePlan(read(ok(layout), ok(sessions)), unknown).mode).toBe('layout')
  })

  it('죽은 pty 는 판정에 넣지 않는다', () => {
    const dead = (pty: string): number | undefined =>
      pty === job.pty ? undefined : PROTOCOL_VERSION
    expect(restorePlan(read(ok(layout), ok(sessions)), dead)).toEqual({
      mode: 'full',
      notice: []
    })
  })

  it('pins 를 읽지 못했으면 알리고, 복원은 layout·sessions 대로 한다 — 없으면 알리지 않는다', () => {
    expect(restorePlan(read(ok(layout), ok(sessions), { kind: 'bad' }), live)).toEqual({
      mode: 'full',
      notice: ['pins']
    })
    expect(restorePlan(read({ kind: 'bad' }, ok(sessions), { kind: 'bad' }), live)).toEqual({
      mode: 'empty',
      notice: ['layout', 'pins']
    })
    expect(restorePlan(read(ok(layout), ok(sessions), { kind: 'absent' }), live)).toEqual({
      mode: 'full',
      notice: []
    })
  })
})

describe('sessionPtys', () => {
  it('pane 의 pty 와 끝난 job 을 포함한 모든 job 의 pty 다 — 끝난 job 도 maru job read 로 읽는다', () => {
    const ended = { ...sessions, jobs: [{ ...job, exit: { code: 3, signal: null } }] }
    expect(sessionPtys(ended)).toEqual(['p-0000000a', 'p-0000000b', job.pty])
  })
})

describe('createStateStore', () => {
  const MS = 500
  const store = (initial: StateFile = { layout: null, pins: null, sessions: null, view }) =>
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
      layout,
      pins: { version: STATE_VERSIONS.pins, workspaces: [] },
      sessions,
      view: {
        version: view.version,
        viewMode: 'columns',
        sidebar: { open: false, width: 300 },
        folded: ['w-00000001'],
        window: view.window,
        theme: view.theme
      }
    })
  })

  it('화면에 canvas 폭이 없으면 view 의 canvas 를 지운다', () => {
    const s = store()
    s.setScreen(screen)
    expect(s.current().view.canvas).toBeUndefined()
    s.setScreen({ ...screen, canvas: { width: 500 } })
    expect(s.current().view.canvas).toEqual({ width: 500 })
  })

  it('틀린 화면은 버리고 앞의 레이아웃을 둔다', () => {
    const s = store(full)
    s.setScreen({ workspaces: 'x' })
    expect(s.current().layout).toEqual(layout)
  })

  it('창·테마도 view 에 담는다', () => {
    const s = store()
    const window = { ...view.window, x: 50 }
    s.setWindow(window)
    s.setTheme({ background: '#ffffff', mode: 'light' })
    expect(s.current().view).toMatchObject({ window, theme: { background: '#ffffff' } })
  })

  it.each([
    ['keep', { layout, sessions, view }],
    ['layout', { layout, sessions: null, view }],
    ['end', { layout: null, sessions: null, view }]
  ] as const)('finish(%s) 는 바로 쓰고 pins·view 는 남긴다', (outcome, expected) => {
    const s = store(full)
    s.finish(outcome)
    expect(saved()).toEqual({ ...expected, pins })
  })

  it('finish 뒤의 변경은 버린다 — 끄며 닫힌 pane 이 고른 결과를 덮지 않는다', () => {
    vi.useFakeTimers()
    const s = store(full)
    s.enable()
    s.finish('layout')
    s.setScreen({ ...screen, workspaces: [] })
    s.setJobs([])
    vi.advanceTimersByTime(MS)
    expect(saved()).toEqual({ layout, pins, sessions: null, view })
  })

  it('쓰지 못하면 finish 가 던지고, 끝내지 않은 채로 둔다', () => {
    mkdirSync(path)
    const s = store(full)
    expect(() => s.finish('keep')).toThrow()
    rmSync(path, { recursive: true })
    s.finish('end')
    expect(saved()).toEqual({ layout: null, pins, sessions: null, view })
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

  it('화면의 핀 workspace 는 pins 에, 배치는 layout 에 나눠 담는다', () => {
    const w = { ...screen.workspaces[0], name: 'atlas', pinned: true as const, favorites: ['/tmp'] }
    const s = store(full)
    s.setScreen({ ...screen, workspaces: [w] })
    expect(s.current()).toMatchObject({
      layout: { workspaces: [{ key: 3, id: 'w-00000001', cells: layout.workspaces[0].cells }] },
      pins: {
        version: STATE_VERSIONS.pins,
        workspaces: [{ id: 'w-00000001', name: 'atlas', dir: '/tmp', favorites: ['/tmp'] }]
      }
    })
  })

  it('discard 는 판정이 버린 부분을 비운다', () => {
    const s = store(full)
    s.discard('layout')
    expect(s.current()).toMatchObject({ layout, sessions: null })
    s.discard('end')
    expect(s.current()).toMatchObject({ layout: null, pins, sessions: null, view })
  })
})
