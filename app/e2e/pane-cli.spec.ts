import { appendFileSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import {
  activePane,
  clickMenu,
  expect,
  newWorkspace,
  paneBox as box,
  panes,
  paneTerminalRows as paneRows,
  rows,
  run,
  test,
  toggleView,
  workspaceViews,
  wrapSessionBin,
  zshHome
} from './app'

test('maru pane new 은 부른 칸 오른쪽에 명령을 띄워 그 세션 id 를 찍고, 포커스는 부른 칸에 남는다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(
    `ID=$(maru pane new bash -c 'echo "me=[$MARU_SESSION_ID]"; read x'); echo "got=[$ID]"\n`
  )
  await expect(panes(page)).toHaveCount(2)
  await expect(paneRows(page, 1)).toContainText(/me=\[s-[0-9a-f]{8}\]/)
  const me = (await paneRows(page, 1).innerText()).match(/me=\[(s-[0-9a-f]{8})\]/)![1]
  await expect(rows(page)).toContainText(`got=[${me}]`)

  const [left, right] = [await box(page, 0), await box(page, 1)]
  expect(right.x).toBeGreaterThan(left.x + left.width - 1)
  expect(right.y).toBe(left.y)
  await expect(activePane(page)).toHaveCount(1)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, 'echo still-$((1+1))', 'still-2')
})

test('명령이 끝나면 칸이 닫히고, 명령 없이 부르면 셸을 띄운다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(`maru pane new sh -c 'sleep 1; exit 3'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page)).toHaveCount(1)

  await page.keyboard.type('maru pane new\n')
  await expect(panes(page)).toHaveCount(2)
  await panes(page).nth(1).locator('.xterm-screen').click()
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, 'echo shell-$((1+1))', 'shell-2')
  await page.keyboard.type('exit\n')
  await expect(panes(page)).toHaveCount(1)
})

test('곧바로 끝나는 명령도 그 세션 id 를 찍고 성공하며, 칸은 닫힌다', async ({ launch }) => {
  const { page } = await launch()
  for (const command of ['true', 'echo hi', 'no-such-command-xyz']) {
    await page.keyboard.type(`clear; maru pane new ${command}; echo "code-$?"\n`)
    await expect(rows(page)).toContainText(/s-[0-9a-f]{8}\s*code-0/)
    await expect(panes(page)).toHaveCount(1)
  }
})

test('한 칸에서 동시에 부른 maru pane new 는 저마다 자기 칸의 세션 id 를 받는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const cmd = `maru pane new bash -c 'echo "me=[$MARU_SESSION_ID]"; read x'`
  await page.keyboard.type(
    `cd '${dataDir}'; ${cmd} > a & ${cmd} > b; wait; echo "got=[$(cat a)][$(cat b)]"\n`
  )
  await expect(panes(page)).toHaveCount(3)
  await expect(rows(page)).toContainText(/got=\[s-[0-9a-f]{8}\]\[s-[0-9a-f]{8}\]/)
  const [, a, b] = (await rows(page).textContent())!.match(/got=\[(s-\w+)\]\[(s-\w+)\]/)!
  expect(a).not.toBe(b)
  const shown = [
    await paneRows(page, 1).textContent(),
    await paneRows(page, 2).textContent()
  ].join()
  expect(shown).toContain(`me=[${a}]`)
  expect(shown).toContain(`me=[${b}]`)
})

test('--down 은 아래로 나누고, 시작 디렉토리는 --cwd 가 없으면 부른 디렉토리다', async ({
  launch,
  dataDir
}) => {
  const work = join(dataDir, 'work')
  mkdirSync(join(work, 'sub'), { recursive: true })
  const real = realpathSync(work)
  const { page } = await launch()
  await page.keyboard.type(
    `cd '${real}' && maru pane new --down bash -c 'echo "at=[$(pwd -P)]"; read x'\n`
  )
  await expect(paneRows(page, 1)).toContainText(`at=[${real}]`)
  const [top, bottom] = [await box(page, 0), await box(page, 1)]
  expect(bottom.y).toBeGreaterThan(top.y + top.height - 1)
  expect(bottom.x).toBe(top.x)

  await page.keyboard.type(`maru pane new --cwd sub -- bash -c 'echo "at=[$(pwd -P)]"; read x'\n`)
  await expect(panes(page)).toHaveCount(3)
  await expect(paneRows(page, 2)).toContainText(`at=[${real}/sub]`)
})

