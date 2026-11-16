import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
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
  resizeGridTo,
  run,
  screen,
  screenText,
  test,
  cellViews,
  zshHome
} from './app'

test('maru pane new 은 부른 pane 오른쪽에 명령을 띄워 머리 줄과 함께 그 pane id 와 pty id 를 찍고, 포커스는 부른 pane 에 남는다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(
    `echo "got=[$(maru pane new bash -c 'echo "me=[$MARU_PTY_ID]"; read x' | tr '\\t\\n' '|/')]"\n`
  )
  await expect(panes(page)).toHaveCount(2)
  await expect(screen(page, 1)).toShow(/me=\[p-[0-9a-f]{8}\]/)
  const me = (await screenText(screen(page, 1))).match(/me=\[(p-[0-9a-f]{8})\]/)![1]
  const got = new RegExp(`got=\\[PANE\\|PTY/(n-[0-9a-f]{8})\\|${me}/\\]`)
  await expect(screen(page)).toShow(got)
  const pane = (await screenText(screen(page))).match(got)![1]

  const [left, right] = [await box(page, 0), await box(page, 1)]
  expect(right.x).toBeGreaterThan(left.x + left.width - 1)
  expect(right.y).toBe(left.y)
  await expect(activePane(page)).toHaveCount(1)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await run(page, 'echo still-$((1+1))', 'still-2')
  await run(
    page,
    `clear; maru pane list | awk -F'\\t' '$1 == "${pane}" { print "listed=[" $2 "]" }'`,
    `listed=[${me}]`
  )
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

test('곧바로 끝나는 명령도 그 pane id 와 pty id 를 찍고 성공하며, pane 은 닫힌다', async ({
  launch
}) => {
  const { page } = await launch()
  for (const [i, command] of ['true', 'echo hi', 'no-such-command-xyz'].entries()) {
    await page.keyboard.type(`clear; maru pane new ${command}; echo "code-$?-${i}"\n`)
    await expect(screen(page)).toShow(new RegExp(`n-[0-9a-f]{8}\\s+p-[0-9a-f]{8}\\s*code-0-${i}`))
    await expect(panes(page)).toHaveCount(1)
  }
})

