import { rmSync } from 'node:fs'
import type { ElectronApplication, Page } from '@playwright/test'
import { GHOSTTY } from '../src/shared/theme'
import { closeWindow, configFile, expect, readState, test, toast, writeConfig } from './app'

const MOCHA = '#1e1e2e'
const LATTE = '#eff1f5'
const DEFAULT = GHOSTTY.background

const rgb = (hex: string): string =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

function ground(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()
  )
}

function terminalBackground(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.querySelector('.terminal-view.active .xterm')!).backgroundColor
  )
}

async function windowBackground(app: ElectronApplication): Promise<string> {
  const color = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBackgroundColor()
  )
  return color.toLowerCase()
}

function themeSource(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
}

function prefersDark(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
}

test('띄울 때 terminal.theme 의 테마로 앱 화면·터미널·창 배경을 그린다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[terminal]\ntheme = "Catppuccin Mocha"\n')
  const { app, page } = await launch()
  expect(await ground(page)).toBe(MOCHA)
  expect(await terminalBackground(page)).toBe(rgb(MOCHA))
  expect(await windowBackground(app)).toBe(MOCHA)
  expect(await themeSource(app)).toBe('dark')
  expect(await prefersDark(page)).toBe(true)
  await expect(toast(page)).toHaveCount(0)
})

test('저장하면 떠 있는 터미널에 바로 적용하고, 파일을 지우면 기본 테마로 돌아간다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  expect(await ground(page)).toBe(DEFAULT)
  writeConfig(dataDir, '[terminal]\ntheme = "Catppuccin Mocha"\n')
  await expect.poll(() => ground(page)).toBe(MOCHA)
  expect(await terminalBackground(page)).toBe(rgb(MOCHA))
  await expect.poll(() => windowBackground(app)).toBe(MOCHA)
  rmSync(configFile(dataDir))
  await expect.poll(() => ground(page)).toBe(DEFAULT)
  expect(await terminalBackground(page)).toBe(rgb(DEFAULT))
  await expect.poll(() => windowBackground(app)).toBe(DEFAULT)
})

test('밝은 테마면 창 틀도 밝다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\ntheme = "Catppuccin Latte"\n')
  const { app, page } = await launch()
  expect(await ground(page)).toBe(LATTE)
  expect(await themeSource(app)).toBe('light')
  expect(await prefersDark(page)).toBe(false)
})

test('라이트·다크 짝을 적으면 창 틀은 OS 를 따르고, 터미널은 OS 모드의 테마다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  writeConfig(
    dataDir,
    '[terminal]\ntheme = { light = "Catppuccin Latte", dark = "Catppuccin Mocha" }\n'
  )
  await expect.poll(() => themeSource(app)).toBe('system')
  const dark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)
  await expect.poll(() => prefersDark(page)).toBe(dark)
  await expect.poll(() => ground(page)).toBe(dark ? MOCHA : LATTE)
  await expect.poll(() => windowBackground(app)).toBe(dark ? MOCHA : LATTE)
  await expect(toast(page)).toHaveCount(0)
})

test('기본 테마로 닫았다가 다시 띄워도 창 틀은 어둡다', async ({ launch }) => {
  const first = await launch()
  expect(await themeSource(first.app)).toBe('dark')
  await closeWindow(first.app)
  const second = await launch()
  expect(await themeSource(second.app)).toBe('dark')
  expect(await windowBackground(second.app)).toBe(DEFAULT)
})

test('모르는 이름이면 알리고 기본 테마를 쓴다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\ntheme = "catppuccin mocha"\n')
  const { app, page } = await launch()
  await expect(toast(page)).toContainText(
    'terminal.theme: no theme named "catppuccin mocha", using the default.'
  )
  expect(await ground(page)).toBe(DEFAULT)
  expect(await themeSource(app)).toBe('dark')
})

test('light·dark 가운데 하나만 적으면 알리고 기본 테마를 쓴다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\ntheme = { dark = "Catppuccin Mocha" }\n')
  const { page } = await launch()
  await expect(toast(page)).toContainText(
    'terminal.theme must be a theme name or { light = "…", dark = "…" }, using the default.'
  )
  expect(await ground(page)).toBe(DEFAULT)
})

test('닫을 때 적용돼 있던 테마를 적어 두어, 다음 실행의 창이 그 배경색으로 뜬다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[terminal]\ntheme = "Catppuccin Latte"\n')
  const first = await launch()
  await closeWindow(first.app)
  expect(readState(dataDir).view.theme).toEqual({ background: LATTE, mode: 'light' })

  rmSync(configFile(dataDir))
  const second = await launch()
  await expect.poll(() => windowBackground(second.app)).toBe(DEFAULT)
})