test('선택하지 않은 workspace 의 칸에서 부르면 그 workspace 를 나누고, 선택은 그대로다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type(`sleep 2; maru pane new bash -c 'read x'\n`)
  await newWorkspace(launched, 2)
  await expect(workspaceViews(page).nth(0).locator('.pane')).toHaveCount(2)
  await expect(workspaceViews(page).nth(1)).toHaveClass(/selected/)
  await expect(panes(page)).toHaveCount(1)
})

test('세션을 띄우지 못하면 나눈 칸을 닫고 maru pane new 가 이유와 함께 실패한다', async ({
  launch,
  dataDir
}) => {
  // 명령을 받은 세션만 실패하므로 처음 pane 의 셸은 뜬다.
  const bin = wrapSessionBin(
    dataDir,
    'failing-session',
    `case " $* " in *" -- "*) echo "boom-$((1+1))" >&2; exit 1;; esac`
  )
  const { page } = await launch({ MARU_SESSION_BIN: bin })
  await page.keyboard.type('maru pane new true; echo code-$?\n')
  await expect(rows(page)).toContainText('boom-2')
  await expect(rows(page)).toContainText('code-1')
  await expect(panes(page)).toHaveCount(1)
})

test('maru pane close 는 다른 칸도 자기 칸도 닫고, 없는 세션이면 실패한다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(`ID=$(maru pane new bash -c 'read x')\n`)
  await expect(panes(page)).toHaveCount(2)
  await run(page, 'maru pane close "$ID"; echo closed-$?', 'closed-0')
  await expect(panes(page)).toHaveCount(1)

  await page.keyboard.type(`maru pane new bash -c 'maru pane close "$MARU_SESSION_ID"; sleep 30'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page)).toHaveCount(1)

  await page.keyboard.type('maru pane close s-00000000; echo code-$?\n')
  await expect(rows(page)).toContainText('no pane for session s-00000000')
  await expect(rows(page)).toContainText('code-1')
})

test('columns 에서 maru pane new 로 오른쪽에 나누면 workspace 가 넓어진다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await toggleView(launched, 'columns')
  const one = (await workspaceViews(page).first().boundingBox())!.width
  await page.keyboard.type(`maru pane new bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect
    .poll(async () => (await workspaceViews(page).first().boundingBox())!.width)
    .toBeGreaterThan(one * 1.9)
})

test('columns 에서 maru pane new --full 은 아래로 나눈 칸에서 불러도 workspace 오른쪽 끝에 높이 전체로 붙는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await clickMenu(app, 'split-down')
  await expect(panes(page)).toHaveCount(2)
  await page.keyboard.type(`maru pane new --full bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(3)

  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  await expect
    .poll(async () => {
      const added = await box(page, 2)
      return [added.x + added.width, added.y, added.height]
    })
    .toEqual([grid.x + grid.width, grid.y, grid.height])
  const [top, added] = [await box(page, 0), await box(page, 2)]
  expect(added.width).toBeCloseTo(top.width, 0)
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
})

test('columns 에서 maru pane new --full --down 은 workspace 폭을 그대로 두고 아래쪽 끝에 폭 전체로 붙는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)
  const width = (await workspaceViews(page).first().boundingBox())!.width
  await page.keyboard.type(`maru pane new --full --down bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(3)

  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  await expect
    .poll(async () => {
      const added = await box(page, 2)
      return [added.x, added.width, added.y + added.height]
    })
    .toEqual([grid.x, grid.width, grid.y + grid.height])
  expect((await workspaceViews(page).first().boundingBox())!.width).toBe(width)
})

test('single 에서 maru pane new --full --down 은 workspace 아래쪽 끝에 폭 전체로 붙는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)
  await page.keyboard.type(`maru pane new --full --down bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(3)

  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  await expect
    .poll(async () => {
      const added = await box(page, 2)
      return [added.x, added.width, added.y + added.height]
    })
    .toEqual([grid.x, grid.width, grid.y + grid.height])
})

test('maru pane new 이 찍은 id 로 그 칸에 inbox 메시지를 보낸다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(
    `ID=$(maru pane new bash -c 'sleep 1; maru inbox read; read x'); maru inbox push "$ID" "hello-$((1+1))"\n`
  )
  await expect(paneRows(page, 1)).toContainText('hello-2')
})

test('명령은 사용자가 칠 때처럼 셸의 rc 를 읽은 뒤 돈다', async ({ launch, dataDir }) => {
  const home = zshHome(dataDir)
  appendFileSync(join(home, '.zshrc'), `from_rc() { echo "rc-fn-$((1+1))"; read x }\n`)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('maru pane new from_rc\n')
  await expect(paneRows(page, 1)).toContainText('rc-fn-2')
})