test('한 pane 에서 동시에 부른 maru pane new 는 저마다 자기 pane 의 pty id 를 받는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const cmd = `maru pane new bash -c 'echo "me=[$MARU_PTY_ID]"; read x' | awk 'NR == 2 { print $2 }'`
  await page.keyboard.type(
    `cd '${dataDir}'; ${cmd} > a & ${cmd} > b; wait; echo "got=[$(cat a)][$(cat b)]"\n`
  )
  await expect(panes(page)).toHaveCount(3)
  await expect(screen(page)).toShow(/got=\[p-[0-9a-f]{8}\]\[p-[0-9a-f]{8}\]/)
  const [, a, b] = (await screenText(screen(page))).match(/got=\[(p-\w+)\]\[(p-\w+)\]/)!
  expect(a).not.toBe(b)
  const me = new RegExp(`me=\\[(${a}|${b})\\]`)
  await expect(screen(page, 1)).toShow(me)
  await expect(screen(page, 2)).toShow(me)
  const shown = [await screenText(screen(page, 1)), await screenText(screen(page, 2))].join()
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
  await expect(screen(page, 1)).toShow(`at=[${real}]`)
  const [top, bottom] = [await box(page, 0), await box(page, 1)]
  expect(bottom.y).toBeGreaterThan(top.y + top.height - 1)
  expect(bottom.x).toBe(top.x)

  await page.keyboard.type(`maru pane new --cwd sub -- bash -c 'echo "at=[$(pwd -P)]"; read x'\n`)
  await expect(panes(page)).toHaveCount(3)
  await expect(screen(page, 2)).toShow(`at=[${real}/sub]`)
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

const MY_CELL = `C=$(maru pane list | awk -F'\\t' -v p="$MARU_PTY_ID" '$2 == p { print $6 }')`
// 부른 터미널의 pane id 를 `P` 에 둔다. 막 연 pane 은 창이 화면을 알리기 전이라 목록에 없을 수 있어, 나올 때까지 다시 묻는다.
const MY_PANE = `until P=$(maru pane list | awk -F'\\t' -v p="$MARU_PTY_ID" '$2 == p { print $1 }'); [ -n "$P" ]; do sleep 0.1; done`

test('maru pane new --cell 은 --full 이 없어도 가리킨 cell 전체를 나눠 오른쪽 끝에, --down 이면 아래쪽 끝에 붙이고, 부른 쪽과 가리킨 cell 의 포커스와 선택은 그대로다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await page.keyboard.type(
    `C=$(maru cell new bash -c 'maru pane new --down bash -c "read x" >/dev/null; read x' | awk 'NR == 2 { print $3 }')\n`
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

test('maru pane new --cell 은 없는 cell 이면 이유를 찍고 실패하며 pane 을 열지 않는다', async ({
  launch
}) => {
  const { page } = await launch()
  await run(page, 'clear; maru pane new --cell c-00000000 true; echo "code-$?"', 'code-1')
  await expect(screen(page)).toShow('no cell c-00000000')
  await expect(panes(page)).toHaveCount(1)
  await expect(cellItems(page)).toHaveCount(1)
})

test('maru pane new --split --down 은 가리킨 pane 의 아래로 나누고 포커스는 부른 pane 에 남으며, 없는 pane 이나 pty id 를 주면 이유를 찍고 실패한다', async ({
  launch
}) => {
  const { page } = await launch()
  await run(
    page,
    `P=$(maru pane new --full bash -c 'read x' | awk 'NR == 2 { print $1 }'); echo first-$?`,
    'first-0'
  )
  await run(page, `maru pane new --split $P --down bash -c 'read x'; echo down-$?`, 'down-0')
  await expect(panes(page)).toHaveCount(3)
  const [left, top, bottom] = [await box(page, 0), await box(page, 1), await box(page, 2)]
  expect(top.x).toBeGreaterThan(left.x + left.width - 1)
  expect(bottom.x).toBe(top.x)
  expect(bottom.y).toBeGreaterThan(top.y + top.height - 1)
  expect(left.y + left.height).toBeCloseTo(bottom.y + bottom.height, 0)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)

  await run(page, 'clear; maru pane new --split n-00000000 true; echo "code-$?"', 'code-1')
  await expect(screen(page)).toShow('no pane n-00000000')
  await run(page, `clear; ${MY_PANE}; echo "mine=[$P]"`, /mine=\[n-[0-9a-f]{8}\]/)
  const mine = (await screenText(screen(page))).match(/mine=\[(n-[0-9a-f]{8})\]/)![1]
  await run(page, 'clear; maru pane new --split "$MARU_PTY_ID" true; echo "code-$?"', 'code-1')
  await expect(screen(page)).toShow(`is a pty, not a pane; its pane is ${mine}`)
  await expect(panes(page)).toHaveCount(3)
})

test('maru pane new --split 은 다른 workspace 의 pane 도, job 에서 불러도 나눈다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  const saved = join(dataDir, 'pane-id')
  await run(page, `${MY_PANE}; echo "$P" > '${saved}'; echo saved-$((1+1))`, 'saved-2')
  await newWorkspace(launched, 2)
  await expect(cellViews(page).nth(1)).toHaveClass(/selected/)

  await run(
    page,
    `maru pane new --split $(cat '${saved}') bash -c 'read x'; echo code-$?`,
    'code-0'
  )
  await expect(cellViews(page).nth(0).locator('.pane')).toHaveCount(2)
  await page.keyboard.type(
    `maru job new --name opener maru pane new --split $(cat '${saved}') bash -c 'read x'\n`
  )
  await expect(cellViews(page).nth(0).locator('.pane')).toHaveCount(3)
  await expect(cellViews(page).nth(1)).toHaveClass(/selected/)
  await expect(panes(page)).toHaveCount(1)
})

