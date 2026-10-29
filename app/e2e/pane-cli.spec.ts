import { appendFileSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import {
  activePane,
  cellItems,
  clickMenu,
  expect,
  failingCommandPtyBin,
  newWorkspace,
  paneBox as box,
  panes,
  paneTerminalRows as paneRows,
  resizeGridTo,
  rows,
  run,
  test,
  toggleView,
  cellViews,
  zshHome
} from './app'

test('maru pane new 은 부른 pane 오른쪽에 명령을 띄워 그 pty id 를 찍고, 포커스는 부른 pane 에 남는다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(
    `ID=$(maru pane new bash -c 'echo "me=[$MARU_PTY_ID]"; read x'); echo "got=[$ID]"\n`
  )
  await expect(panes(page)).toHaveCount(2)
  await expect(paneRows(page, 1)).toContainText(/me=\[p-[0-9a-f]{8}\]/)
  const me = (await paneRows(page, 1).innerText()).match(/me=\[(p-[0-9a-f]{8})\]/)![1]
  await expect(rows(page)).toContainText(`got=[${me}]`)

  const [left, right] = [await box(page, 0), await box(page, 1)]
  expect(right.x).toBeGreaterThan(left.x + left.width - 1)
  expect(right.y).toBe(left.y)
  await expect(activePane(page)).toHaveCount(1)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, 'echo still-$((1+1))', 'still-2')
})

test('명령이 끝나면 pane 이 닫히고, 명령 없이 부르면 셸을 띄운다', async ({ launch }) => {
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

test('곧바로 끝나는 명령도 그 pty id 를 찍고 성공하며, pane 은 닫힌다', async ({ launch }) => {
  const { page } = await launch()
  for (const command of ['true', 'echo hi', 'no-such-command-xyz']) {
    await page.keyboard.type(`clear; maru pane new ${command}; echo "code-$?"\n`)
    await expect(rows(page)).toContainText(/p-[0-9a-f]{8}\s*code-0/)
    await expect(panes(page)).toHaveCount(1)
  }
})

test('한 pane 에서 동시에 부른 maru pane new 는 저마다 자기 pane 의 pty id 를 받는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const cmd = `maru pane new bash -c 'echo "me=[$MARU_PTY_ID]"; read x'`
  await page.keyboard.type(
    `cd '${dataDir}'; ${cmd} > a & ${cmd} > b; wait; echo "got=[$(cat a)][$(cat b)]"\n`
  )
  await expect(panes(page)).toHaveCount(3)
  await expect(rows(page)).toContainText(/got=\[p-[0-9a-f]{8}\]\[p-[0-9a-f]{8}\]/)
  const [, a, b] = (await rows(page).textContent())!.match(/got=\[(p-\w+)\]\[(p-\w+)\]/)!
  expect(a).not.toBe(b)
  const me = new RegExp(`me=\\[(${a}|${b})\\]`)
  await expect(paneRows(page, 1)).toContainText(me)
  await expect(paneRows(page, 2)).toContainText(me)
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

test('선택하지 않은 cell 의 pane 에서 부르면 그 cell 을 나누고, 선택은 그대로다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type(`sleep 2; maru pane new bash -c 'read x'\n`)
  await newWorkspace(launched, 2)
  await expect(cellViews(page).nth(0).locator('.pane')).toHaveCount(2)
  await expect(cellViews(page).nth(1)).toHaveClass(/selected/)
  await expect(panes(page)).toHaveCount(1)
})

const MY_CELL = `C=$(maru pane list | awk -F'\\t' -v p="$MARU_PTY_ID" '$1 == p { print $5 }')`

test('maru pane new --cell 은 --full 이 없어도 가리킨 cell 전체를 나눠 오른쪽 끝에, --down 이면 아래쪽 끝에 붙이고, 부른 쪽과 가리킨 cell 의 포커스와 선택은 그대로다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await page.keyboard.type(
    `C=$(maru cell new bash -c 'maru pane new --down bash -c "read x" >/dev/null; read x' | awk 'NR == 2 { print $2 }')\n`
  )
  const target = cellViews(page).nth(1).locator('.pane')
  await expect(target).toHaveCount(2)
  await run(page, `maru pane new --cell $C bash -c 'read x'; echo right-$?`, 'right-0')
  await expect(target).toHaveCount(3)
  await run(page, `maru pane new --cell $C --full --down bash -c 'read x'; echo down-$?`, 'down-0')
  await expect(target).toHaveCount(4)

  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
  await expect(panes(page)).toHaveCount(1)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, 'echo still-$((1+1))', 'still-2')

  await clickMenu(app, 'next-cell')
  await expect(cellViews(page).nth(1)).toHaveClass(/selected/)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  await expect
    .poll(async () => {
      const [right, bottom] = [await box(page, 2), await box(page, 3)]
      return [right.x + right.width, right.y, bottom.x, bottom.width, bottom.y + bottom.height]
    })
    .toEqual([grid.x + grid.width, grid.y, grid.x, grid.width, grid.y + grid.height])
  const [lower, right] = [await box(page, 1), await box(page, 2)]
  expect(right.y + right.height).toBeCloseTo(lower.y + lower.height, 0)
})

