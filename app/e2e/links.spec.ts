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

/**
 * 화면에서 `text` 가 마지막으로 보이는 줄(친 명령이 아니라 출력)의 그 글자 둘째 셀 가운데. 출력보다 먼저 기다림이
 * 끝나면 명령 줄에서 찾으므로, `run` 이 기다리는 글자는 친 명령에 없는 글자(`done-$((1+1))` → `done-2`)로 둔다.
 */
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

for (const [kind, print, text, url] of [
  [
    'OSC 8 링크',
    OSC8('https://example.com/replayed', 'repo#9'),
    'repo#9',
    'https://example.com/replayed'
  ],
  [
    '글자로 찍힌 링크',
    'echo https://example.com/kept',
    'example.com/kept',
    'https://example.com/kept'
  ]
] as const)
  test(`재시작해 세션에 다시 붙어도 ${kind}는 열린다`, async ({ launch }) => {
    const first = await launch()
    await activeTerminal(first.page)
    await run(first.page, `${print}; echo done-$((1+1))`, 'done-2')

    await restartWith(first.app)
    const { app, page } = await launch()
    await activeTerminal(page)
    await expect(rows(page)).toContainText(text)
    await recordShell(app)

    await metaClick(page, text)
    await expect.poll(() => opened(app)).toEqual([url])
  })
