import type { Locator, Page } from '@playwright/test'
import {
  activePane,
  claudeHook,
  clickMenu,
  expect,
  newWorkspace,
  openPalette,
  paneRows,
  panes,
  resizeBy,
  run,
  shellSize,
  setZoom,
  split,
  test,
  toggleView,
  workspaceGroups,
  workspaceItems,
  workspaceViews,
  zshHome
} from './app'

/** 폭이 바뀐 직후의 크기는 셸이 SIGWINCH 를 받기 전일 수 있어 기대한 열 수가 될 때까지 다시 잰다. */
async function expectCols(page: Page, cols: number): Promise<void> {
  await expect.poll(async () => (await shellSize(page)).cols).toBe(cols)
}

async function inView(page: Page, el: Locator): Promise<boolean> {
  const area = (await page.locator('.terminals').boundingBox())!
  const box = (await el.boundingBox())!
  return box.x >= area.x - 1 && box.x + box.width <= area.x + area.width + 1
}

test('View 메뉴의 Toggle View Mode 는 workspace 를 가로로 늘어놓아 80열로 보이고, 다시 누르면 선택한 것만 보인다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'X=a-$((1+1)); echo set-$((1+2))', 'set-3')
  await newWorkspace(launched, 2)
  const single = await shellSize(page)
  expect(single.cols).not.toBe(80)

  await toggleView(launched, 'columns')

  await expect(workspaceViews(page).nth(0)).toBeVisible()
  await expect(workspaceViews(page).nth(1)).toBeVisible()
  const [a, b] = [
    (await workspaceViews(page).nth(0).boundingBox())!,
    (await workspaceViews(page).nth(1).boundingBox())!
  ]
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)
  expect(b.y).toBe(a.y)
  expect(b.height).toBe(a.height)
  await expectCols(page, 80)
  await workspaceItems(page).first().click()
  await expectCols(page, 80)
  await run(page, 'echo "x=$X"', 'x=a-2')

  await toggleView(launched, 'single')

  await expect(workspaceViews(page).nth(0)).toBeVisible()
  await expect(workspaceViews(page).nth(1)).toBeHidden()
  expect(await page.locator('.terminals').evaluate((el) => el.scrollLeft)).toBe(0)
  await expectCols(page, single.cols)
})

test('팔레트의 Toggle View Mode 도 view mode 를 바꾸고, 키는 터미널로 간다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await page.keyboard.type('view mode')
  await page.keyboard.press('Enter')

  await expect(page.locator('.terminals')).toHaveClass(/columns/)
  await expectCols(page, 80)
})

test('columns 에서 좌우로 고르게 나누면 칸마다 80열이고, 고르지 않게 나누면 늘어선 칸 수만큼 넓어진다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')

  await split(app, page, 'split-right', 2)
  await expectCols(page, 80)
  await clickMenu(app, 'focus-pane-left')
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await expectCols(page, 80)

  await clickMenu(app, 'focus-pane-right')
  await split(app, page, 'split-right', 3)

  // 늘어선 칸이 셋이라 240열 폭을 1/2·1/4·1/4 로 나눈다 — 좁은 칸은 80열보다 좁다.
  const narrow = (await shellSize(page)).cols
  expect(narrow).toBeLessThan(80)
  expect(narrow).toBeGreaterThan(55)
  await clickMenu(app, 'focus-pane-left')
  await clickMenu(app, 'focus-pane-left')
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  const wide = (await shellSize(page)).cols
  expect(wide).toBeGreaterThan(110)
  expect(wide).toBeLessThan(130)
})

test('columns 에서 다른 workspace 의 칸을 누르면 그 workspace 를 선택하고 키가 그리로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'X=a-$((1+1)); echo set-$((1+2))', 'set-3')
  await newWorkspace(launched, 2)
  await run(page, 'X=b-$((2+2)); echo set-$((2+3))', 'set-5')
  await toggleView(launched, 'columns')

  await workspaceViews(page).nth(0).locator('.pane').click()

  await expect(workspaceGroups(page).first()).toHaveClass(/selected/)
  await expect(workspaceGroups(page).nth(1)).not.toHaveClass(/selected/)
  await run(page, 'echo "x=$X"', 'x=a-2')
  await split(launched.app, page, 'split-right', 2)
  await expect(workspaceViews(page).nth(1).locator('.pane')).toHaveCount(1)
})

test('columns 에서 위아래로 나눈 칸도 80열이고, 칸을 닫으면 workspace 폭이 다시 준다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  const one = (await workspaceViews(page).first().boundingBox())!.width

  await split(app, page, 'split-right', 2)
  expect((await workspaceViews(page).first().boundingBox())!.width).toBeGreaterThan(one * 1.9)
  await clickMenu(app, 'close-pane')
  await expect(panes(page)).toHaveCount(1)
  await expect.poll(async () => (await workspaceViews(page).first().boundingBox())!.width).toBe(one)

  await split(app, page, 'split-down', 2)
  await expectCols(page, 80)
  expect((await workspaceViews(page).first().boundingBox())!.width).toBe(one)
})