test('maru pane new --cell 은 다른 workspace 의 cell 에도, job 에서 불러도 띄운다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  const saved = join(dataDir, 'cell-id')
  await run(page, `${MY_CELL}; echo "$C" > '${saved}'; echo saved-$((1+1))`, 'saved-2')
  await newWorkspace(launched, 2)
  await expect(cellViews(page).nth(1)).toHaveClass(/selected/)

  await run(page, `maru pane new --cell $(cat '${saved}') bash -c 'read x'; echo code-$?`, 'code-0')
  await expect(cellViews(page).nth(0).locator('.pane')).toHaveCount(2)
  await page.keyboard.type(
    `maru job new --name opener maru pane new --cell $(cat '${saved}') bash -c 'read x'\n`
  )
  await expect(cellViews(page).nth(0).locator('.pane')).toHaveCount(3)
  await expect(cellViews(page).nth(1)).toHaveClass(/selected/)
  await expect(panes(page)).toHaveCount(1)
})

test('maru pane new --cell 은 없는 cell 이나 cell id 가 아닌 값이면 이유를 찍고 실패하며 pane 을 열지 않는다', async ({
  launch
}) => {
  const { page } = await launch()
  for (const [cell, reason] of [
    ['c-00000000', 'no cell c-00000000'],
    ["'ai-maru main'", 'must be a cell id'],
    ['p-00000000', 'must be a cell id']
  ]) {
    await run(page, `clear; maru pane new --cell ${cell} true; echo "code-$?"`, 'code-1')
    await expect(rows(page)).toContainText(reason)
  }
  await expect(panes(page)).toHaveCount(1)
  await expect(cellItems(page)).toHaveCount(1)
})

test('pty 를 띄우지 못하면 나눈 pane 을 닫고 maru pane new 가 이유와 함께 실패한다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch({ MARU_PTY_BIN: failingCommandPtyBin(dataDir) })
  await page.keyboard.type('maru pane new true; echo code-$?\n')
  await expect(rows(page)).toContainText('boom-2')
  await expect(rows(page)).toContainText('code-1')
  await expect(panes(page)).toHaveCount(1)

  await page.keyboard.type(`clear; C=$(maru cell new | awk 'NR == 2 { print $2 }')\n`)
  const target = cellViews(page).nth(1).locator('.pane')
  await expect(target).toHaveCount(1)
  await page.keyboard.type('maru pane new --cell $C true; echo cell-$?\n')
  await expect(rows(page)).toContainText('boom-2')
  await expect(rows(page)).toContainText('cell-1')
  await expect(target).toHaveCount(1)
})

test('maru pane new --cell 은 가리킨 cell 에 나눌 자리가 없으면 부른 cell 에 자리가 있어도 no space 오류로 끝난다', async ({
  launch
}) => {
  const { app, page } = await launch()
  // 하한 두 개(글자 칸 46개)는 들어가고 세 개(글자 칸 69개)는 들어가지 않는 폭이다.
  await resizeGridTo(app, page, 58)
  await page.keyboard.type(
    `C=$(maru cell new bash -c 'maru pane new bash -c "read x" >/dev/null; read x' | awk 'NR == 2 { print $2 }')\n`
  )
  const target = cellViews(page).nth(1).locator('.pane')
  await expect(target).toHaveCount(2)
  await run(page, `clear; maru pane new --cell $C bash -c 'read x'; echo code-$?`, 'code-1')
  await expect(rows(page)).toContainText('no space for a new pane')
  await expect(target).toHaveCount(2)
  await expect(panes(page)).toHaveCount(1)
})

