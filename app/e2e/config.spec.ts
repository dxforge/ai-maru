import { mkdirSync, rmSync } from 'node:fs'
import type { Page } from '@playwright/test'
import {
  activeTerminal,
  clickMenu,
  configFile,
  expect,
  newWorkspace,
  shellSize,
  sidebarWidth,
  test,
  toggleView,
  writeConfig
} from './app'

async function terminalFont(page: Page) {
  return page.evaluate(() => {
    const rows = document.querySelector('.terminal-view.active .xterm-rows')!
    const style = getComputedStyle(rows)
    return {
      family: style.fontFamily,
      size: style.fontSize,
      row: rows.firstElementChild!.getBoundingClientRect().height
    }
  })
}

const fontSize = async (page: Page): Promise<string> => (await terminalFont(page)).size

function toast(page: Page) {
  return page.locator('.toast')
}

test('설정 파일이 없으면 지금 기본값으로 그린다', async ({ launch }) => {
  const { page } = await launch()
  const font = await terminalFont(page)
  expect(font.size).toBe('14px')
  expect(font.family).toMatch(/^D2Coding, Menlo/)
  await expect(toast(page)).toHaveCount(0)
})

test('띄울 때 설정 파일의 글꼴·크기·줄 높이를 쓴다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont-family = "Menlo"\nfont-size = 18\nline-height = 1.5\n')
  const { page } = await launch()
  const font = await terminalFont(page)
  expect(font.family).toMatch(/^Menlo, D2Coding/)
  expect(font.size).toBe('18px')
  // 이 설정이면 행 높이는 28px 이고, 기본값(14px, 1.2)이면 18px 이다.
  expect(font.row).toBeGreaterThanOrEqual(26)
  await expect(toast(page)).toHaveCount(0)
})

test('폴더가 없는 채로 띄운 뒤 폴더와 파일을 만들면 적용하고 셸이 본 크기도 바뀐다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const before = await shellSize(page)
  writeConfig(dataDir, '[terminal]\nfont-size = 20\n')
  await expect.poll(() => fontSize(page)).toBe('20px')
  await expect
    .poll(async () => {
      const after = await shellSize(page)
      return after.cols < before.cols && after.rows < before.rows
    })
    .toBe(true)
})

test('줄 높이만 바꿔도 셸이 본 행 수가 바뀐다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  const before = await shellSize(page)
  const row = (await terminalFont(page)).row
  writeConfig(dataDir, '[terminal]\nline-height = 2\n')
  await expect.poll(async () => (await terminalFont(page)).row).toBeGreaterThan(row)
  await expect
    .poll(async () => {
      const after = await shellSize(page)
      return after.cols === before.cols && after.rows < before.rows
    })
    .toBe(true)
})

test('폴더가 있는 채로 띄운 뒤 파일을 고치면 적용한다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 16\n')
  const { page } = await launch()
  expect(await fontSize(page)).toBe('16px')
  writeConfig(dataDir, '[terminal]\nfont-size = 12\n')
  await expect.poll(() => fontSize(page)).toBe('12px')
})

test('파일을 지우면 기본값으로 돌아간다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 16\n')
  const { page } = await launch()
  expect(await fontSize(page)).toBe('16px')
  rmSync(configFile(dataDir))
  await expect.poll(() => fontSize(page)).toBe('14px')
})

test('single 보기의 숨은 workspace 도 새 크기로 맞춘다', async ({ launch, dataDir }) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  writeConfig(dataDir, '[terminal]\nfont-size = 20\n')
  await expect.poll(() => fontSize(page)).toBe('20px')
  const shown = await shellSize(page)
  await clickMenu(app, 'previous-workspace')
  await activeTerminal(page)
  expect(await fontSize(page)).toBe('20px')
  await expect.poll(() => shellSize(page)).toEqual(shown)
})

test('columns 보기에서 화면 밖에 있던 workspace 도 줄 높이에 맞춘다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  const first = page.locator('.panes').first()
  await expect.poll(async () => (await first.boundingBox())!.x + 1 < 0).toBe(true)
  writeConfig(dataDir, '[terminal]\nline-height = 2\n')
  await expect.poll(async () => (await terminalFont(page)).row).toBeGreaterThanOrEqual(28)
  const shown = await shellSize(page)
  await clickMenu(app, 'previous-workspace')
  await clickMenu(app, 'previous-workspace')
  await activeTerminal(page)
  await expect.poll(() => shellSize(page)).toEqual(shown)
})

test('창을 새로 고쳐도 설정 글꼴로 그리고, 그 뒤의 저장도 받는다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 18\n')
  const { page } = await launch()
  await page.reload()
  await activeTerminal(page)
  expect(await fontSize(page)).toBe('18px')
  writeConfig(dataDir, '[terminal]\nfont-size = 12\n')
  await expect.poll(() => fontSize(page)).toBe('12px')
})

test('칸 헤더도 설정 글꼴을 따른다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  writeConfig(dataDir, '[terminal]\nfont-family = "Menlo"\nfont-size = 20\n')
  await expect.poll(() => fontSize(page)).toBe('20px')
  const header = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.pane-header .title')!)
    return [s.fontFamily, s.fontSize]
  })
  const font = await terminalFont(page)
  expect(header).toEqual([font.family, font.size])
})

