import type { Page } from '@playwright/test'
import {
  activeTerminal,
  cellSize,
  cellViews,
  clickMenu,
  delayPtyPort,
  expect,
  expectCols,
  focusPane,
  openPalette,
  paneBox,
  panes,
  pressNew,
  putCanvas,
  resizeBy,
  resizeGridTo,
  run,
  shellSize,
  slowPtyBin,
  sockets,
  split,
  test,
  toast,
  toggleView,
  typesInto,
  cellItems,
  cellPlaces,
  paneRowPlaces,
  zshHome
} from './app'

test('⌘D 는 포커스가 있는 pane 을 오른쪽으로 나눠 새 셸을 띄우고, 새 pane 이 키를 받는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const full = await shellSize(page)
  await page.keyboard.type('X=left-$((1+1))\n')

  await split(app, page, 'split-right', 2)

  const [left, right] = [await paneBox(page, 0), await paneBox(page, 1)]
  expect(right.x).toBeGreaterThan(left.x + left.width - 1)
  expect(right.y).toBe(left.y)
  expect(right.height).toBe(left.height)
  await typesInto(page, 1, 'right')
  await run(page, 'echo "x=$X"', 'x=')
  const half = await shellSize(page)
  expect(half.rows).toBe(full.rows)
  expect(half.cols).toBeLessThan(full.cols / 2 + 1)
  expect(half.cols).toBeGreaterThan(full.cols / 2 - 3)
  expect(sockets(dataDir)).toHaveLength(2)
  await expect(cellItems(page)).toHaveCount(1)
})

test('⇧⌘D 는 아래로 나눈다', async ({ launch }) => {
  const { app, page } = await launch()
  const full = await shellSize(page)

  await split(app, page, 'split-down', 2)

  const [top, bottom] = [await paneBox(page, 0), await paneBox(page, 1)]
  expect(bottom.y).toBeGreaterThan(top.y + top.height - 1)
  expect(bottom.x).toBe(top.x)
  expect(bottom.width).toBe(top.width)
  await typesInto(page, 1, 'bottom')
  const half = await shellSize(page)
  expect(half.cols).toBe(full.cols)
  expect(half.rows).toBeLessThan(full.rows / 2 + 1)
  expect(half.rows).toBeGreaterThan(full.rows / 2 - 3)
})

/**
 * 선택한 cell 에 한 줄로 늘어선 pane 들이 `length` 를 고르게 나눠 갖는지. `snapRects` 가 경계를 `unit`(글자 칸 크기나
 * columns 보기의 pane 폭)의 배수에 두고 cell 끝의 자투리를 마지막 pane 에 주므로, pane 끼리의 크기 차이는 `unit` 하나에
 * 자투리를 더한 값까지다.
 */
async function expectEven(page: Page, length: 'width' | 'height', unit: number): Promise<void> {
  await expect
    .poll(async () => {
      const sizes = await panes(page).evaluateAll(
        (ps, l) => ps.map((p) => p.getBoundingClientRect()[l]),
        length
      )
      const total = sizes.reduce((a, b) => a + b, 0)
      const rest = total - Math.floor(total / unit + 1e-6) * unit
      const spread = Math.max(...sizes) - Math.min(...sizes)
      return spread <= unit + rest + 0.5 ? 'even' : sizes.join(', ')
    })
    .toBe('even')
}

test('single 에서 maru pane new --full --down 으로 늘어선 pane 들의 높이가 같고, 하나를 닫으면 남은 pane 들의 높이가 같다', async ({
  launch
}) => {
  const { page } = await launch()
  for (const [name, count] of [
    ['A', 2],
    ['B', 3],
    ['C', 4]
  ] as const) {
    await page.keyboard.type(`${name}=$(maru pane new --full --down bash -c 'read x')\n`)
    await expect(panes(page)).toHaveCount(count)
  }
  const row = (await cellSize(page)).height
  await expectEven(page, 'height', row)

  await run(page, 'maru pane close "$A"; echo closed-$?', 'closed-0')
  await expect(panes(page)).toHaveCount(3)
  await expectEven(page, 'height', row)
})

test('single 에서 ⌘D 로 새 pane 을 다시 나누면 좌우로 늘어선 세 pane 의 폭이 같다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-right', 3)
  await expectEven(page, 'width', (await cellSize(page)).width)
})

test('single 에서 ⇧⌘D 로 새 pane 을 다시 나누면 위아래로 늘어선 세 pane 의 높이가 같다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-down', 2)
  await split(app, page, 'split-down', 3)
  await expectEven(page, 'height', (await cellSize(page)).height)
})