test('창이 시간 안에 답하지 못해 실패한 maru pane new 의 pane 은 창이 늦게 열어도 닫는다', async ({
  launch
}) => {
  test.setTimeout(40_000)
  const { app, page } = await launch()
  await page.keyboard.type(`sleep 1; maru pane new -- sh -c 'echo late; sleep 30'; echo code-$?\n`)
  // renderer 메인 스레드를 10초 동안 블록해, `pane:new` 를 main 의 `REPLY_MS`(8초)가 지난 뒤에야 받게 한다.
  await app.evaluate(({ BrowserWindow }) => {
    void BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
      '{ const t = Date.now(); while (Date.now() - t < 10000) {} }'
    )
  })
  await expect(rows(page)).toContainText('did not answer', { timeout: 20_000 })
  await expect(rows(page)).toContainText('code-1')
  await page.waitForTimeout(500)
  await expect(panes(page)).toHaveCount(1)
})

test('maru pane close 는 다른 pane 도 자기 pane 도 닫고, 없는 pty 면 실패한다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(`ID=$(maru pane new bash -c 'read x')\n`)
  await expect(panes(page)).toHaveCount(2)
  await run(page, 'maru pane close "$ID"; echo closed-$?', 'closed-0')
  await expect(panes(page)).toHaveCount(1)

  await page.keyboard.type(`maru pane new bash -c 'maru pane close "$MARU_PTY_ID"; sleep 30'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page)).toHaveCount(1)

  await page.keyboard.type('maru pane close p-00000000; echo code-$?\n')
  await expect(rows(page)).toContainText('no pane for pty p-00000000')
  await expect(rows(page)).toContainText('code-1')
})

test('columns 에서 maru pane new 로 오른쪽에 나누면 cell 이 넓어진다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await toggleView(launched, 'columns')
  const one = (await cellViews(page).first().boundingBox())!.width
  await page.keyboard.type(`maru pane new bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect
    .poll(async () => (await cellViews(page).first().boundingBox())!.width)
    .toBeGreaterThan(one * 1.9)
})

test('columns 에서 maru pane new --full 은 아래로 나눈 pane 에서 불러도 cell 오른쪽 끝에 높이 전체로 붙는다', async ({
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

test('columns 에서 maru pane new --full --down 은 cell 폭을 그대로 두고 아래쪽 끝에 폭 전체로 붙는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)
  const width = (await cellViews(page).first().boundingBox())!.width
  await page.keyboard.type(`maru pane new --full --down bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(3)

  const grid = (await page.locator('.panes.selected .grid').boundingBox())!
  await expect
    .poll(async () => {
      const added = await box(page, 2)
      return [added.x, added.width, added.y + added.height]
    })
    .toEqual([grid.x, grid.width, grid.y + grid.height])
  expect((await cellViews(page).first().boundingBox())!.width).toBe(width)
})

test('single 에서 maru pane new --full --down 은 cell 아래쪽 끝에 폭 전체로 붙는다', async ({
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

test('maru pane new 이 찍은 id 로 그 pane 에 inbox 메시지를 보낸다', async ({ launch }) => {
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

test('maru pane new 은 나눌 자리가 없으면 no space 오류로 끝나고 pane 을 열지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  // 하한 두 개(글자 칸 46개)는 들어가고 세 개(글자 칸 69개)는 들어가지 않는 폭이다.
  await resizeGridTo(app, page, 58)
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)

  await run(page, `maru pane new bash -c 'read x'; echo code-$?`, 'no space for a new pane')
  await expect(rows(page)).toContainText('code-1')
  await run(page, `maru pane new --full bash -c 'read x'; echo full-$?`, 'full-1')
  await run(
    page,
    `clear; ${MY_CELL}; maru pane new --cell $C bash -c 'read x'; echo cell-$?`,
    'cell-1'
  )
  await expect(rows(page)).toContainText('no space for a new pane')

  await expect(panes(page)).toHaveCount(2)
})
