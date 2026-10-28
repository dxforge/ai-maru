import type { ElectronApplication, Page } from '@playwright/test'
import {
  cellGroups,
  cellSize,
  cellViews,
  clickMenu,
  expect,
  expectCols,
  focusPane,
  newWorkspace,
  panes,
  resizeBy,
  run,
  shellSize,
  split,
  test,
  toggleView,
  typesInto
} from './app'

async function measure(app: ElectronApplication) {
  return (await app.firstWindow()).evaluate(() => {
    const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect()
    const rows = document.querySelector('.xterm-rows')!.children.length
    const headers = ['.pane-header', '.cell-header'].map(
      (s) => document.querySelector(s)!.getBoundingClientRect().height
    )
    return {
      winWidth: innerWidth,
      winHeight: innerHeight,
      headersHeight: headers[0] + headers[1],
      width: screen.width,
      height: screen.height,
      rows,
      cellHeight: screen.height / rows
    }
  })
}

function expectFilled(m: Awaited<ReturnType<typeof measure>>) {
  expect(m.width).toBeLessThanOrEqual(m.winWidth)
  expect(m.height).toBeLessThanOrEqual(m.winHeight)
  expect(m.winHeight - m.headersHeight - m.height).toBeLessThan(m.cellHeight)
}

test('창을 열면 터미널이 창의 높이를 줄 단위로 채운다', async ({ launch }) => {
  const { app } = await launch()
  expectFilled(await measure(app))
})

for (const [label, dw, dh] of [
  ['키우면', 200, 180],
  ['줄이면', -200, -180]
] as const) {
  test(`창을 ${label} 터미널이 같은 만큼 따라간다`, async ({ launch }) => {
    const { app } = await launch()
    if (dw > 0) {
      // 화면이 작은 머신에서는 처음 크기에서 더 키울 수 없다.
      const opened = await measure(app)
      await resizeBy(app, -dw, -dh)
      await expect.poll(async () => (await measure(app)).rows).not.toBe(opened.rows)
    }
    const before = await measure(app)
    await resizeBy(app, dw, dh)
    await expect.poll(async () => (await measure(app)).rows).not.toBe(before.rows)
    const after = await measure(app)

    expect(after.winWidth).toBe(before.winWidth + dw)
    expectFilled(after)
    // 열 수의 증감은 창 너비의 증감과 한 글자 칸 안쪽으로 맞아야 한다 — 글자 칸 너비는 글자 칸 높이보다 작다.
    expect(Math.abs(after.width - before.width - dw)).toBeLessThan(after.cellHeight)
  })
}

const gridWidth = (page: Page): Promise<number> =>
  page.locator('.panes.selected .grid').evaluate((el) => el.getBoundingClientRect().width)

test('터미널 영역이 720px 일 때 위아래로 나눈 두 pane 은 같은 열 수이고, 여백 4px 와 스크롤바 8px 를 뺀 폭에 들어가는 수다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await resizeBy(app, 720 - (await gridWidth(page)), 0)
  await expect.poll(() => gridWidth(page)).toBe(720)
  const { width } = await cellSize(page)
  const cols = Math.floor((720 - 12) / width)
  await expectCols(page, cols)

  await split(app, page, 'split-down', 2)
  await expectCols(page, cols)
  await clickMenu(app, 'focus-pane-up')
  await expect(panes(page).first().locator('.terminal-view')).toHaveClass(/active/)
  expect((await shellSize(page)).cols).toBe(cols)
})

for (const mode of ['single', 'columns'] as const) {
  test(`${mode} 에서 터미널은 pane 왼쪽 끝에서 4px 떨어져 시작하고, 여백은 터미널 요소 밖에 있다`, async ({
    launch
  }) => {
    const launched = await launch()
    const { page } = launched
    if (mode === 'columns') {
      await toggleView(launched, 'columns')
      await expectCols(page, 80)
    } else await shellSize(page)

    const place = await panes(page)
      .first()
      .evaluate((pane) => ({
        gap:
          pane.querySelector('.xterm-screen')!.getBoundingClientRect().left -
          pane.getBoundingClientRect().left,
        padding: getComputedStyle(pane.querySelector('.xterm')!).paddingLeft
      }))
    expect(place.gap).toBeCloseTo(4, 1)
    expect(place.padding).toBe('0px')
  })
}

function blankSpots(page: Page, i: number) {
  return panes(page)
    .nth(i)
    .evaluate((pane) => {
      const box = pane.getBoundingClientRect()
      const screen = pane.querySelector('.xterm-screen')!.getBoundingClientRect()
      const body = pane.querySelector('.body')!.getBoundingClientRect()
      return {
        gap: { x: box.left + 2, y: screen.top + screen.height / 2 },
        below: { x: screen.left + screen.width / 2, y: (screen.bottom + body.bottom) / 2 },
        belowHeight: body.bottom - screen.bottom
      }
    })
}

test('pane 의 왼쪽 여백이나 터미널 아래에 남는 자리를 눌러도 그 pane 의 터미널이 키를 받는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  // 터미널 아래에 반 행이 남게 영역 높이를 맞춘다.
  const { height: row } = await cellSize(page)
  const grid = () =>
    page.locator('.panes.selected .grid').evaluate((el) => el.getBoundingClientRect().height)
  const before = await grid()
  await resizeBy(app, 0, Math.round((Math.floor(before / row) + 0.5) * row - before))
  await expect.poll(async () => (await blankSpots(page, 1)).belowHeight).toBeGreaterThan(row / 4)

  await focusPane(app, page, 'focus-pane-left', 0)
  const spots = await blankSpots(page, 1)
  await page.mouse.click(spots.gap.x, spots.gap.y)
  await typesInto(page, 1, 'gap')

  await focusPane(app, page, 'focus-pane-left', 0)
  await page.mouse.click(spots.below.x, spots.below.y)
  await typesInto(page, 1, 'below')
})

test('columns 에서 다른 cell 의 pane 왼쪽 여백을 누르면 그 cell 을 선택하고 키가 그리로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'X=a-$((1+1)); echo set-$((1+2))', 'set-3')
  await newWorkspace(launched, 2)
  await toggleView(launched, 'columns')
  await expectCols(page, 80)
  // 둘째 cell 이 포커스를 받아 그리로 스크롤되어 있어, 첫 cell 이 보이게 되돌린다.
  await page.locator('.terminals').evaluate((el) => (el.scrollLeft = 0))
  await expect.poll(() => page.locator('.terminals').evaluate((el) => el.scrollLeft)).toBe(0)

  const gap = await cellViews(page)
    .nth(0)
    .locator('.pane')
    .evaluate((pane) => {
      const box = pane.getBoundingClientRect()
      return { x: box.left + 2, y: box.top + box.height / 2 }
    })
  await page.mouse.click(gap.x, gap.y)

  await expect(cellGroups(page).first()).toHaveClass(/selected/)
  await run(page, 'echo "x=$X"', 'x=a-2')
})