test('문법 오류는 줄을 알리고 앞의 값을 두며, 고치면 토스트가 닫힌다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 18\n')
  const { page } = await launch()
  writeConfig(dataDir, '[terminal]\nfont-size =\n')
  await expect(toast(page)).toHaveClass(/error/)
  await expect(toast(page)).toContainText("Couldn't read config.toml")
  await expect(toast(page)).toContainText('Line 2, column 12')
  await expect(toast(page)).toContainText('Kept the previous settings.')
  await expect(toast(page)).toContainText('config/config.toml')
  expect(await fontSize(page)).toBe('18px')
  writeConfig(dataDir, '[terminal]\nfont-size = 16\n')
  await expect(toast(page)).toHaveCount(0)
  expect(await fontSize(page)).toBe('16px')
})

test('띄울 때 문법 오류면 기본값으로 그리고 알리며, 고치면 적용한다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[terminal\n')
  const { page } = await launch()
  await expect(toast(page)).toHaveClass(/error/)
  await expect(toast(page)).toContainText('Using the default settings.')
  expect(await fontSize(page)).toBe('14px')
  writeConfig(dataDir, '[terminal]\nfont-size = 18\n')
  await expect(toast(page)).toHaveCount(0)
  expect(await fontSize(page)).toBe('18px')
})

test('범위를 벗어난 값은 맞춰 적용하고 알린다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 40\n')
  const { page } = await launch()
  expect(await fontSize(page)).toBe('32px')
  await expect(toast(page)).toHaveClass(/warning/)
  await expect(toast(page)).toContainText('Applied config.toml with warnings')
  await expect(toast(page)).toContainText('terminal.font-size = 40 is outside 8–32, using 32.')
})

test('모르는 키를 알린다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont_size = 13\n')
  const { page } = await launch()
  await expect(toast(page)).toContainText('Unknown key terminal.font_size.')
})

test('설치되지 않은 글꼴은 알리고, 설치된 글꼴은 알리지 않는다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont-family = "Menlo, No Such Font Maru"\n')
  const { page } = await launch()
  await expect(toast(page)).toHaveClass(/warning/)
  await expect(toast(page)).toContainText('Font "No Such Font Maru" is not installed.')
  await expect(toast(page)).not.toContainText('Font "Menlo"')
  writeConfig(dataDir, '[terminal]\nfont-family = "Menlo"\n')
  await expect(toast(page)).toHaveCount(0)
})

test('라틴 글자가 없는 글꼴도 설치됐으면 알리지 않는다', async ({ launch, dataDir }) => {
  // 앱이 `@font-face` 로 싣는 아이콘 글꼴과 macOS 에 들어 있는 한글 글꼴을 함께 적어, `missingFonts` 의 두 판정 경로를 모두 지나게 한다.
  writeConfig(dataDir, '[terminal]\nfont-family = "Symbols Nerd Font Mono, Apple SD Gothic Neo"\n')
  const { page } = await launch()
  expect(await terminalFont(page).then((f) => f.family)).toMatch(/^"Symbols Nerd Font Mono"/)
  await expect(toast(page)).toHaveCount(0)
})

test('문제 줄이 많아도 토스트가 창 안에 남아 닫을 수 있다', async ({ launch, dataDir }) => {
  const keys = Array.from({ length: 40 }, (_, i) => `unknown-${i} = 1`).join('\n')
  writeConfig(dataDir, `[terminal]\n${keys}\n`)
  const { page } = await launch()
  await expect(toast(page)).toHaveCount(1)
  const box = (await toast(page).boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(toast(page)).toHaveCount(0)
})

test('닫은 뒤 같은 내용으로 다시 저장하면 다시 뜬다', async ({ launch, dataDir }) => {
  const text = '[terminal]\nfont-size = 40\n'
  writeConfig(dataDir, text)
  const { page } = await launch()
  await expect(toast(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(toast(page)).toHaveCount(0)
  writeConfig(dataDir, text)
  await expect(toast(page)).toHaveCount(1)
})

test('설정 파일을 읽을 수 없으면 알린다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  mkdirSync(configFile(dataDir), { recursive: true })
  await expect(toast(page)).toHaveClass(/error/)
  await expect(toast(page)).toContainText('EISDIR')
  await expect(toast(page)).toContainText('Kept the previous settings.')
})

test('띄울 때 설정 파일을 읽을 수 없으면 기본값을 쓴다고 알린다', async ({ launch, dataDir }) => {
  mkdirSync(configFile(dataDir), { recursive: true })
  const { page } = await launch()
  await expect(toast(page)).toContainText('EISDIR')
  await expect(toast(page)).toContainText('Using the default settings.')
  expect(await fontSize(page)).toBe('14px')
})

test('토스트는 사이드바 왼쪽 아래 안쪽에 뜨고, 사이드바를 접으면 258px 폭이다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 40\n')
  const { app, page } = await launch()
  await expect(toast(page)).toHaveCount(1)
  const box = (await toast(page).boundingBox())!
  const height = await page.evaluate(() => innerHeight)
  expect(box.x).toBe(12)
  expect(box.y + box.height).toBe(height - 12)
  expect(box.x + box.width).toBeLessThanOrEqual((await sidebarWidth(page)) - 12)
  await clickMenu(app, 'toggle-sidebar')
  await expect.poll(async () => (await toast(page).boundingBox())!.width).toBe(258)
})
