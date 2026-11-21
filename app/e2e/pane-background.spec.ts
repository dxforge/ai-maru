import type { Page } from '@playwright/test'
import {
  activePane,
  appRegionAt,
  cellGroups,
  cellItems,
  clickMenu,
  cli,
  expect,
  focusPane,
  hoverCard,
  newCell,
  paneBox,
  panes,
  resizeGridTo,
  restartWith,
  screen,
  sidebarCard,
  split,
  test,
  toast,
  typesInto
} from './app'

const paneRowsOf = (page: Page, cell: number) => cellGroups(page).nth(cell).locator('.pane-row')
const backgroundLine = (page: Page, cell: number) =>
  cellGroups(page).nth(cell).locator('.background-line')

test('background 로 돌린 pane 은 화면에서 빠져도 pty 가 돌고, 사이드바 줄을 누르면 원래 자리에 돌아와 포커스된다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-right', 3)
  await focusPane(app, page, 'focus-pane-left', 1)
  await typesInto(page, 1, 'middle')
  const middle = (await panes(page).nth(1).getAttribute('data-pty'))!

  await clickMenu(app, 'background-pane')
  await expect(panes(page).nth(1)).toHaveClass(/background/)
  await expect(panes(page).nth(1)).toBeHidden()
  const [left, right] = [await paneBox(page, 0), await paneBox(page, 2)]
  expect(right.x).toBeLessThan(left.x + left.width + 20)
  await expect(activePane(page)).toHaveCount(1)
  // DOM 포커스가 background 터미널에 남으면 이 입력이 그리로 간다.
  await page.keyboard.type('echo typed-$((2+3))\n')
  await expect(screen(page, activePane(page))).toShow('typed-5')

  await cli(dataDir, middle, ['pty', 'send', middle, 'echo while-away-$((1+1))\r'])
  const listed = await cli(dataDir, middle, ['pane', 'list'])
  const row = listed.split('\n').find((l) => l.includes(middle))!
  expect(row.split('\t').at(-1)).toBe('background')

  const rows = paneRowsOf(page, 0)
  await expect(rows).toHaveCount(3)
  await expect(backgroundLine(page, 0)).toHaveCount(1)
  const line = (await backgroundLine(page, 0).boundingBox())!
  for (const x of [line.x + 4, line.x + line.width - 4])
    expect(await appRegionAt(page, x, line.y + line.height / 2)).toBe('no-drag')
  await expect(await hoverCard(page, rows.nth(1))).toHaveCount(1)
  await backgroundLine(page, 0).hover()
  await expect(sidebarCard(page)).toBeVisible()
  await expect(sidebarCard(page).locator('.section.current')).toHaveCount(0)
  await expect(rows.nth(2)).toHaveAttribute('aria-label', /\. Background$/)
  await expect(rows.nth(1)).not.toHaveAttribute('aria-label', /\. Background$/)

  await rows.nth(2).click()
  await expect(panes(page).nth(1)).not.toHaveClass(/background/)
  await expect(backgroundLine(page, 0)).toHaveCount(0)
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await expect(screen(page, 1)).toShow('while-away-2')
  const [l, m, r] = [await paneBox(page, 0), await paneBox(page, 1), await paneBox(page, 2)]
  expect(l.x).toBeLessThan(m.x)
  expect(m.x).toBeLessThan(r.x)
})

test('꺼낼 자리가 없으면 꺼내지 않고 나누기와 같은 토스트를 띄운다', async ({ launch }) => {
  const { app, page } = await launch()
  // pane 둘은 들어가고 셋은 들어가지 않는 폭이다(panes.spec.ts 의 split 거절과 같다).
  await resizeGridTo(app, page, 58)
  await split(app, page, 'split-right', 2)
  await clickMenu(app, 'background-pane')
  await split(app, page, 'split-right', 3)

  await paneRowsOf(page, 0).nth(2).click()
  await expect(toast(page)).toContainText('No space for a new pane')
  await expect(panes(page).nth(1)).toHaveClass(/background/)
  await expect(backgroundLine(page, 0)).toHaveCount(1)
})

test('cell 의 마지막 pane 을 background 로 돌려도 cell 은 사이드바에 남고 선택은 옆 cell 로 가며, 그 줄을 누르면 다시 나온다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newCell(launched, 2)
  const pty = (await panes(page).first().getAttribute('data-pty'))!
  await typesInto(page, 0, 'last')
  await clickMenu(app, 'background-pane')

  await expect(cellItems(page)).toHaveCount(2)
  await expect(backgroundLine(page, 1)).toHaveCount(0)
  await expect(paneRowsOf(page, 1).first()).toHaveAttribute('aria-label', /\. Background$/)
  await expect(page.locator('.panes.empty')).toHaveCount(1)
  await expect(page.locator('.panes.empty')).toBeHidden()
  await expect(cellItems(page).nth(0)).toHaveClass(/focused/)
  await page.keyboard.type('echo other-$((4+4))\n')
  await expect(screen(page, activePane(page))).toShow('other-8')

  await clickMenu(app, 'next-cell')
  await expect(cellItems(page).nth(0)).toHaveClass(/focused/)

  await paneRowsOf(page, 1).first().click()
  await expect(page.locator('.panes.empty')).toHaveCount(0)
  await expect(panes(page)).toHaveCount(1)
  await expect(panes(page).first()).toHaveAttribute('data-pty', pty)
  await expect(screen(page, 0)).toShow('last-2')
})

