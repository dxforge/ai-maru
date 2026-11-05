import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import {
  canvasWidth,
  clickMenu,
  closeWindow,
  dragHandle,
  expect,
  dragCanvas,
  openCanvas,
  sidebarResizer,
  sidebarWidth,
  readState,
  stateFile,
  test,
  toggleView,
  writeView
} from './app'

type Rect = { x: number; y: number; width: number; height: number }
type Method =
  | 'getBounds'
  | 'getNormalBounds'
  | 'isMaximized'
  | 'isMinimized'
  | 'isVisible'
  | 'maximize'
  | 'minimize'
  | 'unmaximize'

function win<M extends Method>(
  app: ElectronApplication,
  method: M
): Promise<ReturnType<Electron.BrowserWindow[M]>> {
  return app.evaluate(
    ({ BrowserWindow }, method) => BrowserWindow.getAllWindows()[0][method](),
    method
  ) as Promise<ReturnType<Electron.BrowserWindow[M]>>
}

/** 기본 크기나 OS 가 고르는 기본 위치와 같으면 복원하지 않아도 테스트가 통과하므로, 둘 다와 다른 자리로 옮긴다. */
async function placeWindow(app: ElectronApplication): Promise<Rect> {
  await app.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getPrimaryDisplay().workArea
    BrowserWindow.getAllWindows()[0].setBounds({
      x: area.x + 40,
      y: area.y + 30,
      width: 640,
      height: 420
    })
  })
  return win(app, 'getBounds')
}

async function quitApp(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
}

test('창을 닫았다가 다시 띄우면 닫을 때의 위치·크기로 뜬다', async ({ launch }) => {
  const first = await launch()
  const placed = await placeWindow(first.app)
  await closeWindow(first.app)

  const second = await launch()
  expect(await win(second.app, 'getBounds')).toEqual(placed)
  expect(await win(second.app, 'isMaximized')).toBe(false)
})

test('앱을 끝냈다가 다시 띄워도 끝낼 때의 위치·크기로 뜬다', async ({ launch }) => {
  const first = await launch()
  const placed = await placeWindow(first.app)
  await quitApp(first.app)

  const second = await launch()
  expect(await win(second.app, 'getBounds')).toEqual(placed)
})

test('최대화한 채 닫으면 최대화로 뜨고, 최대화를 풀면 그 전 크기로 돌아간다', async ({
  launch
}) => {
  const first = await launch()
  const placed = await placeWindow(first.app)
  await win(first.app, 'maximize')
  await expect.poll(() => win(first.app, 'isMaximized')).toBe(true)
  await closeWindow(first.app)

  const second = await launch()
  await expect.poll(() => win(second.app, 'isMaximized')).toBe(true)
  expect(await win(second.app, 'getNormalBounds')).toEqual(placed)
  await win(second.app, 'unmaximize')
  await expect.poll(() => win(second.app, 'getBounds')).toEqual(placed)
})

test('최소화한 채 닫으면 보통 상태로 그 위치·크기에 뜬다', async ({ launch }) => {
  const first = await launch()
  const placed = await placeWindow(first.app)
  await win(first.app, 'minimize')
  await expect.poll(() => win(first.app, 'isMinimized')).toBe(true)
  await closeWindow(first.app)

  const second = await launch()
  expect(await win(second.app, 'isMinimized')).toBe(false)
  expect(await win(second.app, 'getBounds')).toEqual(placed)
})

test('최대화한 뒤 최소화한 채 닫으면 최대화로 뜨고, 최대화를 풀면 그 전 크기로 돌아간다', async ({
  launch
}) => {
  const first = await launch()
  const placed = await placeWindow(first.app)
  await win(first.app, 'maximize')
  await expect.poll(() => win(first.app, 'isMaximized')).toBe(true)
  await win(first.app, 'minimize')
  await expect.poll(() => win(first.app, 'isMinimized')).toBe(true)
  await closeWindow(first.app)

  const second = await launch()
  await expect.poll(() => win(second.app, 'isMaximized')).toBe(true)
  await win(second.app, 'unmaximize')
  await expect.poll(() => win(second.app, 'getBounds')).toEqual(placed)
})

