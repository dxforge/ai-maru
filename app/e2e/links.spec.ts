import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  canvasTitles,
  cellSize,
  DOM_RENDERER,
  expect,
  resizeBy,
  restartWith,
  rows,
  run,
  test,
  toast,
  writeConfig
} from './app'

// 링크를 누를 자리를 화면에 보이는 행(`.xterm-rows`)의 글자로 찾으므로 터미널을 DOM renderer 로 그린다.

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
 * 화면에서 `text` 가 마지막으로 보이는 줄(친 명령이 아니라 출력)의 그 글자 둘째 글자 칸 가운데. 출력보다 먼저 기다림이
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

/**
 * xterm 은 mousedown 때 마우스 아래에 잡힌 링크가 있어야 클릭을 링크로 넘긴다. 줄을 이어 붙인 경로는 main 이 그 경로가
 * 있는지 답한 뒤에 링크가 되므로, ⌘ 를 누른 채 링크가 잡혀 포인터가 바뀐 뒤에 누른다.
 */
async function metaClick(page: Page, text: string): Promise<void> {
  const { x, y } = await pointAt(page, text)
  await page.mouse.move(x, y)
  await page.keyboard.down('Meta')
  await expect(page.locator('.terminal-view.active .xterm-screen')).toHaveClass(
    /xterm-cursor-pointer/
  )
  await page.mouse.click(x, y)
  await page.keyboard.up('Meta')
}

const OSC8 = (url: string, label: string) => `printf '\\e]8;;${url}\\a${label}\\e]8;;\\a\\n'`

