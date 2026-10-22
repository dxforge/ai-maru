import type { ElectronApplication, Page } from '@playwright/test'
import {
  activeTerminal,
  clickMenu,
  expect,
  newWorkspace,
  openPalette,
  restartWith,
  shellSize,
  split,
  test,
  toggleView,
  workspaceViews,
  writeConfig
} from './app'

function fontSizes(page: Page): Promise<string[][]> {
  return workspaceViews(page).evaluateAll((ws) =>
    ws.map((w) =>
      Array.from(w.querySelectorAll('.xterm-rows'), (r) => getComputedStyle(r).fontSize)
    )
  )
}

const increase = (app: ElectronApplication) => clickMenu(app, 'increase-font-size')
const decrease = (app: ElectronApplication) => clickMenu(app, 'decrease-font-size')
const reset = (app: ElectronApplication) => clickMenu(app, 'reset-font-size')

test('Increase·Decrease·Reset Font Size 는 선택한 workspace 의 모든 pane 만 1px 씩 바꾸고, 셸이 본 크기도 바뀐다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await split(app, page, 'split-right', 2)
  const before = await shellSize(page)

  await increase(app)
  await increase(app)
  await expect.poll(() => fontSizes(page)).toEqual([['14px'], ['16px', '16px']])
  await expect
    .poll(async () => {
      const after = await shellSize(page)
      return after.cols < before.cols && after.rows < before.rows
    })
    .toBe(true)

  await decrease(app)
  await expect.poll(() => fontSizes(page)).toEqual([['14px'], ['15px', '15px']])

  await reset(app)
  await expect.poll(() => fontSizes(page)).toEqual([['14px'], ['14px', '14px']])
  await expect.poll(() => shellSize(page)).toEqual(before)
})

test('설정 파일의 font-size 와 같은 8–32 를 넘지 않고, Reset 은 설정 파일의 크기로 돌아간다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 9\n')
  const { app, page } = await launch()
  await decrease(app)
  await decrease(app)
  await expect.poll(() => fontSizes(page)).toEqual([['8px']])
  await reset(app)
  await expect.poll(() => fontSizes(page)).toEqual([['9px']])

  writeConfig(dataDir, '[terminal]\nfont-size = 31\n')
  await expect.poll(() => fontSizes(page)).toEqual([['31px']])
  await increase(app)
  await increase(app)
  await expect.poll(() => fontSizes(page)).toEqual([['32px']])
})

test('설정 파일의 font-size 가 바뀌면 크기를 바꾸지 않았거나 설정 크기로 돌아온 workspace 만 따른다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await increase(app)
  await clickMenu(app, 'previous-workspace')
  await increase(app)
  await decrease(app)
  await expect.poll(() => fontSizes(page)).toEqual([['14px'], ['14px'], ['15px']])

  writeConfig(dataDir, '[terminal]\nfont-size = 18\n')
  await expect.poll(() => fontSizes(page)).toEqual([['18px'], ['18px'], ['15px']])
})

test('나눈 pane 은 workspace 의 크기를 쓰고, 새 workspace 는 띄운 쪽이 아니라 설정 파일의 크기로 시작한다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await increase(app)
  await increase(app)
  await split(app, page, 'split-down', 2)
  await newWorkspace(launched, 2)
  await expect.poll(() => fontSizes(page)).toEqual([['16px', '16px'], ['14px']])
})

test('재시작하면 workspace 마다 바꾼 크기를 되살리고, 셸이 본 크기도 그대로다', async ({
  launch
}) => {
  const first = await launch()
  await newWorkspace(first, 2)
  await increase(first.app)
  await increase(first.app)
  await expect.poll(() => fontSizes(first.page)).toEqual([['14px'], ['16px']])
  const before = await shellSize(first.page)
  // 다시 띄운 앱을 기다리는 `launch` 가 첫 터미널이 보이기를 기다리므로 첫 workspace 를 선택해 둔다.
  await clickMenu(first.app, 'previous-workspace')
  await activeTerminal(first.page)

  await restartWith(first.app)
  const again = await launch()
  await expect.poll(() => fontSizes(again.page)).toEqual([['14px'], ['16px']])
  await clickMenu(again.app, 'next-workspace')
  await activeTerminal(again.page)
  await expect.poll(() => shellSize(again.page)).toEqual(before)
})

test('columns 보기에서 크기를 키운 카드는 pane 이 80열인 채로 넓어지고, 헤더도 그 크기를 따른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await newWorkspace(launched, 2)
  for (let i = 0; i < 4; i++) await increase(app)
  await expect.poll(() => fontSizes(page)).toEqual([['14px'], ['18px']])
  await expect.poll(async () => (await shellSize(page)).cols).toBe(80)

  const measure = (i: number) =>
    workspaceViews(page)
      .nth(i)
      .evaluate((w) => ({
        width: w.getBoundingClientRect().width,
        header: w.querySelector('.workspace-header')!.getBoundingClientRect().height,
        pane: w.querySelector('.pane-header')!.getBoundingClientRect().height,
        title: getComputedStyle(w.querySelector('.pane-header .title')!).fontSize
      }))
  const [small, large] = [await measure(0), await measure(1)]
  expect(large.width).toBeGreaterThan(small.width)
  expect(large.header).toBeGreaterThan(small.header)
  expect(large.pane).toBe(large.header)
  expect([small.title, large.title]).toEqual(['14px', '18px'])
})

test('명령 팔레트에서 Increase·Decrease·Reset Font Size 를 실행한다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  for (const [query, size] of [
    ['increase font', '15px'],
    ['increase font', '16px'],
    ['decrease font', '15px'],
    ['reset font', '14px']
  ]) {
    await openPalette(launched)
    await page.keyboard.type(query)
    await page.keyboard.press('Enter')
    await expect.poll(() => fontSizes(page)).toEqual([[size]])
  }
})

test('설정 파일의 글꼴을 바꿔도 셀 크기가 같으면 columns 카드 폭과 셸이 본 크기가 그대로다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await newWorkspace(launched, 2)
  await increase(app)
  await expect.poll(() => fontSizes(page)).toEqual([['14px'], ['15px']])
  const cardWidths = () =>
    workspaceViews(page).evaluateAll((ws) => ws.map((w) => w.getBoundingClientRect().width))
  const widths = await cardWidths()
  const before = await shellSize(page)

  // 없는 글꼴은 건너뛰고 기본 글꼴로 그리므로 셀 크기는 그대로이고 글꼴 값만 달라진다.
  writeConfig(dataDir, '[terminal]\nfont-family = "NoSuchFont"\n')
  await expect(page.locator('.toast')).toContainText('NoSuchFont')
  await expect(page.locator('.xterm-rows').first()).toHaveCSS('font-family', /NoSuchFont/)
  await expect.poll(cardWidths).toEqual(widths)
  expect(await shellSize(page)).toEqual(before)
})