test('columns 에서 넘치면 가로로 스크롤하고, 포커스가 간 칸이 보이도록 따라간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  const area = page.locator('.terminals')
  expect(await area.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
  await expect.poll(() => inView(page, workspaceViews(page).nth(0))).toBe(false)

  await workspaceItems(page).first().click()
  await expect.poll(() => inView(page, workspaceViews(page).nth(0))).toBe(true)

  await newWorkspace(launched, 4)
  await expect.poll(() => inView(page, workspaceViews(page).nth(3))).toBe(true)

  await workspaceItems(page).first().click()
  await split(app, page, 'split-right', 2)
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
  await expect.poll(() => inView(page, panes(page).nth(0))).toBe(false)
  await clickMenu(app, 'focus-pane-left')
  await expect.poll(() => inView(page, panes(page).nth(0))).toBe(true)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)

  await area.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect.poll(() => inView(page, activePane(page))).toBe(false)
  await workspaceItems(page).first().click()
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
})

test('columns 에서 포커스가 같은 칸으로 돌아와도 스크롤한 자리는 그대로고, 사이드바의 칸 줄을 누르면 그 칸을 보인다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type(claudeHook('UserPromptSubmit'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await workspaceItems(page).first().click()
  await expect.poll(() => inView(page, activePane(page))).toBe(true)

  const area = page.locator('.terminals')
  const scrolled = await area.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
    return el.scrollLeft
  })
  await expect.poll(() => inView(page, activePane(page))).toBe(false)
  // 브라우저가 focus() 로 스스로 스크롤하지 않게 해서 앱이 하는 스크롤만 잰다.
  await activePane(page)
    .locator('textarea')
    .evaluate(async (el) => {
      el.blur()
      el.focus({ preventScroll: true })
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
  expect(await area.evaluate((el) => el.scrollLeft)).toBe(scrolled)

  await paneRows(page).click()
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
})

test('columns 에서 칸의 디렉토리가 바뀌어도 스크롤한 자리는 그대로다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch({ SHELL: '/bin/zsh', HOME: zshHome(dataDir, 'notes') })
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  const names = page.locator('.workspace-header .name')
  await expect(names).toHaveText(['home', 'home', 'home'])
  await page.keyboard.type('sleep 2; cd notes\n')

  const area = page.locator('.terminals')
  await area.evaluate((el) => (el.scrollLeft = 0))
  await expect.poll(() => inView(page, activePane(page))).toBe(false)
  await expect(names).toHaveText(['home', 'home', 'notes'])
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  )
  expect(await area.evaluate((el) => el.scrollLeft)).toBe(0)
})

test('columns 에서 앞의 workspace 가 닫혀도 포커스된 칸이 화면에 남고 키를 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await workspaceItems(page).first().click()
  await page.keyboard.type('sleep 1.5; exit\n')
  await workspaceItems(page).nth(1).click()
  await expect.poll(() => inView(page, activePane(page))).toBe(true)

  await expect(workspaceItems(page)).toHaveCount(2)

  await expect.poll(() => inView(page, activePane(page))).toBe(true)
  await expect(workspaceGroups(page).first()).toHaveClass(/selected/)
  await run(page, 'echo typed-$((1+1))', 'typed-2')
})

test('columns 에서 workspace 가 넘치기 시작해도 터미널의 줄 수는 그대로다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await toggleView(launched, 'columns')
  const before = await shellSize(page)

  await newWorkspace(launched, 2)
  expect(await page.locator('.terminals').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true
  )
  await workspaceItems(page).first().click()

  expect((await shellSize(page)).rows).toBe(before.rows)
})

test('columns 에서 선택한 workspace 의 테두리는 아래 변도 스크롤 영역 안에 그려진다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await toggleView(launched, 'columns')

  // 테두리는 카드 바깥 1px 의 box-shadow 라, 스크롤 영역이 자르지 않으려면 그 1px 이 영역 안에 있어야 한다.
  const area = await page.locator('.terminals').evaluate((el) => {
    const { top, left } = el.getBoundingClientRect()
    return { bottom: top + el.clientTop + el.clientHeight, left: left + el.clientLeft }
  })
  const card = (await workspaceViews(page).first().boundingBox())!
  expect(card.y + card.height + 1).toBeLessThanOrEqual(area.bottom)
  expect(card.x - 1).toBeGreaterThanOrEqual(area.left)
})

test('columns 에서 줌을 바꿔도 칸은 80열이다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 80)

  for (const level of [0.5, 1, 1.5, 2, 2.5, 3, -0.5, -1, -1.5, -2, -2.5, -3]) {
    const before = await page.evaluate(() => devicePixelRatio)
    await setZoom(app, level)
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).not.toBe(before)
    await expectCols(page, 80)
  }
})

test('columns 에서 창 크기를 바꿔도 칸은 80열이다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  const before = await shellSize(page)

  await resizeBy(app, -200, -180)

  await expect.poll(async () => (await shellSize(page)).rows).toBeLessThan(before.rows)
  expect((await shellSize(page)).cols).toBe(80)
})