test('columns 에서 ⇧⌘D 로 새 pane 을 다시 나누면 세 pane 의 높이가 같고 cell 폭은 그대로다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  const width = (await cellViews(page).first().boundingBox())!.width
  await split(app, page, 'split-down', 2)
  await split(app, page, 'split-down', 3)
  await expectEven(page, 'height', (await cellSize(page)).height)
  expect((await cellViews(page).first().boundingBox())!.width).toBe(width)
})

test('⌘⌥방향키는 그 방향의 pane 으로 포커스를 옮기고, 그 방향에 pane 이 없으면 그대로 둔다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-down', 3)
  await typesInto(page, 2, 'start')

  await clickMenu(app, 'focus-pane-up')
  await typesInto(page, 1, 'up')
  await clickMenu(app, 'focus-pane-up')
  await typesInto(page, 1, 'still-up')
  await clickMenu(app, 'focus-pane-left')
  await typesInto(page, 0, 'left')
  await clickMenu(app, 'focus-pane-left')
  await typesInto(page, 0, 'still-left')
  await clickMenu(app, 'focus-pane-right')
  await typesInto(page, 1, 'right')
  await clickMenu(app, 'focus-pane-down')
  await typesInto(page, 2, 'down')
})

test('터미널에서 ⇧⌘방향키도 그 방향의 pane 으로 포커스를 옮긴다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-down', 3)
  await typesInto(page, 2, 'start')

  await page.keyboard.press('Shift+Meta+ArrowUp')
  await typesInto(page, 1, 'up')
  await page.keyboard.press('Shift+Meta+ArrowLeft')
  await typesInto(page, 0, 'left')
  await page.keyboard.press('Shift+Meta+ArrowRight')
  await typesInto(page, 1, 'right')
  await page.keyboard.press('Shift+Meta+ArrowDown')
  await typesInto(page, 2, 'down')
})

test('pane 이 하나면 ⇧⌘방향키는 포커스를 그대로 두고 셸에 아무것도 보내지 않는다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type('echo edge-$((1+')
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
    await page.keyboard.press(`Shift+Meta+${key}`)
  await run(page, '1))', 'edge-2')
})

test('포커스가 터미널 밖에 있어도 ⇧⌘방향키는 pane 을 옮긴다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'x', title: 'A' })
  await page.locator('.canvas .list button').first().focus()
  await page.keyboard.press('Shift+Meta+ArrowLeft')
  await typesInto(page, 0, 'left')
})

test('pane 을 누르면 그 pane 이 포커스를 받는다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await panes(page).nth(0).click()
  await typesInto(page, 0, 'clicked-left')
  await panes(page).nth(1).click()
  await typesInto(page, 1, 'clicked-right')
})

test('⌘W 는 포커스가 있는 pane 의 pty 를 끝내고 닫으며, 형제 pane 이 자리와 포커스를 받는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const full = await shellSize(page)
  await page.keyboard.type('X=kept-$((1+1))\n')
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'closing')
  expect(sockets(dataDir)).toHaveLength(2)

  await clickMenu(app, 'close-pane')

  await expect(panes(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  await typesInto(page, 0, 'sibling')
  await run(page, 'echo "x=$X"', 'x=kept-2')
  expect(await shellSize(page)).toEqual(full)
  await expect(cellItems(page)).toHaveCount(1)
})

test('마지막 pane 을 ⌘W 로 닫으면 cell 도 닫고 pty 를 끝낸다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await page.keyboard.type('X=first-$((1+1))\n')
  await pressNew(app)
  await expect(cellItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await run(page, 'echo second-$((1+1))', 'second-2')

  await clickMenu(app, 'close-pane')

  await expect(cellItems(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  await run(page, 'echo "x=$X"', 'x=first-2')

  await clickMenu(app, 'close-pane')
  await expect(cellItems(page)).toHaveCount(0)
  await expect(page.locator('.terminal-view')).toHaveCount(0)
  await expect.poll(() => sockets(dataDir)).toHaveLength(0)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})

test('셸이 뜨기 전에 ⌘W 로 닫아도 그 pty 는 뜬 뒤에 끝난다', async ({ launch, dataDir }) => {
  const { app, page } = await launch({ MARU_PTY_BIN: slowPtyBin(dataDir) })
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)

  await clickMenu(app, 'close-pane')

  await expect(panes(page)).toHaveCount(1)
  // 띄우던 pty 가 소켓을 연 뒤에 끝나야 하므로 그 시간이 지나도록 본다.
  await page.waitForTimeout(2500)
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await typesInto(page, 0, 'remaining')
})

test('pty 에 붙기 전에 ⌘W 로 닫아도 그 pty 는 끝난다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await delayPtyPort(app, 1500)
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)

  await clickMenu(app, 'close-pane')

  await expect(panes(page)).toHaveCount(1)
  await page.waitForTimeout(2500)
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await typesInto(page, 0, 'remaining')
})