test('최대화로 저장한 창은 모니터 밖에 있었어도 최대화로 뜬다', async ({ launch, dataDir }) => {
  writeView(dataDir, {
    viewMode: 'single',
    window: {
      x: -100_000,
      y: -100_000,
      width: 640,
      height: 420,
      isMaximized: true,
      isFullScreen: false
    }
  })
  const { app } = await launch()
  await expect.poll(() => win(app, 'isMaximized')).toBe(true)
  const { x, y } = await win(app, 'getBounds')
  expect(x).toBeGreaterThan(-100_000)
  expect(y).toBeGreaterThan(-100_000)
})

test('저장한 위치가 연결된 모니터 밖이면 기본 위치·크기로 뜬다', async ({ launch, dataDir }) => {
  writeView(dataDir, {
    viewMode: 'single',
    window: {
      x: -100_000,
      y: -100_000,
      width: 640,
      height: 420,
      isMaximized: false,
      isFullScreen: false
    }
  })
  const { app } = await launch()
  const { x, y, width, height } = await win(app, 'getBounds')
  expect({ width, height }).not.toEqual({ width: 640, height: 420 })
  expect(x).toBeGreaterThan(-100_000)
  expect(y).toBeGreaterThan(-100_000)
})

test('저장한 파일이 깨졌어도 뜨고, 닫으면 새로 저장한다', async ({ launch, dataDir }) => {
  writeFileSync(stateFile(dataDir), '{broken')
  const first = await launch()
  const placed = await placeWindow(first.app)
  await closeWindow(first.app)

  const second = await launch()
  expect(await win(second.app, 'getBounds')).toEqual(placed)
})

test('저장한 보기 설정이 없으면 columns 로, 사이드바를 연 채 뜬다', async ({ launch, dataDir }) => {
  rmSync(stateFile(dataDir))
  const { page } = await launch()
  await expect(page.locator('.terminals')).toHaveClass(/columns/)
  await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/)
})

test('보기 모드와 사이드바 열림을 바꾸고 앱을 끝냈다가 다시 띄우면 그대로 뜨고, 다시 바꾸고 창을 닫아도 그렇다', async ({
  launch
}) => {
  const first = await launch()
  await expect(first.page.locator('.terminals')).toHaveClass(/single/)
  await toggleView(first, 'columns')
  await clickMenu(first.app, 'toggle-sidebar')
  await expect(first.page.locator('.sidebar')).toHaveClass(/collapsed/)
  await quitApp(first.app)

  const second = await launch()
  await expect(second.page.locator('.terminals')).toHaveClass(/columns/)
  await expect(second.page.locator('.sidebar')).toHaveClass(/collapsed/)
  await toggleView(second, 'single')
  await clickMenu(second.app, 'toggle-sidebar')
  await expect(second.page.locator('.sidebar')).not.toHaveClass(/collapsed/)
  await closeWindow(second.app)

  const third = await launch()
  await expect(third.page.locator('.terminals')).toHaveClass(/single/)
  await expect(third.page.locator('.sidebar')).not.toHaveClass(/collapsed/)
})

test('사이드바 폭을 바꾸고 앱을 끝냈다가 다시 띄우면 그 폭으로 뜬다', async ({ launch }) => {
  const first = await launch()
  const before = await sidebarWidth(first.page)
  await dragHandle(first.page, sidebarResizer(first.page), 60)
  await expect.poll(() => sidebarWidth(first.page)).toBe(before + 60)
  await quitApp(first.app)

  const second = await launch()
  await expect.poll(() => sidebarWidth(second.page)).toBe(before + 60)
})

test('Canvas 폭을 바꾸고 앱을 끝냈다가 다시 띄우면 Canvas 가 그 폭으로 열린다', async ({
  launch
}) => {
  const first = await launch()
  await openCanvas(first)
  const width = await dragCanvas(first.page, -70)
  await quitApp(first.app)

  const second = await launch()
  await openCanvas(second)
  await expect.poll(() => canvasWidth(second.page)).toBe(width)
})

