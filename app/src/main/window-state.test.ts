import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  parseWindowState,
  restoreWindowState,
  trackWindowState,
  windowBounds,
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

function tracked(init?: Parameters<typeof fakeWindow>[0]) {
  const win = fakeWindow(init)
  const changes: WindowState[] = []
  const saved = trackWindowState(win as unknown as Parameters<typeof trackWindowState>[0], (s) =>
    changes.push(s)
  )
  return { win, changes, saved }
}

describe('parseWindowState', () => {
  it('맞는 상태는 그 필드만 옮긴다', () => {
    expect(parseWindowState({ ...NORMAL, isMaximized: true, extra: 1 })).toEqual({
      ...NORMAL,
      isMaximized: true
    })
  })

  it('값이 빠졌거나 크기가 0 이하이거나 정수가 아니면 null', () => {
    for (const bad of [
      null,
      [],
      { ...NORMAL, x: undefined },
      { ...NORMAL, width: 0 },
      { ...NORMAL, height: -1 },
      { ...NORMAL, y: 1.5 },
      { ...NORMAL, isFullScreen: 'yes' }
    ]) {
      expect(parseWindowState(bad), JSON.stringify(bad)).toBeNull()
    }
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

describe('trackWindowState', () => {
  const placed = { x: 10, y: 20, width: 300, height: 200 }

  it('보통 크기와 최대화·전체 화면 여부를 준다', () => {
    for (const flags of [
      { maximized: false, fullScreen: false },
      { maximized: true, fullScreen: false },
      { maximized: false, fullScreen: true }
    ]) {
      expect(tracked({ bounds: placed, ...flags }).saved()).toEqual({
        ...placed,
        isMaximized: flags.maximized,
        isFullScreen: flags.fullScreen
      })
    }
  })

  it('창이 바뀔 때마다 그때의 상태로 알린다', () => {
    const { win, changes } = tracked()
    win.s.bounds = placed
    win.emit('move')
    win.s.maximized = true
    win.emit('maximize')
    expect(changes).toEqual([
      { ...NORMAL, ...placed },
      { ...NORMAL, ...placed, isMaximized: true }
    ])
  })

  it('최대화한 뒤 최소화하면 최소화하기 전의 보통 크기와 최대화를 준다', () => {
    const { win, saved, changes } = tracked({ bounds: placed })
    win.s.maximized = true
    win.emit('maximize')
    Object.assign(win.s, {
      minimized: true,
      maximized: false,
      bounds: { x: 0, y: 0, width: 1440, height: 900 }
    })
    win.emit('resize')
    expect(saved()).toEqual({ ...NORMAL, ...placed, isMaximized: true })
    expect(changes.at(-1)).toEqual({ ...NORMAL, ...placed, isMaximized: true })
  })

  it('보통 상태에서 옮긴 뒤 최소화하면 옮긴 자리를 준다', () => {
    const { win, saved } = tracked()
    win.s.bounds = placed
    win.emit('move')
    win.s.minimized = true
    expect(saved()).toEqual({ ...NORMAL, ...placed })
  })

  it('최대화한 뒤 전체 화면이면 전체 화면에 들어가기 전의 보통 크기와 최대화를 준다', () => {
    const { win, saved } = tracked({ bounds: placed })
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
    expect(saved()).toEqual({ ...placed, isMaximized: true, isFullScreen: true })
  })

  it('최대화한 창이 전체 화면에서 나오면 최대화만 준다', () => {
    const { win, saved } = tracked({ bounds: placed })
    win.s.maximized = true
    win.emit('maximize')
    Object.assign(win.s, { fullScreen: true, maximized: false })
    win.emit('enter-full-screen')
    Object.assign(win.s, { fullScreen: false, maximized: true })
    win.emit('leave-full-screen')
    expect(saved()).toEqual({ ...NORMAL, ...placed, isMaximized: true })
  })
})