test('포커스가 없는 pane 의 셸이 끝나면 그 pane 만 닫고, 포커스와 입력은 그대로다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await page.keyboard.type('sleep 1; exit\n')
  await split(app, page, 'split-right', 2)
  await page.keyboard.type('X=right-$((1+1))\n')

  await expect(panes(page)).toHaveCount(1, { timeout: 10_000 })
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  await typesInto(page, 0, 'after')
  await run(page, 'echo "x=$X"', 'x=right-2')
})

test('zsh 에서 새 pane 은 포커스가 있던 pane 의 디렉토리에서 시작하고, 사이드바는 pane 마다 위치를 보이며, ⌘N 은 포커스가 있는 pane 을 따른다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'proj', 'other')
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect(cellPlaces(page)).toHaveText(['proj'])

  await split(app, page, 'split-down', 2)
  await run(page, '[ "$PWD" = "$HOME/proj" ] && echo in-proj-$((1+1))', 'in-proj-2')
  await page.keyboard.type('cd ~/other\n')
  const places = paneRowPlaces(page)
  await expect(places).toHaveText(['proj', 'other'])

  await clickMenu(app, 'focus-pane-up')
  await expect(places).toHaveText(['proj', 'other'])
  await panes(page).nth(1).click()

  await pressNew(app)
  await expect(places).toHaveText(['proj', 'other', 'other'])
  await activeTerminal(page)
  await run(page, '[ "$PWD" = "$HOME/other" ] && echo in-other-$((1+1))', 'in-other-2')
})

test('포커스가 있는 pane 의 셸이 끝나면 형제 pane 이 포커스를 받는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await page.keyboard.type('X=left-$((1+1))\n')
  await split(app, page, 'split-down', 2)
  await typesInto(page, 1, 'bottom')

  await page.keyboard.type('exit\n')

  await expect(panes(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  await typesInto(page, 0, 'top')
  await run(page, 'echo "x=$X"', 'x=left-2')
})

test('다른 cell 에 갔다 와도 포커스가 있던 pane 이 키를 받는다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await clickMenu(app, 'focus-pane-left')
  await typesInto(page, 0, 'before')
  await pressNew(app)
  await expect(cellItems(page)).toHaveCount(2)
  await activeTerminal(page)

  await cellItems(page).first().click()

  await typesInto(page, 0, 'back')
})

test('보이지 않는 cell 에서 포커스가 있던 pane 의 셸이 끝나면, 돌아왔을 때 형제 pane 이 키를 받는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'right')
  await page.keyboard.type('sleep 1; exit\n')
  await pressNew(app)
  await expect(cellItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await page.waitForTimeout(1500)

  await cellItems(page).first().click()

  await expect(panes(page)).toHaveCount(1)
  await typesInto(page, 0, 'left')
})

test('나눈 pane 들은 창 크기를 따라 셸이 보는 크기가 바뀐다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'ready')
  const right = await shellSize(page)
  await focusPane(app, page, 'focus-pane-left', 0)
  const left = await shellSize(page)

  await resizeBy(app, 200, 100)

  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(left.cols)
  expect((await shellSize(page)).rows).toBeGreaterThan(left.rows)
  await clickMenu(app, 'focus-pane-right')
  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(right.cols)
})

test('팔레트가 열린 채 ⌘W 를 누르면 pane 이 닫히고 키는 남은 pane 으로 간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'right')
  await openPalette({ app, page })

  await clickMenu(app, 'close-pane')

  await expect(page.locator('.palette')).toHaveCount(0)
  await expect(panes(page)).toHaveCount(1)
  await typesInto(page, 0, 'left')
})

