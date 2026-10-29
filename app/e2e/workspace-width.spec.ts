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
  toast,
  toggleView,
  typesInto,
  cellWidth,
  writeConfig
} from './app'

test('columns 에서 Widen Cell 은 pane 을 80→100→120 열로 넓히고, Narrow Cell 은 120→100→80→60 열로 좁힌다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 80)
  const start = await cellWidth(page)

  await clickMenu(app, 'widen-cell')
  await expectCols(page, 100)
  expect(await cellWidth(page)).toBeGreaterThan(start)
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 120)

  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 100)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 80)
  expect(await cellWidth(page)).toBe(start)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 60)
  expect(await cellWidth(page)).toBeLessThan(start)
})

test('layout.column-step 만큼 넓히고 좁히며, 바꾼 폭이 20열보다 작아지면 그대로 두고, 고친 간격은 바로 쓴다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[layout]\ncolumn-cols = 40\ncolumn-step = 30\n')
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 40)
  await expect(toast(page)).toHaveCount(0)

  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 40)
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 70)
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 100)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 70)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 40)

  writeConfig(dataDir, '[layout]\ncolumn-cols = 60\ncolumn-step = 5\n')
  await expectCols(page, 60)
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 65)
})

test('넓힌 cell 을 나누면 두 pane 모두 그 폭이고, 위아래로 나눈 pane 은 아래 두 pane 의 폭을 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 100)

  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'right')
  await expectCols(page, 100)
  await clickMenu(app, 'focus-pane-left')
  await typesInto(page, 0, 'left')
  await expectCols(page, 100)

  await clickMenu(app, 'focus-pane-right')
  await split(app, page, 'split-down', 3)
  await split(app, page, 'split-right', 4)
  await typesInto(page, 3, 'd')
  await expectCols(page, 100)
  await clickMenu(app, 'focus-pane-left')
  await typesInto(page, 2, 'c')
  await expectCols(page, 100)
  await clickMenu(app, 'focus-pane-up')
  await typesInto(page, 1, 'b')
  const wide = (await shellSize(page)).cols
  expect(wide).toBeGreaterThanOrEqual(200)
  expect(wide).toBeLessThan(220)
})

test('single 에서는 아무것도 하지 않고 셸에도 가지 않으며, columns 로 돌아와도 80 이다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  const full = (await shellSize(page)).cols

  await clickMenu(app, 'widen-cell')
  await page.keyboard.type('echo pass-$((1+1))')
  await page.keyboard.press('Shift+Meta+Period')
  await run(page, '$((2+2))', 'pass-24')
  expect((await shellSize(page)).cols).toBe(full)

  await toggleView(launched, 'columns')
  await expectCols(page, 80)
})

test('선택한 cell 만 넓어지고 새 workspace 의 cell 은 80 이다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 100)

  await newWorkspace(launched, 2)
  await expectCols(page, 80)
  await clickMenu(app, 'previous-cell')
  await activeTerminal(page)
  await expectCols(page, 100)
  await expect.poll(() => cellWidth(page, 1)).toBeLessThan(await cellWidth(page, 0))
})

test('재시작 뒤 cell 의 pane 폭이 남고, 80 으로 돌아온 cell 은 폭을 저장하지 않는다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  const { app, page } = first
  await toggleView(first, 'columns')
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 100)
  await newWorkspace(first, 2)
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 100)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 80)

  await restartWith(app)
  const saved = JSON.parse(readFileSync(join(dataDir, 'restart.json'), 'utf8'))
  expect(saved.screen.workspaces.map((w: { cells: object[] }) => 'paneCols' in w.cells[0])).toEqual(
    [true, false]
  )

  const { app: againApp, page: again } = await launch()
  await expect(again.locator('.terminals')).toHaveClass(/columns/)
  await expectCols(again, 80)
  await clickMenu(againApp, 'previous-cell')
  await activeTerminal(again)
  await expectCols(again, 100)
})

test('재시작 화면의 pane 폭이 간격의 배수만큼 떨어져 있지 않으면 그 폭으로 되살리고, 넓히기·좁히기는 그 폭에서 간격만큼 바꾼다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  await toggleView(first, 'columns')
  await expectCols(first.page, 80)
  await restartWith(first.app)
  const file = join(dataDir, 'restart.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  saved.screen.workspaces[0].cells[0].paneCols = 95
  writeFileSync(file, JSON.stringify(saved))

  const { app, page } = await launch()
  await expectCols(page, 95)
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 115)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 95)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 75)
})

test('layout.column-cols 로 새 cell 의 pane 폭을 정하고, 넓히기·좁히기는 그 폭에서 간격만큼 바꾼다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[layout]\ncolumn-cols = 100\n')
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 100)
  await expect(toast(page)).toHaveCount(0)

  await clickMenu(app, 'widen-cell')
  await expectCols(page, 120)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 100)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 80)

  await newWorkspace(launched, 2)
  await expectCols(page, 100)
})

test('column-cols 를 고치면 폭을 바꾸지 않은 cell 은 따라가고 넓힌 cell 은 그 폭을 지키며, 재시작 뒤에도 같다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 80)
  const narrow = await cellWidth(page, 0)
  await newWorkspace(launched, 2)
  await clickMenu(app, 'widen-cell')
  await clickMenu(app, 'widen-cell')
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 140)

  writeConfig(dataDir, '[layout]\ncolumn-cols = 100\n')
  await expect.poll(() => cellWidth(page, 0)).toBeGreaterThan(narrow)
  await expectCols(page, 140)
  await clickMenu(app, 'previous-cell')
  await activeTerminal(page)
  await expectCols(page, 100)

  await restartWith(app)
  const saved = JSON.parse(readFileSync(join(dataDir, 'restart.json'), 'utf8'))
  expect(saved.screen.workspaces.map((w: { cells: object[] }) => 'paneCols' in w.cells[0])).toEqual(
    [false, true]
  )

  writeConfig(dataDir, '[layout]\ncolumn-cols = 120\n')
  const { app: againApp, page: again } = await launch()
  await expectCols(again, 120)
  await clickMenu(againApp, 'next-cell')
  await activeTerminal(again)
  await expectCols(again, 140)
})

test('설정 폭으로 돌아온 cell 은 폭을 저장하지 않아 다시 설정을 따른다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[layout]\ncolumn-cols = 140\n')
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 140)
  await clickMenu(app, 'narrow-cell')
  await expectCols(page, 120)
  await clickMenu(app, 'widen-cell')
  await expectCols(page, 140)

  writeConfig(dataDir, '[layout]\ncolumn-cols = 80\n')
  await expectCols(page, 80)
})

test('column-cols 가 범위 밖이면 끝값으로 맞춰 알린다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[layout]\ncolumn-cols = 10\n')
  const launched = await launch()
  const { page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 20)
  await expect(toast(page)).toContainText('layout.column-cols = 10 is outside 20–500, using 20.')
})
