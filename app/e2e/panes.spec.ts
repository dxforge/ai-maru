import type { ElectronApplication, Page } from '@playwright/test'
import {
  activeTerminal,
  clickMenu,
  expect,
  panes,
  pressNew,
  resizeBy,
  run,
  shellSize,
  slowSessionBin,
  sockets,
  test,
  workspaceItems,
  zshHome
} from './app'

async function split(
  app: ElectronApplication,
  page: Page,
  id: 'split-right' | 'split-down',
  count: number
): Promise<void> {
  await clickMenu(app, id)
  await expect(panes(page)).toHaveCount(count)
  await activeTerminal(page)
}

async function box(page: Page, i: number) {
  return (await panes(page).nth(i).boundingBox())!
}

async function typesInto(page: Page, i: number, marker: string): Promise<void> {
  await expect(panes(page).nth(i).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, `echo ${marker}-$((1+1))`, `${marker}-2`)
}

test('⌘D 는 포커스가 있는 칸을 오른쪽으로 나눠 새 셸을 띄우고, 새 칸이 키를 받는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const full = await shellSize(page)
  await page.keyboard.type('X=left-$((1+1))\n')

  await split(app, page, 'split-right', 2)

  const [left, right] = [await box(page, 0), await box(page, 1)]
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
  await expect(workspaceItems(page)).toHaveCount(1)
})

test('⇧⌘D 는 아래로 나눈다', async ({ launch }) => {
  const { app, page } = await launch()
  const full = await shellSize(page)

  await split(app, page, 'split-down', 2)

  const [top, bottom] = [await box(page, 0), await box(page, 1)]
  expect(bottom.y).toBeGreaterThan(top.y + top.height - 1)
  expect(bottom.x).toBe(top.x)
  expect(bottom.width).toBe(top.width)
  await typesInto(page, 1, 'bottom')
  const half = await shellSize(page)
  expect(half.cols).toBe(full.cols)
  expect(half.rows).toBeLessThan(full.rows / 2 + 1)
  expect(half.rows).toBeGreaterThan(full.rows / 2 - 3)
})

