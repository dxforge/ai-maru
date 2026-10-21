import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { clickMenu, dragResizer, expect, sidebarWidth, test, toggleView } from './app'

type Rect = { x: number; y: number; width: number; height: number }
type Method =
  | 'getBounds'
  | 'getNormalBounds'
  | 'isMaximized'
  | 'isMinimized'
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

/** 기본 크기(1000×700)나 OS 가 고르는 기본 위치와 같으면 복원하지 않아도 테스트가 통과하므로, 둘 다와 다른 자리로 옮긴다. */
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

async function closeWindow(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
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
  writeFileSync(
    join(dataDir, 'window-state.json'),
    JSON.stringify({
      x: -100_000,
      y: -100_000,
      width: 640,
      height: 420,
      isMaximized: true,
      isFullScreen: false
    })
  )
  const { app } = await launch()
  await expect.poll(() => win(app, 'isMaximized')).toBe(true)
  const { x, y } = await win(app, 'getBounds')
  expect(x).toBeGreaterThan(-100_000)
  expect(y).toBeGreaterThan(-100_000)
})

test('저장한 위치가 연결된 모니터 밖이면 기본 위치·크기로 뜬다', async ({ launch, dataDir }) => {
  writeFileSync(
    join(dataDir, 'window-state.json'),
    JSON.stringify({
      x: -100_000,
      y: -100_000,
      width: 640,
      height: 420,
      isMaximized: false,
      isFullScreen: false
    })
  )
  const { app } = await launch()
  const { x, y, width, height } = await win(app, 'getBounds')
  expect({ width, height }).toEqual({ width: 1000, height: 700 })
  expect(x).toBeGreaterThan(-100_000)
  expect(y).toBeGreaterThan(-100_000)
})

test('저장한 파일이 깨졌으면 기본 크기로 뜨고, 닫으면 새로 저장한다', async ({
  launch,
  dataDir
}) => {
  writeFileSync(join(dataDir, 'window-state.json'), '{broken')
  const first = await launch()
  const { width, height } = await win(first.app, 'getBounds')
  expect({ width, height }).toEqual({ width: 1000, height: 700 })
  const placed = await placeWindow(first.app)
  await closeWindow(first.app)

  const second = await launch()
  expect(await win(second.app, 'getBounds')).toEqual(placed)
})

test('저장한 보기 설정이 없으면 columns 로, 사이드바를 연 채 뜬다', async ({ launch, dataDir }) => {
  rmSync(join(dataDir, 'window-state.json'))
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
  await dragResizer(first.page, 60)
  await expect.poll(() => sidebarWidth(first.page)).toBe(before + 60)
  await quitApp(first.app)

  const second = await launch()
  await expect.poll(() => sidebarWidth(second.page)).toBe(before + 60)
})

test('기억한 사이드바 상태로 첫 화면부터 그려, 문서가 뜰 때 사이드바가 움직이지 않는다', async ({
  launch,
  dataDir
}) => {
  writeFileSync(
    join(dataDir, 'window-state.json'),
    JSON.stringify({ viewMode: 'single', sidebar: { open: false, width: 282 } })
  )
  const { app, page } = await launch()
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  // 첫 문서는 `addInitScript` 를 달기 전에 뜨므로, 스크립트를 단 뒤 문서를 새로 고쳐 잰다.
  await app.context().addInitScript(() => {
    const runs: string[] = []
    Object.assign(window, { runs })
    document.addEventListener(
      'transitionrun',
      (e) => runs.push(`${(e.target as Element).className} ${e.propertyName}`),
      true
    )
  })
  await page.reload()
  await page.waitForSelector('.xterm-screen')
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  expect(await page.evaluate(() => (window as unknown as { runs: string[] }).runs)).toEqual([])
})

test('예전 버전이 쓴 위치·크기만 있는 파일이면 그 위치·크기와 columns 로 뜬다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  const placed = await placeWindow(first.app)
  await closeWindow(first.app)
  const file = join(dataDir, 'window-state.json')
  const { x, y, width, height, isMaximized, isFullScreen } = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ x, y, width, height, isMaximized, isFullScreen }))

  const second = await launch()
  expect(await win(second.app, 'getBounds')).toEqual(placed)
  await expect(second.page.locator('.terminals')).toHaveClass(/columns/)
})
