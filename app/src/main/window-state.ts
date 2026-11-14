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

export function parseWindowState(v: unknown): WindowState | null {
  const s = v as Partial<WindowState> | null
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
  if (!valid) return null
  const { x, y, width, height, isMaximized, isFullScreen } = s as WindowState
  return { x, y, width, height, isMaximized, isFullScreen }
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

export function initialPlacement(
  restored: Rectangle | null,
  unobtrusive: boolean,
  primary: Rectangle
): Partial<Rectangle> {
  if (restored) return restored
  return unobtrusive ? { x: primary.x, y: primary.y } : {}
}

export function restoreWindowState(win: StatefulWindow, state: WindowState | null): void {
  if (state?.isMaximized) win.maximize()
  if (state?.isFullScreen) win.setFullScreen(true)
}

/**
 * macOS 에서는 창을 만든 직후 `showInactive()`·`maximize()` 를 부르면 앱이 맨 앞으로 나온다. `ready-to-show` 에서 부르면
 * 나오지 않는다(Electron 45.2.2 에서 잼. 창을 만든 직후에는 `showInactive()` 4번 중 4번, `maximize()` 3번 중 3번 앞으로
 * 나왔고, `ready-to-show` 에서는 한 번도 나오지 않았다). 그래서 `inactive` 면 최대화·전체 화면 복원도 `ready-to-show` 까지
 * 미룬다. 복원 전에 끝나면 저장된 상태를 복원 전 상태로 덮어쓰지 않도록, 상태 추적은 `restored` 에서 붙인다.
 */
export function presentWindow(
  win: StatefulWindow & Pick<BrowserWindow, 'once' | 'showInactive'>,
  state: WindowState | null,
  inactive: boolean,
  restored: () => void
): void {
  const restore = (): void => {
    restoreWindowState(win, state)
    restored()
  }
  if (!inactive) return restore()
  win.once('ready-to-show', () => {
    restore()
    win.showInactive()
  })
}

export function showsInactive(env: NodeJS.ProcessEnv): boolean {
  return !env.MARU_UNOBTRUSIVE && Boolean(env.MARU_SHOW_INACTIVE)
}

function currentState(win: StatefulWindow): WindowState {
  return {
    ...win.getNormalBounds(),
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen()
  }
}

/**
 * 최소화·전체 화면 중에는 `isMaximized()` 가 false 이므로, 그 상태면 들어가기 전에 마지막으로 기록한 상태를 준다.
 * 최소화 중에는 `getNormalBounds()` 도 최대화된 크기를 준다.
 */
export function trackWindowState(
  win: TrackedWindow,
  changed: (state: WindowState) => void
): () => WindowState {
  let last = currentState(win)
  const saved = (): WindowState => {
    if (win.isMinimized()) return last
    if (win.isFullScreen()) return { ...last, isFullScreen: true }
    return currentState(win)
  }
  for (const event of CHANGES)
    win.on(event as 'resize', () => {
      if (win.isMinimized() || win.isFullScreen()) return changed(saved())
      last = currentState(win)
      changed(last)
    })
  return saved
}
