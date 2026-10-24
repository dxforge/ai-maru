import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ViewPrefs } from '../shared/screen'
import {
  readWindowExtras,
  readWindowState,
  restoreWindowState,
  saveWindowStateOnClose,
  windowBounds,
  type WindowExtras,
  type WindowState
} from './window-state'

const BOUNDS = { x: 100, y: 50, width: 800, height: 600 }
const NORMAL: WindowState = { ...BOUNDS, isMaximized: false, isFullScreen: false }

function fakeWindow(
  init: Partial<{
    bounds: typeof BOUNDS
    maximized: boolean
    fullScreen: boolean
    minimized: boolean
  }> = {}
) {
  const s = { bounds: BOUNDS, maximized: false, fullScreen: false, minimized: false, ...init }
  const calls: string[] = []
  const events = new EventEmitter()
  const win = {
    s,
    calls,
    emit: (event: string) => events.emit(event),
    getNormalBounds: () => s.bounds,
    isMaximized: () => s.maximized,
    isFullScreen: () => s.fullScreen,
    isMinimized: () => s.minimized,
    maximize: () => void calls.push('maximize'),
    setFullScreen: (on: boolean) => void calls.push(`fullscreen:${on}`),
    on: (event: string, fn: () => void) => {
      events.on(event, fn)
      return win
    }
  }
  return win
}