test('background 로 둔 채 다시 띄워도 background 로 뜨고, 꺼내면 같은 pty 다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'kept')
  const pty = await panes(page).nth(1).getAttribute('data-pty')
  await clickMenu(app, 'background-pane')
  await expect(panes(page).nth(1)).toHaveClass(/background/)

  await restartWith(app)
  const { page: again } = await launch()
  await expect(panes(again)).toHaveCount(2)
  await expect(panes(again).nth(1)).toHaveClass(/background/)
  await paneRowsOf(again, 0).nth(1).click()
  await expect(panes(again).nth(1)).not.toHaveClass(/background/)
  await expect(panes(again).nth(1)).toHaveAttribute('data-pty', pty!)
  await expect(screen(again, 1)).toShow('kept-2')
})

test('background pty 가 끝나면 그 줄이 사라지고, cell 의 마지막 pane 이었으면 cell 이 닫힌다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  await split(app, page, 'split-right', 2)
  // 셸이 입력을 받기 전에 보내면 pty 를 찾지 못하거나 `exit` 가 처리되지 않으므로, 먼저 셸에 입력이 닿는 것을 본다.
  await typesInto(page, 1, 'second')
  const second = (await panes(page).nth(1).getAttribute('data-pty'))!
  await clickMenu(app, 'background-pane')
  await expect(paneRowsOf(page, 0)).toHaveCount(2)
  await cli(dataDir, second, ['pty', 'send', second, 'exit\r'])
  await expect(paneRowsOf(page, 0)).toHaveCount(1)
  await expect(panes(page)).toHaveCount(1)

  await newCell(launched, 2)
  await typesInto(page, 0, 'only')
  const only = (await panes(page).first().getAttribute('data-pty'))!
  await clickMenu(app, 'background-pane')
  await expect(page.locator('.panes.empty')).toHaveCount(1)
  await cli(dataDir, only, ['pty', 'send', only, 'exit\r'])
  await expect(cellItems(page)).toHaveCount(1)
  await expect(page.locator('.panes.empty')).toHaveCount(0)
})

test('maru pane new --background 로 띄운 pane 은 background 로 pty 가 돌고, 사이드바 줄을 누르면 나온다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(`maru pane new --background bash -c 'echo started-$((3+4)); read x'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page).nth(1)).toHaveClass(/background/)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  const rows = paneRowsOf(page, 0)
  await expect(rows.nth(1)).toHaveAttribute('aria-label', /\. Background$/)
  await rows.nth(1).click()
  await expect(panes(page).nth(1)).not.toHaveClass(/background/)
  await expect(screen(page, 1)).toShow('started-7')
})

test('maru pane background 로 떠 있는 pane 을 돌리고, ⌘P 전환기에서 그 pane 을 고르면 꺼낸다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'sent')
  const pty = (await panes(page).nth(1).getAttribute('data-pty'))!
  const listed = await cli(dataDir, pty, ['pane', 'list'])
  const id = listed
    .split('\n')
    .find((l) => l.includes(pty))!
    .split('\t')[0]
  expect(await cli(dataDir, pty, ['pane', 'background', id])).toBe('')
  await expect(panes(page).nth(1)).toHaveClass(/background/)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await cli(dataDir, pty, ['pane', 'background', id])
  await expect(panes(page).nth(1)).toHaveClass(/background/)

  await clickMenu(app, 'go-to-pane')
  const items = page.locator('.palette.switcher .pane-item')
  await expect(items).toHaveCount(2)
  await items.nth(1).click()
  await expect(panes(page).nth(1)).not.toHaveClass(/background/)
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await expect(screen(page, 1)).toShow('sent-2')
})

test('background 로 띄운 pane 은 보이는 pane 을 나눠도 터미널 크기가 바뀌지 않는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await typesInto(page, 0, 'first')
  const shown = (await panes(page).first().getAttribute('data-pty'))!
  const opened = await cli(dataDir, shown, ['pane', 'new', '--background'])
  const pty = opened.trim().split('\n')[1].split('\t')[1]
  let n = 0
  const sizeOf = async (): Promise<string> => {
    const re = new RegExp(`size${++n}=(\\d+x\\d+)`)
    await cli(dataDir, pty, ['pty', 'send', pty, `echo size${n}=$(stty size | tr ' ' x)\r`])
    let found: string | undefined
    await expect
      .poll(async () => (found = (await cli(dataDir, pty, ['pty', 'read', pty])).match(re)?.[1]))
      .toBeTruthy()
    return found!
  }
  const before = await sizeOf()
  await split(app, page, 'split-right', 3)
  await split(app, page, 'split-right', 4)
  expect(await sizeOf()).toBe(before)
})