test('pty 를 띄우지 못하면 나눈 pane 을 닫고 maru pane new 가 이유와 함께 실패한다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch({ MARU_PTY_BIN: failingCommandPtyBin(dataDir) })
  await page.keyboard.type('maru pane new true; echo code-$?\n')
  await expect(screen(page)).toShow('boom-2')
  await expect(screen(page)).toShow('code-1')
  await expect(panes(page)).toHaveCount(1)

  await page.keyboard.type(`clear; C=$(maru cell new | awk 'NR == 2 { print $3 }')\n`)
  const target = cellViews(page).nth(1).locator('.pane')
  await expect(target).toHaveCount(1)
  await page.keyboard.type('maru pane new --cell $C true; echo cell-$?\n')
  await expect(screen(page)).toShow('boom-2')
  await expect(screen(page)).toShow('cell-1')
  await expect(target).toHaveCount(1)
})

test('maru pane new --cell 은 가리킨 cell 에 나눌 자리가 없으면 부른 cell 에 자리가 있어도 no space 오류로 끝난다', async ({
  launch
}) => {
  const { app, page } = await launch()
  // 하한 두 개(글자 칸 46개)는 들어가고 세 개(글자 칸 69개)는 들어가지 않는 폭이다.
  await resizeGridTo(app, page, 58)
  await page.keyboard.type(
    `C=$(maru cell new bash -c 'maru pane new bash -c "read x" >/dev/null; read x' | awk 'NR == 2 { print $3 }')\n`
  )
  const target = cellViews(page).nth(1).locator('.pane')
  await expect(target).toHaveCount(2)
  await run(page, `clear; maru pane new --cell $C bash -c 'read x'; echo code-$?`, 'code-1')
  await expect(screen(page)).toShow('no space for a new pane')
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
  await expect(screen(page)).toShow('did not answer', { timeout: 20_000 })
  await expect(screen(page)).toShow('code-1')
  await page.waitForTimeout(500)
  await expect(panes(page)).toHaveCount(1)
})

test('maru pane close 는 다른 pane 도 자기 pane 도 닫고, 없는 pane 이나 pty id 를 주면 실패한다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  await page.keyboard.type(`ID=$(maru pane new bash -c 'read x' | awk 'NR == 2 { print $1 }')\n`)
  await expect(panes(page)).toHaveCount(2)
  await run(page, 'maru pane close "$ID"; echo closed-$?', 'closed-0')
  await expect(panes(page)).toHaveCount(1)

  const closeSelf = join(dataDir, 'close-self.sh')
  writeFileSync(closeSelf, `${MY_PANE}\nmaru pane close "$P"\nsleep 30\n`)
  await page.keyboard.type(`maru pane new bash '${closeSelf}'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page)).toHaveCount(1)

  await page.keyboard.type('clear; maru pane close n-00000000; echo code-$?\n')
  await expect(screen(page)).toShow('no pane n-00000000')
  await expect(screen(page)).toShow('code-1')
  await run(page, 'clear; maru pane close "$MARU_PTY_ID"; echo code-$?', 'code-1')
  await expect(screen(page)).toShow('is a pty, not a pane; its pane is n-')
  await expect(panes(page)).toHaveCount(1)
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

test('maru pane new 이 찍은 pty id 로 그 pane 에 inbox 메시지를 보낸다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(
    `ID=$(maru pane new bash -c 'sleep 1; maru inbox read; read x' | awk 'NR == 2 { print $2 }'); maru inbox push "$ID" "hello-$((1+1))"\n`
  )
  await expect(screen(page, 1)).toShow('hello-2')
})

test('명령은 사용자가 칠 때처럼 셸의 rc 를 읽은 뒤 돈다', async ({ launch, dataDir }) => {
  const home = zshHome(dataDir)
  appendFileSync(join(home, '.zshrc'), `from_rc() { echo "rc-fn-$((1+1))"; read x }\n`)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('maru pane new from_rc\n')
  await expect(screen(page, 1)).toShow('rc-fn-2')
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
  await expect(screen(page)).toShow('code-1')
  await expect(panes(page)).toHaveCount(2)
})