function tracked(
  file: string,
  init?: Parameters<typeof fakeWindow>[0],
  prefs: () => WindowExtras = () => ({})
) {
  const win = fakeWindow(init)
  saveWindowStateOnClose(
    win as unknown as Parameters<typeof saveWindowStateOnClose>[0],
    file,
    prefs
  )
  return win
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maru-window-state-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readWindowState', () => {
  it('저장한 상태를 그대로 읽는다', () => {
    const file = join(dir, 'w.json')
    writeFileSync(file, JSON.stringify({ ...NORMAL, isMaximized: true }))
    expect(readWindowState(file)).toEqual({ ...NORMAL, isMaximized: true })
  })

  it('파일이 없거나 JSON 이 아니면 null', () => {
    expect(readWindowState(join(dir, 'none.json'))).toBeNull()
    const file = join(dir, 'w.json')
    writeFileSync(file, '{not json')
    expect(readWindowState(file)).toBeNull()
  })

  it('값이 빠졌거나 크기가 0 이하이거나 정수가 아니면 null', () => {
    const file = join(dir, 'w.json')
    for (const bad of [
      null,
      [],
      { ...NORMAL, x: undefined },
      { ...NORMAL, width: 0 },
      { ...NORMAL, height: -1 },
      { ...NORMAL, y: 1.5 },
      { ...NORMAL, isFullScreen: 'yes' }
    ]) {
      writeFileSync(file, JSON.stringify(bad))
      expect(readWindowState(file), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('readWindowExtras', () => {
  it('창 위치·크기가 없거나 틀려도 보기 설정은 읽는다', () => {
    const file = join(dir, 'w.json')
    writeFileSync(file, JSON.stringify({ viewMode: 'single' }))
    expect(readWindowExtras(file)).toEqual({ viewMode: 'single' })
    expect(readWindowState(file)).toBeNull()
  })

  it('파일이 없거나 JSON 이 아니면 빈 설정', () => {
    expect(readWindowExtras(join(dir, 'none.json'))).toEqual({})
    const file = join(dir, 'w.json')
    writeFileSync(file, '{not json')
    expect(readWindowExtras(file)).toEqual({})
  })

  it('닫을 때 저장한 테마를 읽고, 없거나 틀리면 빼 둔다', () => {
    const file = join(dir, 'w.json')
    const theme = { background: '#1e1e2e', mode: 'system' }
    writeFileSync(file, JSON.stringify({ viewMode: 'single', theme }))
    expect(readWindowExtras(file)).toEqual({ viewMode: 'single', theme })
    for (const bad of [{ theme: { background: '#1e1e2e', mode: 'auto' } }, { theme: '#1e1e2e' }]) {
      writeFileSync(file, JSON.stringify(bad))
      expect(readWindowExtras(file), JSON.stringify(bad)).toEqual({})
    }
  })

  it('닫을 때 `extras` 가 준 테마를 함께 저장한다', () => {
    const file = join(dir, 'w.json')
    const theme = { background: '#ffffff', mode: 'light' as const }
    const win = tracked(file, {}, () => ({ viewMode: 'single', theme }))
    win.emit('close')
    expect(readWindowExtras(file)).toEqual({ viewMode: 'single', theme })
  })
})

describe('windowBounds', () => {
  const main = { x: 0, y: 0, width: 1440, height: 900 }
  const right = { x: 1440, y: 0, width: 1920, height: 1080 }

  it('한 모니터 안에 다 들어가면 저장한 자리를 준다', () => {
    expect(windowBounds({ ...NORMAL, x: 1500 }, [main, right])).toEqual({
      x: 1500,
      y: 50,
      width: 800,
      height: 600
    })
  })

  it('모니터 경계에 딱 맞으면 안에 든 것으로 본다', () => {
    expect(windowBounds({ ...NORMAL, x: 0, y: 0, width: 1440, height: 900 }, [main])).toEqual(main)
  })

  it('어느 모니터와도 겹치지 않으면 null', () => {
    expect(windowBounds({ ...NORMAL, x: 1500 }, [main])).toBeNull()
  })

  it('모니터 밖으로 조금이라도 나가면 null', () => {
    expect(windowBounds({ ...NORMAL, x: 700 }, [main])).toBeNull()
    expect(windowBounds({ ...NORMAL, y: -1 }, [main])).toBeNull()
  })

  it('두 모니터에 걸치면 null', () => {
    expect(windowBounds({ ...NORMAL, x: 1000 }, [main, right])).toBeNull()
  })

  it('저장한 상태가 없으면 null', () => {
    expect(windowBounds(null, [main])).toBeNull()
  })
})

describe('restoreWindowState', () => {
  it('최대화였으면 최대화한다', () => {
    const win = fakeWindow()
    restoreWindowState(win, { ...NORMAL, isMaximized: true })
    expect(win.calls).toEqual(['maximize'])
  })

  it('전체 화면이었으면 전체 화면으로 한다', () => {
    const win = fakeWindow()
    restoreWindowState(win, { ...NORMAL, isFullScreen: true })
    expect(win.calls).toEqual(['fullscreen:true'])
  })

  it('보통 상태였거나 저장한 상태가 없으면 아무것도 하지 않는다', () => {
    const win = fakeWindow()
    restoreWindowState(win, NORMAL)
    restoreWindowState(win, null)
    expect(win.calls).toEqual([])
  })
})

describe('saveWindowStateOnClose', () => {
  const placed = { x: 10, y: 20, width: 300, height: 200 }

  it('닫을 때 보통 크기와 최대화·전체 화면 여부를 쓰고 readWindowState 가 그대로 읽는다', () => {
    const file = join(dir, 'w.json')
    for (const flags of [
      { maximized: false, fullScreen: false },
      { maximized: true, fullScreen: false },
      { maximized: false, fullScreen: true }
    ]) {
      tracked(file, { bounds: placed, ...flags }).emit('close')
      expect(readWindowState(file)).toEqual({
        ...placed,
        isMaximized: flags.maximized,
        isFullScreen: flags.fullScreen
      })
    }
  })

  it('닫기 전에는 쓰지 않는다', () => {
    const file = join(dir, 'w.json')
    const win = tracked(file)
    win.emit('resize')
    expect(readWindowState(file)).toBeNull()
  })

  it('닫을 때의 상태를 쓴다 — 띄운 뒤 바뀐 크기도', () => {
    const file = join(dir, 'w.json')
    const win = tracked(file)
    win.s.bounds = placed
    win.emit('close')
    expect(readWindowState(file)).toEqual({ ...NORMAL, ...placed })
  })

  it('최대화한 뒤 최소화한 채 닫으면 최소화하기 전의 보통 크기와 최대화를 쓴다', () => {
    const file = join(dir, 'w.json')
    const win = tracked(file, { bounds: placed })
    win.s.maximized = true
    win.emit('maximize')
    Object.assign(win.s, {
      minimized: true,
      maximized: false,
      bounds: { x: 0, y: 0, width: 1440, height: 900 }
    })
    win.emit('resize')
    win.emit('close')
    expect(readWindowState(file)).toEqual({ ...NORMAL, ...placed, isMaximized: true })
  })

  it('보통 상태에서 옮긴 뒤 최소화한 채 닫으면 옮긴 자리를 쓴다', () => {
    const file = join(dir, 'w.json')
    const win = tracked(file)
    win.s.bounds = placed
    win.emit('move')
    win.s.minimized = true
    win.emit('close')
    expect(readWindowState(file)).toEqual({ ...NORMAL, ...placed })
  })

  it('최대화한 뒤 전체 화면인 채 닫으면 전체 화면에 들어가기 전의 보통 크기와 최대화를 쓴다', () => {
    const file = join(dir, 'w.json')
    const win = tracked(file, { bounds: placed })
    win.s.maximized = true
    win.emit('maximize')
    Object.assign(win.s, {
      fullScreen: true,
      maximized: false,
      bounds: { x: 0, y: 0, width: 1440, height: 900 }
    })
    win.emit('resize')
    win.emit('enter-full-screen')
    win.emit('move')
    win.emit('close')
    expect(readWindowState(file)).toEqual({
      ...placed,
      isMaximized: true,
      isFullScreen: true
    })
  })

  it('최대화한 창이 전체 화면에서 나온 뒤 닫으면 최대화만 쓴다', () => {
    const file = join(dir, 'w.json')
    const win = tracked(file, { bounds: placed })
    win.s.maximized = true
    win.emit('maximize')
    Object.assign(win.s, { fullScreen: true, maximized: false })
    win.emit('enter-full-screen')
    Object.assign(win.s, { fullScreen: false, maximized: true })
    win.emit('leave-full-screen')
    win.emit('close')
    expect(readWindowState(file)).toEqual({ ...NORMAL, ...placed, isMaximized: true })
  })

  it('닫을 때의 보기 설정을 함께 쓰고, readWindowState 도 그 파일을 읽는다', () => {
    const file = join(dir, 'w.json')
    let prefs: ViewPrefs = { viewMode: 'single' }
    const win = tracked(file, { bounds: placed }, () => prefs)
    prefs = { viewMode: 'columns', sidebar: { open: false, width: 300 } }
    win.emit('close')
    expect(readWindowExtras(file)).toEqual(prefs)
    expect(readWindowState(file)).toMatchObject({ ...NORMAL, ...placed })
  })

  it('쓸 수 없는 경로여도 throw 하지 않는다', () => {
    const win = tracked(join(dir, 'missing', 'w.json'))
    expect(() => win.emit('close')).not.toThrow()
  })
})
