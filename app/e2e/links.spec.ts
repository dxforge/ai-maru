import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  activeTerminal,
  canvasTitles,
  cellSize,
  expect,
  restartWith,
  rows,
  run,
  test,
  toast
} from './app'

type Opened = { opened?: string[]; paths?: string[] }

/** `shell.openExternal`·`shell.openPath` 를 기록만 하게 바꾼다 — 테스트가 브라우저·Finder 를 띄우지 않게. */
async function recordShell(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as Opened
    g.opened = []
    g.paths = []
    shell.openExternal = async (url: string) => void g.opened!.push(url)
    shell.openPath = async (path: string) => {
      g.paths!.push(path)
      return ''
    }
  })
}

const opened = (app: ElectronApplication) => app.evaluate(() => (globalThis as Opened).opened)
const paths = (app: ElectronApplication) => app.evaluate(() => (globalThis as Opened).paths)

/** 화면에서 `text` 가 마지막으로 보이는 줄(친 명령이 아니라 출력)의 그 글자 둘째 셀 가운데. */
async function pointAt(page: Page, text: string): Promise<{ x: number; y: number }> {
  const screen = (await page.locator('.terminal-view.active .xterm-screen').boundingBox())!
  const cell = await cellSize(page)
  const lines = await rows(page).locator('> div').allInnerTexts()
  const row = lines.findLastIndex((l) => l.includes(text))
  expect(row, `${text} 가 화면에 없다: ${JSON.stringify(lines)}`).toBeGreaterThanOrEqual(0)
  const col = lines[row].indexOf(text) + 1
  return { x: screen.x + (col + 0.5) * cell.width, y: screen.y + (row + 0.5) * cell.height }
}

async function metaClick(page: Page, text: string): Promise<void> {
  const { x, y } = await pointAt(page, text)
  await page.mouse.move(x, y)
  await page.keyboard.down('Meta')
  await page.mouse.click(x, y)
  await page.keyboard.up('Meta')
}

const OSC8 = (url: string, label: string) => `printf '\\e]8;;${url}\\a${label}\\e]8;;\\a\\n'`

test('OSC 8 링크는 ⌘+클릭으로 열고, 그냥 클릭은 열지 않는다', async ({ launch }) => {
  const { app, page } = await launch()
  await activeTerminal(page)
  await recordShell(app)
  await run(page, `${OSC8('https://example.com/osc', 'repo#7')}; echo done-$((1+1))`, 'done-2')

  const { x, y } = await pointAt(page, 'repo#7')
  await page.mouse.click(x, y)
  await page.waitForTimeout(200)
  expect(await opened(app)).toEqual([])

  await metaClick(page, 'repo#7')
  await expect.poll(() => opened(app)).toEqual(['https://example.com/osc'])
})

test('⌘ 를 누른 채 OSC 8 링크에 올리면 주소가 보이고, 떼거나 떠나면 사라진다', async ({
  launch
}) => {
  const { page } = await launch()
  await activeTerminal(page)
  await run(page, `${OSC8('https://example.com/addr', 'repo#8')}; echo done-$((1+1))`, 'done-2')
  const address = page.locator('.terminal-view.active .link-address')
  const { x, y } = await pointAt(page, 'repo#8')

  await page.mouse.move(x, y)
  await expect(address).toBeHidden()
  await page.keyboard.down('Meta')
  await expect(address).toHaveText('https://example.com/addr')
  await page.keyboard.up('Meta')
  await expect(address).toBeHidden()

  await page.keyboard.down('Meta')
  await expect(address).toBeVisible()
  await page.mouse.move(x, y + 200)
  await expect(address).toBeHidden()
  await page.keyboard.up('Meta')
})

test('글자로 찍힌 URL 은 OS 로, .md 는 Canvas 로, 그 밖의 파일은 OS 기본 앱으로 간다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await activeTerminal(page)
  await recordShell(app)
  writeFileSync(join(dataDir, 'note.md'), '# From link')
  writeFileSync(join(dataDir, 'a.txt'), 'x')
  // 기다리는 글자는 친 명령에 없는 것으로 — 명령이 돌기 전에 맞으면 링크를 명령 줄에서 찾는다.
  await run(
    page,
    `cd '${dataDir}'; echo https://example.com/text; echo "$PWD/note.md:3"; echo "$PWD/a.txt"; echo done-$((1+1))`,
    'done-2'
  )

  await metaClick(page, 'https://example.com/text')
  await expect.poll(() => opened(app)).toEqual(['https://example.com/text'])

  await metaClick(page, 'a.txt')
  await expect.poll(() => paths(app)).toEqual([join(dataDir, 'a.txt')])

  // Canvas 가 열리면 터미널 폭이 줄어 줄이 다시 접히고 글자 자리가 바뀌므로 마지막에 누른다.
  await metaClick(page, 'note.md:3')
  await expect(canvasTitles(page)).toHaveText(['note.md'])
  await expect(page.locator('.canvas .markdown h1')).toHaveText('From link')
})

test('상대경로는 돌고 있는 명령의 cwd 기준이다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await activeTerminal(page)
  mkdirSync(join(dataDir, 'sub'))
  writeFileSync(join(dataDir, 'sub', 'rel.md'), '# In sub')
  await run(
    page,
    `cd '${dataDir}'; sh -c 'cd sub && echo ./rel.md && echo done-$((1+1)) && sleep 30'`,
    'done-2'
  )

  await metaClick(page, './rel.md')
  await expect(canvasTitles(page)).toHaveText(['rel.md'])
  await expect(page.locator('.canvas .markdown h1')).toHaveText('In sub')
})

test('못 여는 링크는 이유를 토스트로 보인다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await activeTerminal(page)
  await run(page, `echo '${dataDir}/none.md'; echo done-$((1+1))`, 'done-2')

  await metaClick(page, 'none.md')
  await expect(toast(page)).toHaveClass(/warning/)
  await expect(toast(page).locator('.title')).toHaveText("Couldn't open the link")
  await expect(toast(page).locator('.line')).toHaveText(`${dataDir}/none.md doesn't exist`)
})

// 재생에는 OSC 8 이 실리지 않는다 — `maru-session` 의 ghostty formatter 는 셀마다의 hyperlink 를 VT 로 내지 않는다.
// 글자로 찍힌 링크는 재생된 글자에서 provider 가 다시 찾는다.
test('재시작해 세션에 다시 붙어도 글자로 찍힌 링크는 열린다', async ({ launch }) => {
  const first = await launch()
  await activeTerminal(first.page)
  await run(first.page, 'echo https://example.com/kept; echo done-$((1+1))', 'done-2')

  await restartWith(first.app)
  const { app, page } = await launch()
  await activeTerminal(page)
  await expect(rows(page)).toContainText('example.com/kept')
  await recordShell(app)

  await metaClick(page, 'example.com/kept')
  await expect.poll(() => opened(app)).toEqual(['https://example.com/kept'])
})
