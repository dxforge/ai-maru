import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './app'

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