test('나눈 두 쪽에 20열이 들어가지 않으면 split 을 거절하고 토스트를 띄운다', async ({
  launch
}) => {
  const { app, page } = await launch()
  // 하한 두 개(글자 칸 46개)는 들어가고 세 개(글자 칸 69개)는 들어가지 않는 폭이다.
  await resizeGridTo(app, page, 58)
  await split(app, page, 'split-right', 2)
  await expect(toast(page)).toHaveCount(0)
  const before = await shellSize(page)

  await clickMenu(app, 'split-right')

  await expect(toast(page)).toHaveClass(/warning/)
  await expect(toast(page)).toContainText('No space for a new pane')
  await expect(toast(page)).toContainText('at least 20 columns and 5 rows')
  await expect(panes(page)).toHaveCount(2)
  expect(await shellSize(page)).toEqual(before)

  await resizeGridTo(app, page, 80)
  await split(app, page, 'split-right', 3)
  await expect(toast(page)).toHaveCount(0)
})

test('columns 에서 높이가 모자라면 아래로 나누기를 거절한다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await split(app, page, 'split-down', 2)
  const cell = await cellSize(page)
  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  // 하한 두 개(헤더 포함 12행)는 들어가고 세 개(18행)는 들어가지 않는 높이다.
  await resizeBy(app, 0, Math.round(15 * cell.height - grid.height))
  // 앱은 창 크기가 바뀐 뒤 렌더링 단계의 `ResizeObserver` 에서 grid 를 다시 재고, 그 값으로 나누기를 판정한다.
  // 프레임이 늦어 그 전에 메뉴를 누르면 옛 높이로 나누기를 받아들이므로, pane 들이 줄어든 grid 안에 다시 놓인 뒤에 누른다.
  await expect
    .poll(async () => {
      const shrunk = (await page.locator('.panes.selected .grid').boundingBox())!
      const bottom = await paneBox(page, 1)
      return shrunk.height < grid.height && bottom.y + bottom.height <= shrunk.y + shrunk.height + 1
    })
    .toBe(true)

  await clickMenu(app, 'split-down')

  await expect(toast(page)).toContainText('No space for a new pane')
  await expect(panes(page)).toHaveCount(2)
})

test('창이 좁아져도 pane 은 20열 아래로 내려가지 않고, 들어가지 않는 pane 은 cell 밖으로 나간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)

  await resizeBy(app, -600, 0)

  await expectCols(page, 20)
  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  const [left, right] = [await paneBox(page, 0), await paneBox(page, 1)]
  expect(right.x).toBe(left.x + left.width)
  expect(right.width).toBe(left.width)
  expect(right.x + right.width).toBeGreaterThan(grid.x + grid.width)
  await clickMenu(app, 'focus-pane-left')
  await expectCols(page, 20)

  // 넘친 cell 에서도 밖으로 나가는 길이가 늘지 않는 split 은 거절하지 않는다(docs/architecture.md 의 "pane 경계와 글자 칸 격자").
  await clickMenu(app, 'split-right')
  await expect(toast(page)).toContainText('No space for a new pane')
  await expect(panes(page)).toHaveCount(2)
  await split(app, page, 'split-down', 3)
  await expect(toast(page)).toHaveCount(0)
})

test('창이 낮아져도 pane 은 헤더를 뺀 5행 아래로 내려가지 않는다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-down', 2)

  await resizeBy(app, 0, -500)

  await expect.poll(async () => (await shellSize(page)).rows).toBe(5)
  await clickMenu(app, 'focus-pane-up')
  await expect.poll(async () => (await shellSize(page)).rows).toBe(5)
})

test('글꼴을 키워 pane 들이 들어가지 않게 돼도 pane 은 5행에서 멈추고 아래 pane 이 cell 밖으로 나간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-down', 2)
  await resizeBy(app, 0, -350)
  await expect.poll(async () => (await shellSize(page)).rows).toBeGreaterThan(5)

  // 글꼴 크기의 상한(32)까지 키운다.
  for (let i = 0; i < 18; i++) await clickMenu(app, 'increase-font-size')

  await expect.poll(async () => (await shellSize(page)).rows).toBe(5)
  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  const [top, bottom] = [await paneBox(page, 0), await paneBox(page, 1)]
  expect(bottom.y).toBe(top.y + top.height)
  expect(bottom.y + bottom.height).toBeGreaterThan(grid.y + grid.height)
  await clickMenu(app, 'focus-pane-up')
  await expect.poll(async () => (await shellSize(page)).rows).toBe(5)
})

test('columns 에서는 창이 좁아도 좌우로 나눌 수 있다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await resizeBy(app, -600, 0)

  await split(app, page, 'split-right', 2)

  await expectCols(page, 80)
  await expect(toast(page)).toHaveCount(0)
})