test('⌘⌥방향키는 그 방향의 칸으로 포커스를 옮기고, 그 방향에 칸이 없으면 그대로 둔다', async ({
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

test('칸을 누르면 그 칸이 포커스를 받는다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await panes(page).nth(0).click()
  await typesInto(page, 0, 'clicked-left')
  await panes(page).nth(1).click()
  await typesInto(page, 1, 'clicked-right')
})

test('⌘W 는 포커스가 있는 칸의 세션을 끝내고 닫으며, 형제 칸이 자리와 포커스를 받는다', async ({
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
  await expect(workspaceItems(page)).toHaveCount(1)
})

test('마지막 칸을 ⌘W 로 닫으면 workspace 도 닫고 세션을 끝낸다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await page.keyboard.type('X=first-$((1+1))\n')
  await pressNew(app)
  await expect(workspaceItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await run(page, 'echo second-$((1+1))', 'second-2')

  await clickMenu(app, 'close-pane')

  await expect(workspaceItems(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  await run(page, 'echo "x=$X"', 'x=first-2')

  await clickMenu(app, 'close-pane')
  await expect(workspaceItems(page)).toHaveCount(0)
  await expect(page.locator('.terminal-view')).toHaveCount(0)
  await expect.poll(() => sockets(dataDir)).toHaveLength(0)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})

test('셸이 뜨기 전에 ⌘W 로 닫아도 그 세션은 뜬 뒤에 끝난다', async ({ launch, dataDir }) => {
  const { app, page } = await launch({ MARU_SESSION_BIN: slowSessionBin(dataDir) })
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)

  await clickMenu(app, 'close-pane')

  await expect(panes(page)).toHaveCount(1)
  // 띄우던 세션이 소켓을 연 뒤에 끝나야 하므로 그 시간이 지나도록 본다.
  await page.waitForTimeout(2500)
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await typesInto(page, 0, 'remaining')
})

test('포커스가 없는 칸의 셸이 끝나면 그 칸만 닫고, 포커스와 입력은 그대로다', async ({
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

test('zsh 에서 새 칸은 포커스가 있던 칸의 디렉토리에서 시작하고, 이름과 ⌘N 은 포커스가 있는 칸을 따른다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'proj', 'other')
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect(workspaceItems(page)).toHaveText(['proj'])

  await split(app, page, 'split-down', 2)
  await run(page, '[ "$PWD" = "$HOME/proj" ] && echo in-proj-$((1+1))', 'in-proj-2')
  await page.keyboard.type('cd ~/other\n')
  await expect(workspaceItems(page)).toHaveText(['other'])

  await clickMenu(app, 'focus-pane-up')
  await expect(workspaceItems(page)).toHaveText(['proj'])
  await panes(page).nth(1).click()
  await expect(workspaceItems(page)).toHaveText(['other'])

  await pressNew(app)
  await expect(workspaceItems(page)).toHaveText(['other', 'other'])
  await activeTerminal(page)
  await run(page, '[ "$PWD" = "$HOME/other" ] && echo in-other-$((1+1))', 'in-other-2')
})

test('새로 고치면 칸 배치는 되살리지 않고 칸마다 workspace 하나로 되살린다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await run(page, 'X=a-$((1+1)); echo set-a', 'set-a')
  await split(app, page, 'split-right', 2)
  await run(page, 'X=b-$((2+2)); echo set-b', 'set-b')

  await page.reload()
  await activeTerminal(page)

  await expect(workspaceItems(page)).toHaveCount(2)
  await expect(panes(page)).toHaveCount(1)
  expect(sockets(dataDir)).toHaveLength(2)
  await run(page, 'echo "x=$X"', 'x=b-4')
  await workspaceItems(page).first().click()
  await run(page, 'echo "x=$X"', 'x=a-2')
})

test('셸이 뜨는 중에 ⌘W 로 닫고 바로 새로 고쳐도 닫은 칸의 세션은 되살아나지 않는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch({ MARU_SESSION_BIN: slowSessionBin(dataDir) })
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)
  await clickMenu(app, 'close-pane')
  await expect(panes(page)).toHaveCount(1)

  await page.reload()
  await activeTerminal(page)

  await page.waitForTimeout(2500)
  await expect(workspaceItems(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
})

test('포커스가 있는 칸의 셸이 끝나면 형제 칸이 포커스를 받는다', async ({ launch, dataDir }) => {
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

test('다른 workspace 에 갔다 와도 포커스가 있던 칸이 키를 받는다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await clickMenu(app, 'focus-pane-left')
  await typesInto(page, 0, 'before')
  await pressNew(app)
  await expect(workspaceItems(page)).toHaveCount(2)
  await activeTerminal(page)

  await workspaceItems(page).first().click()

  await typesInto(page, 0, 'back')
})

test('보이지 않는 workspace 에서 포커스가 있던 칸의 셸이 끝나면, 돌아왔을 때 형제 칸이 키를 받는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'right')
  await page.keyboard.type('sleep 1; exit\n')
  await pressNew(app)
  await expect(workspaceItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await page.waitForTimeout(1500)

  await workspaceItems(page).first().click()

  await expect(panes(page)).toHaveCount(1)
  await typesInto(page, 0, 'left')
})

test('새로 고쳐 되살린 칸도 ⌘W 로 닫으면 세션이 끝난다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'right')
  await page.reload()
  await activeTerminal(page)
  await expect(workspaceItems(page)).toHaveCount(2)

  await clickMenu(app, 'close-pane')

  await expect(workspaceItems(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
})

test('나눈 칸들은 창 크기를 따라 셸이 보는 크기가 바뀐다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'ready')
  const right = await shellSize(page)
  await clickMenu(app, 'focus-pane-left')
  const left = await shellSize(page)

  await resizeBy(app, 200, 100)

  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(left.cols)
  expect((await shellSize(page)).rows).toBeGreaterThan(left.rows)
  await clickMenu(app, 'focus-pane-right')
  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(right.cols)
})

test('팔레트가 열린 채 ⌘W 를 누르면 칸이 닫히고 키는 남은 칸으로 간다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'right')
  await clickMenu(app, 'command-palette')
  await expect(page.locator('.palette .query')).toBeFocused()

  await clickMenu(app, 'close-pane')

  await expect(page.locator('.palette')).toHaveCount(0)
  await expect(panes(page)).toHaveCount(1)
  await typesInto(page, 0, 'left')
})
