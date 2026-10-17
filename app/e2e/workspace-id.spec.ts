import {
  expect,
  newWorkspace,
  panes,
  recordSessions,
  run,
  split,
  test,
  wrapSessionBin
} from './app'

test('세션은 그 칸의 workspace id 를 싣고 열리고, maru pane new 의 칸은 부른 칸의 workspace 를 따른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  const events = await recordSessions(app)
  await split(app, page, 'split-right', 2)
  await newWorkspace(launched, 2)
  await split(app, page, 'split-down', 2)
  await page.keyboard.type('maru pane new\n')
  await expect(panes(page)).toHaveCount(3)

  await expect.poll(async () => (await events()).opens.length).toBe(4)
  const [first, second, third, fourth] = (await events()).opens.map((o) => o.workspace)
  expect(first).toBeTruthy()
  expect(second).toBeTruthy()
  expect(second).not.toBe(first)
  expect(third).toBe(second)
  expect(fourth).toBe(second)
})

test('셸이 스스로 끝나 칸이 닫혀도 그 세션의 끄기를 main 에 보낸다', async ({ launch }) => {
  const { app, page } = await launch()
  const events = await recordSessions(app)
  await split(app, page, 'split-right', 2)
  await expect.poll(async () => (await events()).opens.length).toBe(1)
  const { key } = (await events()).opens[0]
  await page.keyboard.type('exit\n')
  await expect(panes(page)).toHaveCount(1)
  await expect.poll(async () => (await events()).kills).toEqual([key])
})

test('maru pane new 의 세션이 뜨지 못해 칸이 닫혀도 그 세션의 끄기를 main 에 보낸다', async ({
  launch,
  dataDir
}) => {
  // `--` 뒤에 명령을 받은 세션만 실패하므로 처음 pane 의 셸은 뜬다.
  const bin = wrapSessionBin(dataDir, 'failing-session', `case " $* " in *" -- "*) exit 1;; esac`)
  const { app, page } = await launch({ MARU_SESSION_BIN: bin })
  const events = await recordSessions(app)
  await run(page, 'maru pane new true; echo code-$?', 'code-1')
  await expect(panes(page)).toHaveCount(1)
  const { key } = (await events()).opens[0]
  await expect.poll(async () => (await events()).kills).toEqual([key])
})
