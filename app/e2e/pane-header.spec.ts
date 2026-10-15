import type { Page } from '@playwright/test'
import {
  activeHeader,
  claudeHook,
  clickMenu,
  expect,
  newWorkspace,
  panes,
  resizeBy,
  run,
  shellSize,
  split,
  test,
  workspaceItems
} from './app'

test('칸 머리는 OSC 2 로 받은 제목을, 받기 전에는 Shell 을 보이고, 칸의 디렉토리 이름을 보인다', async ({
  launch
}) => {
  const { page } = await launch()
  await expect(activeHeader(page).locator('.title')).toHaveText('Shell')
  await expect(workspaceItems(page)).not.toHaveText('Shell')
  await expect(activeHeader(page).locator('.cwd')).toHaveText(
    await workspaceItems(page).innerText()
  )

  await page.keyboard.type("printf '\\033]2;task-%s\\007' $((1+1))\n")

  await expect(activeHeader(page).locator('.title')).toHaveText('task-2')
  await page.keyboard.type("printf '\\033]2;\\007'\n")
  await expect(activeHeader(page).locator('.title')).toHaveText('Shell')
})

test('칸 머리를 누르면 그 칸이 포커스를 받고 키가 그리로 간다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)

  await panes(page).nth(0).locator('.pane-header').click()

  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, 'echo header-$((1+1))', 'header-2')
  await panes(page).nth(1).locator('.pane-header').click()
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, 'echo again-$((1+1))', 'again-2')
})

test('waiting 인 칸 머리는 포커스가 있을 때와 없을 때 배경이 다르다', async ({ launch }) => {
  const { app, page } = await launch()
  await page.keyboard.type(claudeHook('PermissionRequest'))
  const header = panes(page).nth(0).locator('.pane-header')
  await expect(header).toHaveClass(/waiting/)
  const focused = await header.evaluate((el) => getComputedStyle(el).backgroundColor)

  await split(app, page, 'split-right', 2)

  await expect(header).not.toHaveClass(/focused/)
  expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(focused)
})

test('columns 의 workspace 머리는 칸 상태 가운데 waiting, working 순으로 하나를 보이고, 없으면 비우며, 누르면 그 workspace 를 고른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await clickMenu(app, 'toggle-view-mode')
  const headers = page.locator('.workspace-header')
  await expect(headers).toHaveCount(2)
  await expect(headers.nth(1).locator('.bar-icon')).toHaveText('')

  await page.keyboard.type(claudeHook('UserPromptSubmit', 'c-1'))
  await expect(headers.nth(1)).toHaveClass(/working/)
  await split(app, page, 'split-down', 2)
  await page.keyboard.type(claudeHook('PermissionRequest', 'c-2'))
  await expect(headers.nth(1)).toHaveClass(/waiting/)
  await expect(headers.nth(0)).not.toHaveClass(/working|waiting|idle/)
  await expect(headers.nth(0).locator('.bar-icon')).toHaveText('')
  expectOnGrid(await measure(page))

  await headers.nth(0).click()

  await expect(workspaceItems(page).nth(0)).toHaveClass(/selected/)
  await run(page, 'echo first-$((1+1))', 'first-2')
})

test('칸 머리의 아이콘 글꼴을 불러온다', async ({ launch }) => {
  const { page } = await launch()
  const status = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].find((f) => f.family.includes('Maru Symbols'))?.status
  })
  expect(status).toBe('loaded')
})

async function measure(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.panes.selected .grid')!.getBoundingClientRect()
    // 칸 경계가 맞추는 격자. DOM 의 행 높이는 행 수에 따라 반올림이 달라 1px 의 몇 % 씩 어긋난다.
    const vars = getComputedStyle(document.querySelector('.app')!)
    const cellWidth = parseFloat(vars.getPropertyValue('--cell'))
    const unit = parseFloat(vars.getPropertyValue('--row'))
    return [...document.querySelectorAll('.panes.selected .pane')].map((pane) => {
      const box = pane.getBoundingClientRect()
      const head = pane.querySelector('.pane-header')!.getBoundingClientRect()
      const row = pane.querySelector('.xterm-rows > div')!.getBoundingClientRect()
      return {
        left: box.left - grid.left,
        right: box.right - grid.left,
        top: box.top - grid.top,
        bottom: box.bottom - grid.top,
        headHeight: head.height,
        firstRow: row.top - grid.top,
        rowHeight: row.height,
        unit,
        cellWidth,
        gridWidth: grid.width,
        gridHeight: grid.height
      }
    })
  })
}

/** 레이아웃이 px 를 1/64 단위로 반올림하므로, 셀의 배수에서 벗어난 정도를 셀에 대한 비율로 본다. */
const offGrid = (px: number, cell: number): number => Math.abs(px / cell - Math.round(px / cell))

function expectOnGrid(boxes: Awaited<ReturnType<typeof measure>>) {
  for (const b of boxes) {
    expect(b.headHeight).toBeCloseTo(b.rowHeight, 1)
    expect(b.firstRow).toBeCloseTo(b.top + b.rowHeight, 1)
    expect(offGrid(b.top, b.unit)).toBeLessThan(0.01)
    expect(offGrid(b.left, b.cellWidth)).toBeLessThan(0.01)
  }
}

test('칸을 나누면 경계가 행·열 격자에 놓여 나란한 칸의 행이 이어지고, 경계선은 자리를 차지하지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-down', 3)

  const [left, topRight, bottomRight] = await measure(page)
  expectOnGrid([left, topRight, bottomRight])
  expect(topRight.left).toBeCloseTo(left.right, 1)
  expect(bottomRight.top).toBeCloseTo(topRight.bottom, 1)
  expect(topRight.right).toBeCloseTo(left.gridWidth, 1)
  expect(bottomRight.bottom).toBeCloseTo(left.gridHeight, 1)
  expect(left.bottom).toBeCloseTo(left.gridHeight, 1)
  await clickMenu(app, 'focus-pane-up')
  await expect
    .poll(async () => (await shellSize(page)).rows)
    .toBe(Math.round((topRight.bottom - topRight.top) / topRight.unit) - 1)
})

for (const level of [0.5, 1, -0.5]) {
  test(`줌 ${level} 에서 행 높이가 소수여도, 아래에 칸이 있는 칸은 머리를 뺀 높이를 행으로 채운다`, async ({
    launch
  }) => {
    const { app, page } = await launch()
    await app.evaluate(
      ({ BrowserWindow }, level) =>
        BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(level),
      level
    )
    await split(app, page, 'split-down', 2)
    await clickMenu(app, 'focus-pane-up')
    const [top] = await measure(page)
    expect(top.rowHeight % 1).not.toBe(0)
    expectOnGrid(await measure(page))
    await expect
      .poll(async () => (await shellSize(page)).rows)
      .toBe(Math.round((top.bottom - top.top) / top.unit) - 1)
  })
}

test('창 크기를 바꿔도 칸 경계는 행·열 격자에 놓인다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-down', 2)
  await clickMenu(app, 'focus-pane-up')
  await split(app, page, 'split-right', 3)
  const before = await measure(page)

  await resizeBy(app, -137, -91)

  await expect.poll(async () => (await measure(page))[0].gridWidth).not.toBe(before[0].gridWidth)
  expectOnGrid(await measure(page))
  await expect(panes(page)).toHaveCount(3)
})
