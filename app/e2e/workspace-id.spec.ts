import {
  expect,
  newCell,
  newWorkspace,
  panes,
  recordPtys,
  run,
  split,
  test,
  wrapPtyBin
} from './app'

test('pty 는 그 pane 의 cell id 를 싣고 열리고, maru pane new 의 pane 은 부른 pane 의 cell 을 따른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  const events = await recordPtys(app)
  await split(app, page, 'split-right', 2)
  await newWorkspace(launched, 2)
  await split(app, page, 'split-down', 2)
  await page.keyboard.type('maru pane new\n')
  await expect(panes(page)).toHaveCount(3)

  await newCell(launched, 3)

  await expect.poll(async () => (await events()).opens.length).toBe(5)
  const [first, second, third, fourth, fifth] = (await events()).opens.map((o) => o.cell)
  expect(first).toMatch(/^c-[0-9a-f]{8}$/)
  expect(second).toMatch(/^c-[0-9a-f]{8}$/)
  expect(second).not.toBe(first)
  expect(third).toBe(second)
  expect(fourth).toBe(second)
  expect(fifth).toMatch(/^c-[0-9a-f]{8}$/)
  expect(fifth).not.toBe(second)
})

test('셸이 스스로 끝나 pane 이 닫혀도 그 pty 의 끄기를 main 에 보낸다', async ({ launch }) => {
  const { app, page } = await launch()
  const events = await recordPtys(app)
  await split(app, page, 'split-right', 2)
  await expect.poll(async () => (await events()).opens.length).toBe(1)
  const { key } = (await events()).opens[0]
  await page.keyboard.type('exit\n')
  await expect(panes(page)).toHaveCount(1)
  await expect.poll(async () => (await events()).kills).toEqual([key])
})

test('maru pane new 의 pty 가 뜨지 못해 pane 이 닫혀도 그 pty 의 끄기를 main 에 보낸다', async ({
  launch,
  dataDir
}) => {
  // `--` 뒤에 명령을 받은 pty 만 실패하므로 처음 pane 의 셸은 뜬다.
  const bin = wrapPtyBin(dataDir, 'failing-pty', `case " $* " in *" -- "*) exit 1;; esac`)
  const { app, page } = await launch({ MARU_PTY_BIN: bin })
  const events = await recordPtys(app)
  await run(page, 'maru pane new true; echo code-$?', 'code-1')
  await expect(panes(page)).toHaveCount(1)
  const { key } = (await events()).opens[0]
  await expect.poll(async () => (await events()).kills).toEqual([key])
})