test('기억한 사이드바 상태로 첫 화면부터 그려, 문서가 뜰 때 사이드바가 움직이지 않는다', async ({
  launch,
  dataDir
}) => {
  writeView(dataDir, { viewMode: 'single', sidebar: { open: false, width: 282 } })
  const { app, page } = await launch()
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  // 첫 문서는 `addInitScript` 를 달기 전에 뜨므로, 스크립트를 단 뒤 문서를 새로 고쳐 잰다.
  // 숨은 스크롤바 안의 transition 은 모으지 않는다. overlayscrollbars 는 스크롤바를 만든 뒤 theme class 를 붙이므로
  // 손잡이의 폭·색 transition 이 돈다. 그 스크롤바는 opacity 0 이라 보이지 않는다.
  await app.context().addInitScript(() => {
    const runs: string[] = []
    Object.assign(window, { runs })
    document.addEventListener(
      'transitionrun',
      (e) => {
        const target = e.target as Element
        if (target.closest('.os-scrollbar-auto-hide-hidden')) return
        runs.push(`${target.className} ${e.propertyName}`)
      },
      true
    )
  })
  await page.reload()
  await page.waitForSelector('.xterm-screen')
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  expect(await page.evaluate(() => (window as unknown as { runs: string[] }).runs)).toEqual([])
})

test('앞 빌드의 window-state.json·restart.json 은 읽지 않고 지운다', async ({
  launch,
  dataDir
}) => {
  rmSync(stateFile(dataDir))
  const old = join(dataDir, 'window-state.json')
  const restart = join(dataDir, 'restart.json')
  writeFileSync(
    old,
    JSON.stringify({
      x: 40,
      y: 30,
      width: 640,
      height: 420,
      isMaximized: false,
      isFullScreen: false
    })
  )
  writeFileSync(restart, JSON.stringify({ screen: {}, jobs: null }))
  const { app } = await launch()
  const { width, height } = await win(app, 'getBounds')
  expect({ width, height }).toEqual({ width: 1000, height: 700 })
  expect(existsSync(old)).toBe(false)
  expect(existsSync(restart)).toBe(false)
})

test('창을 옮긴 뒤 앱이 강제로 끝나도 다음 실행은 옮긴 자리로 뜬다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  const placed = await placeWindow(first.app)
  await expect.poll(() => readState(dataDir)?.view?.window).toMatchObject(placed)
  const closed = new Promise<void>((resolve) => first.app.once('close', () => resolve()))
  first.app.process().kill('SIGKILL')
  await closed

  const second = await launch()
  expect(await win(second.app, 'getBounds')).toEqual(placed)
})

test('테스트로 띄운 창은 화면에 올리지 않는다', async ({ launch }) => {
  const { app } = await launch()
  expect(await win(app, 'isVisible')).toBe(false)
})

test('테스트로 띄운 창은 최대화·최대화 풀기·최소화해도 화면에 올리지 않는다', async ({
  launch
}) => {
  const { app } = await launch()
  await win(app, 'maximize')
  // 잠깐 보였다가 숨는 창도 걸러야 하므로 기다리지 않고 바로 잰다.
  expect(await win(app, 'isVisible')).toBe(false)
  await expect.poll(() => win(app, 'isMaximized')).toBe(true)
  await win(app, 'unmaximize')
  await expect.poll(() => win(app, 'isMaximized')).toBe(false)
  expect(await win(app, 'isVisible')).toBe(false)
  await win(app, 'minimize')
  await expect.poll(() => win(app, 'isMinimized')).toBe(true)
  expect(await win(app, 'isVisible')).toBe(false)
})

test('테스트로 띄운 창은 최대화로 되살려도 화면에 올리지 않는다', async ({ launch, dataDir }) => {
  writeView(dataDir, {
    viewMode: 'single',
    window: { x: 0, y: 0, width: 640, height: 420, isMaximized: true, isFullScreen: false }
  })
  const { app } = await launch()
  await expect.poll(() => win(app, 'isMaximized')).toBe(true)
  expect(await win(app, 'isVisible')).toBe(false)
})