test('OSC 8 링크는 ⌘+클릭으로 열고, 그냥 클릭은 열지 않는다', async ({ launch }) => {
  const { app, page } = await launch(DOM_RENDERER)
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
  const { page } = await launch(DOM_RENDERER)
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

for (const header of ['bottom', 'top'] as const) {
  test(`헤더가 ${header === 'bottom' ? '아래' : '위'}일 때 ⌘ 를 누른 채 링크에 올려 뜬 주소는 pane 왼쪽 끝에 붙고 pane 헤더나 pane 끝에 가리지 않는다`, async ({
    launch,
    dataDir
  }) => {
    if (header === 'top') writeConfig(dataDir, '[layout]\nheader = "top"\n')
    const { app, page } = await launch(DOM_RENDERER)
    // 본문이 헤더를 뺀 행 수보다 반 행 길면 주소의 아래 끝이 가려지는지 보려고, pane 높이를 행 높이의 배수보다 1/4 행 크게 맞춘다.
    const { height: row } = await cellSize(page)
    const grid = () =>
      page.locator('.panes.selected .grid').evaluate((el) => el.getBoundingClientRect().height)
    const before = await grid()
    const target = (Math.floor(before / row) + 0.25) * row
    await resizeBy(app, 0, Math.round(target - before))
    await expect.poll(async () => Math.abs((await grid()) - target)).toBeLessThan(1)
    await run(page, `${OSC8('https://example.com/clip', 'repo#9')}; echo done-$((1+1))`, 'done-2')
    const address = page.locator('.terminal-view.active .link-address')
    const { x, y } = await pointAt(page, 'repo#9')
    await page.mouse.move(x, y)
    await page.keyboard.down('Meta')
    await expect(address).toBeVisible()

    const place = await address.evaluate((el) => {
      const pane = el.closest('.pane')!
      return {
        left: el.getBoundingClientRect().left,
        paneLeft: pane.getBoundingClientRect().left,
        bottom: el.getBoundingClientRect().bottom,
        paneBottom: pane.getBoundingClientRect().bottom,
        headTop: pane.querySelector('.pane-header')!.getBoundingClientRect().top
      }
    })
    await page.keyboard.up('Meta')
    expect(place.left).toBeCloseTo(place.paneLeft, 1)
    expect(place.bottom).toBeLessThanOrEqual(place.paneBottom)
    if (header === 'bottom') expect(place.bottom).toBeLessThanOrEqual(place.headTop)
  })
}

test('글자로 찍힌 .md 경로는 Canvas 로 간다', async ({ launch, dataDir }) => {
  const { page } = await launch(DOM_RENDERER)
  writeFileSync(join(dataDir, 'note.md'), '# From link')
  await run(page, `cd '${dataDir}'; echo "$PWD/note.md:3"; echo done-$((1+1))`, 'done-2')

  await metaClick(page, 'note.md:3')
  await expect(canvasTitles(page)).toHaveText(['note.md'])
  await expect(page.locator('.canvas .markdown h1')).toHaveText('From link')
})

test('줄 끝에서 끊겨 다음 줄에 이어 찍힌 경로는 어느 줄을 ⌘+클릭해도 이어 붙인 경로를 연다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(DOM_RENDERER)
  await recordShell(app)
  mkdirSync(join(dataDir, 'sub', 'c769d050-299b'), { recursive: true })
  // 상대경로는 foreground 프로세스의 cwd 로 푼다. 그 cwd 는 symlink 를 푼 경로(`/private/var/…`)이므로 기대값도 `realpathSync` 로 푼다.
  const file = join(realpathSync(dataDir), 'sub', 'c769d050-299b', 'robot.txt')
  // 글자 파일은 Canvas 로 가므로, OS 기본 앱으로 가는 바이너리로 둔다.
  writeFileSync(file, 'x\0')
  // Claude Code 처럼 경로를 끊고, 다음 줄은 앞에 공백 두 칸을 두고 잇는다.
  await run(
    page,
    `cd '${dataDir}'; printf '  Path: sub/c769d050\\n  -299b/robot.txt\\n'; echo done-$((1+1))`,
    'done-2'
  )

  await metaClick(page, '-299b/robot.txt')
  await expect.poll(() => paths(app)).toEqual([file])
  await metaClick(page, 'sub/c769d050')
  await expect.poll(() => paths(app)).toEqual([file, file])
})

/** 강조한 줄이 몇째 줄(1부터) 자리에 있는지. 줄 번호 열의 높이를 줄 수로 나눈 줄 높이로 잰다. */
async function bandLine(page: Page, count: number): Promise<number> {
  const band = (await page.locator('.canvas .code .band').boundingBox())!
  const gutter = (await page.locator('.canvas .code .gutter').boundingBox())!
  return Math.round((band.y - gutter.y) / (gutter.height / count)) + 1
}

test('코드 파일은 Canvas 의 코드 뷰로 열고, 링크의 줄로 스크롤해 강조한다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(DOM_RENDERER)
  await recordShell(app)
  const count = 120
  const lines = Array.from({ length: count }, (_, i) => `const v${i + 1} = ${i + 1}`)
  writeFileSync(join(dataDir, 'code.ts'), lines.join('\n') + '\n')
  await run(page, `cd '${dataDir}'; echo ./code.ts:90; echo done-$((1+1))`, 'done-2')

  await metaClick(page, 'code.ts:90')
  await expect(canvasTitles(page)).toHaveText(['code.ts'])
  const band = page.locator('.canvas .code .band')
  await expect(band).toBeInViewport()
  expect(await bandLine(page, count)).toBe(90)
  // 강조는 worker 가 file:// 로 띄운 앱에서도 돈다.
  await expect(page.locator('.canvas .code .text span').first()).toHaveText('const')

  // 접었다 펴면 링크의 줄로 다시 스크롤하지 않고, 카드 자리를 지킨다.
  const scroller = page.locator('.canvas .scroll')
  await scroller.evaluate((el) => el.scrollTo(0, 0))
  await expect(band).not.toBeInViewport()
  const title = canvasTitles(page).first()
  await title.click()
  await expect(band).toHaveCount(0)
  await title.click()
  await expect(band).toHaveCount(1)
  await page.waitForTimeout(200)
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0)
  await expect(band).not.toBeInViewport()

  // Canvas 가 열려 터미널 폭이 줄었으므로 다음 링크는 그 뒤에 찍는다. 두 링크를 같은 경로로 풀도록 둘 다 상대경로로 둔다.
  await run(page, `echo ./code.ts:5:2; echo done-$((2+2))`, 'done-4')
  await metaClick(page, './code.ts:5')
  await expect(canvasTitles(page)).toHaveText(['code.ts'])
  await expect(band).toBeInViewport()
  await expect.poll(() => bandLine(page, count)).toBe(5)
  expect(await paths(app)).toEqual([])
})

test('상대경로는 돌고 있는 명령의 cwd 기준이다', async ({ launch, dataDir }) => {
  const { page } = await launch(DOM_RENDERER)
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
  const { page } = await launch(DOM_RENDERER)
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
  test(`재시작해 pty 에 다시 붙어도 ${kind}는 열린다`, async ({ launch }) => {
    const first = await launch(DOM_RENDERER)
    await run(first.page, `${print}; echo done-$((1+1))`, 'done-2')

    await restartWith(first.app)
    const { app, page } = await launch(DOM_RENDERER)
    await expect(rows(page)).toContainText(text)
    await recordShell(app)

    await metaClick(page, text)
    await expect.poll(() => opened(app)).toEqual([url])
  })
