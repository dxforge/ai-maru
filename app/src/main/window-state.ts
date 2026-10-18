import { readFileSync, writeFileSync } from 'node:fs'
import type { BrowserWindow, Rectangle } from 'electron'

export type WindowState = Rectangle & { isMaximized: boolean; isFullScreen: boolean }

type StatefulWindow = Pick<
  BrowserWindow,
  'getNormalBounds' | 'isMaximized' | 'isFullScreen' | 'maximize' | 'setFullScreen'
>

type TrackedWindow = StatefulWindow & Pick<BrowserWindow, 'isMinimized' | 'on'>

const CHANGES = [
  'resize',
  'move',
  'maximize',
  'unmaximize',
  'enter-full-screen',
  'leave-full-screen'
] as const

export function readWindowState(file: string): WindowState | null {
  let s: Partial<WindowState>
  try {
    s = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const valid =
    typeof s === 'object' &&
    s !== null &&
    Number.isInteger(s.x) &&
    Number.isInteger(s.y) &&
    Number.isInteger(s.width) &&
    s.width! > 0 &&
    Number.isInteger(s.height) &&
    s.height! > 0 &&
    typeof s.isMaximized === 'boolean' &&
    typeof s.isFullScreen === 'boolean'
  return valid ? (s as WindowState) : null
}

function contains(outer: Rectangle, inner: Rectangle): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

// `windowBounds` 가 일부만 걸친 위치·크기도 받으면, 모니터 연결을 끊은 뒤 제목 표시줄이 화면 밖에 남아 창을 옮기지 못할 수 있다.
export function windowBounds(state: WindowState | null, displays: Rectangle[]): Rectangle | null {
  if (!state) return null
  const { x, y, width, height } = state
  const bounds = { x, y, width, height }
  return displays.some((d) => contains(d, bounds)) ? bounds : null
}

export function restoreWindowState(win: StatefulWindow, state: WindowState | null): void {
  if (state?.isMaximized) win.maximize()
  if (state?.isFullScreen) win.setFullScreen(true)
}

function currentState(win: StatefulWindow): WindowState {
  // 최대화·전체 화면 중에도 그 전의 보통 크기를 저장해야 풀었을 때 그 크기로 돌아간다.
  return {
    ...win.getNormalBounds(),
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen()
  }
}

/**
 * 최소화 중에는 `isMaximized()` 가 false 이고 `getNormalBounds()` 가 최대화된 크기를 주므로,
 * 최소화한 채 닫으면 최소화하기 전에 마지막으로 기록한 상태를 저장한다.
 */
export function saveWindowStateOnClose(win: TrackedWindow, file: string): void {
  let last = currentState(win)
  const update = (): void => {
    if (!win.isMinimized()) last = currentState(win)
  }
  for (const event of CHANGES) win.on(event as 'resize', update)
  win.on('close', () => {
    try {
      writeFileSync(file, JSON.stringify(win.isMinimized() ? last : currentState(win)))
    } catch (err) {
      console.error(`maru: cannot save the window state to ${file}:`, err)
    }
  })
}
