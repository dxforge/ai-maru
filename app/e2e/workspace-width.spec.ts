import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeTerminal,
  clickMenu,
  expect,
  expectCols,
  newWorkspace,
  restartWith,
  run,
  shellSize,
  split,
  test,
  toggleView,
  typesInto,
  workspaceWidth
} from './app'

test('columns 에서 Widen Workspace 는 pane 을 80→110→144 열로, Narrow Workspace 는 144→110→80 열로 옮기고 끝에서는 그대로다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 80)
  const narrow = await workspaceWidth(page)

  await clickMenu(app, 'widen-workspace')
  await expectCols(page, 110)
  expect(await workspaceWidth(page)).toBeGreaterThan(narrow)
  await clickMenu(app, 'widen-workspace')
  await expectCols(page, 144)
  await clickMenu(app, 'widen-workspace')
  await expectCols(page, 144)

  await clickMenu(app, 'narrow-workspace')
  await expectCols(page, 110)
  await clickMenu(app, 'narrow-workspace')
  await expectCols(page, 80)
  expect(await workspaceWidth(page)).toBe(narrow)
  await clickMenu(app, 'narrow-workspace')
  await expectCols(page, 80)
})

test('넓힌 workspace 를 나누면 두 pane 모두 그 폭이고, 위아래로 나눈 pane 은 아래 두 pane 의 폭을 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await clickMenu(app, 'widen-workspace')
  await expectCols(page, 110)

  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'right')
  await expectCols(page, 110)
  await clickMenu(app, 'focus-pane-left')
  await typesInto(page, 0, 'left')
  await expectCols(page, 110)

  await clickMenu(app, 'focus-pane-right')
  await split(app, page, 'split-down', 3)
  await split(app, page, 'split-right', 4)
  await typesInto(page, 3, 'd')
  await expectCols(page, 110)
  await clickMenu(app, 'focus-pane-left')
  await typesInto(page, 2, 'c')
  await expectCols(page, 110)
  await clickMenu(app, 'focus-pane-up')
  await typesInto(page, 1, 'b')
  const wide = (await shellSize(page)).cols
  expect(wide).toBeGreaterThanOrEqual(220)
  expect(wide).toBeLessThan(240)
})

test('single 에서는 아무것도 하지 않고 셸에도 가지 않으며, columns 로 돌아와도 80 이다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await activeTerminal(page)
  const full = (await shellSize(page)).cols

  await clickMenu(app, 'widen-workspace')
  await page.keyboard.type('echo pass-$((1+1))')
  await page.keyboard.press('Shift+Meta+Period')
  await run(page, '$((2+2))', 'pass-24')
  expect((await shellSize(page)).cols).toBe(full)

  await toggleView(launched, 'columns')
  await expectCols(page, 80)
})

test('선택한 workspace 만 넓어지고 새 workspace 는 80 이다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await clickMenu(app, 'widen-workspace')
  await expectCols(page, 110)

  await newWorkspace(launched, 2)
  await expectCols(page, 80)
  await clickMenu(app, 'previous-workspace')
  await activeTerminal(page)
  await expectCols(page, 110)
  await expect.poll(() => workspaceWidth(page, 1)).toBeLessThan(await workspaceWidth(page, 0))
})

test('재시작 뒤 workspace 의 pane 폭이 남고, 80 으로 돌아온 workspace 는 폭을 저장하지 않는다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  const { app, page } = first
  await toggleView(first, 'columns')
  await clickMenu(app, 'widen-workspace')
  await expectCols(page, 110)
  await newWorkspace(first, 2)
  await clickMenu(app, 'widen-workspace')
  await expectCols(page, 110)
  await clickMenu(app, 'narrow-workspace')
  await expectCols(page, 80)

  await restartWith(app)
  const saved = JSON.parse(readFileSync(join(dataDir, 'restart.json'), 'utf8'))
  expect(saved.screen.workspaces.map((w: object) => 'paneCols' in w)).toEqual([true, false])

  const { app: againApp, page: again } = await launch()
  await expect(again.locator('.terminals')).toHaveClass(/columns/)
  await activeTerminal(again)
  await expectCols(again, 80)
  await clickMenu(againApp, 'previous-workspace')
  await activeTerminal(again)
  await expectCols(again, 110)
})

test('재시작 화면의 pane 폭이 정류장 밖이면 그 폭으로 되살리고, 넓히기·좁히기는 이웃 정류장으로 간다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  await toggleView(first, 'columns')
  await activeTerminal(first.page)
  await restartWith(first.app)
  const file = join(dataDir, 'restart.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  saved.screen.workspaces[0].paneCols = 100
  writeFileSync(file, JSON.stringify(saved))

  const { app, page } = await launch()
  await activeTerminal(page)
  await expectCols(page, 100)
  await clickMenu(app, 'widen-workspace')
  await expectCols(page, 110)
  await clickMenu(app, 'narrow-workspace')
  await expectCols(page, 80)
  await clickMenu(app, 'narrow-workspace')
  await expectCols(page, 80)
})
