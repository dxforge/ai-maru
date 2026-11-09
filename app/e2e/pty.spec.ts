import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeTerminal,
  clickMenu,
  delayPtyPort,
  delayPtyPortFromStart,
  expect,
  newWorkspace,
  panes,
  resizeBy,
  restartWith,
  run,
  ptyFiles,
  screen,
  shellSize,
  slowPtyBin,
  sockets,
  split,
  terminalRows,
  test,
  wrapPtyBin,
  zshHome
} from './app'

// 산술 확장을 쓰면 화면에 찍힌 입력과 셸의 출력이 구별된다.

test('키 입력이 셸에 가고 셸의 출력이 터미널에 뜬다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('echo out-$((1+2))\n')
  await expect(screen(page)).toShow('out-3')
})

test('앱을 끄면 pty 도 끝나고, 다시 켜면 새 셸이 뜬다', async ({ launch, dataDir }) => {
  const first = await launch()
  await first.page.keyboard.type('X=gone-$((40+2)); echo before-$((1+1))\n')
  await expect(screen(first.page)).toShow('before-2')
  const [before] = sockets(dataDir)
  await first.app.close()
  expect(ptyFiles(dataDir)).toEqual([])

  const { page } = await launch()
  await page.keyboard.type('echo "x=$X" after-$((2+2))\n')
  await expect(screen(page)).toShow('after-4')
  await expect(screen(page)).toShow('x= after-4')
  expect(sockets(dataDir)).not.toContain(before)
})

test('창을 닫으면 pty 도 끝난다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await page.keyboard.type('echo open-$((1+1))\n')
  await expect(screen(page)).toShow('open-2')
  const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  expect(ptyFiles(dataDir)).toEqual([])
})

test('창이 새로 고쳐지면 이전 화면이 연 pty 는 끝나고, 새 화면의 셸만 남는다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await expect.poll(() => sockets(dataDir).length).toBe(2)
  const before = sockets(dataDir)

  await page.reload()
  await activeTerminal(page)
  await run(page, 'echo fresh-$((1+1))', 'fresh-2')
  await expect.poll(() => sockets(dataDir).length).toBe(1)
  expect(before).not.toContain(sockets(dataDir)[0])
})

test('새 터미널이 pty 에 붙기 전에 친 키도 셸에 간다', async ({ launch }) => {
  const launched = await launch()
  await delayPtyPort(launched.app, 1500)
  await newWorkspace(launched, 2)
  await launched.page.keyboard.type('echo ')
  await launched.page.keyboard.insertText('한글')
  await run(launched.page, '-$((1+1))', '한글-2')
})

test('새 터미널이 pty 에 붙기 전에 창 크기가 바뀌어도 셸은 바뀐 크기를 본다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await delayPtyPort(app, 1500)
  await newWorkspace(launched, 2)
  const before = await terminalRows(screen(page))
  await resizeBy(app, -200, -180)
  await expect.poll(() => terminalRows(screen(page))).toBeLessThan(before)
  expect((await shellSize(page)).rows).toBe(await terminalRows(screen(page)))
})

test('zsh 가 뜨는 동안 친 키도 셸에 간다', async ({ launch, dataDir }) => {
  test.skip(!existsSync('/bin/zsh'), 'zsh 가 없다')
  const { page } = await launch({
    SHELL: '/bin/zsh',
    HOME: zshHome(dataDir),
    MARU_PTY_BIN: slowPtyBin(dataDir)
  })
  await run(page, 'echo "$MARK" typeahead-$((1+1))', 'rc-2 typeahead-2')
})

test('창 크기를 바꾸면 셸이 보는 크기도 바뀐다', async ({ launch }) => {
  const { app, page } = await launch()
  const before = await shellSize(page)
  expect(before.rows).toBe(await terminalRows(screen(page)))

  await resizeBy(app, -200, -180)
  await expect.poll(async () => (await shellSize(page)).rows).toBeLessThan(before.rows)
  const after = await shellSize(page)
  expect(after.rows).toBe(await terminalRows(screen(page)))
  expect(after.cols).toBeLessThan(before.cols)
})

test('maru-pty 를 띄울 수 없으면 터미널 첫 줄에 이유와 다시 열기를 보인다', async ({ launch }) => {
  const { page } = await launch({ MARU_PTY_BIN: '/nonexistent/maru-pty' })
  const line = page.locator('.opening-line')
  await expect(line).toHaveClass(/failed/)
  await expect(line).toContainText("Couldn't open the terminal: ")
  await expect(line.getByRole('button', { name: 'Reopen' })).toBeVisible()
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('늦게 뜨는 pty 는 여는 중을 보이고, 뜨면 지운다', async ({ launch, dataDir }) => {
  const { page } = await launch({ MARU_PTY_BIN: wrapPtyBin(dataDir, 'late-pty', 'sleep 5') })
  const line = page.locator('.opening-line')
  await expect(line).toContainText(/Opening… [34]s/)
  await expect(line).toHaveCount(0, { timeout: 10_000 })
  await run(page, 'echo opened-$((1+1))', 'opened-2')
})

test('5초 넘게 뜨지 않는 pty 는 다시 열기로 멈추고 새 pty id 로 다시 연다', async ({
  launch,
  dataDir
}) => {
  const fast = join(dataDir, 'fast')
  const pids = join(dataDir, 'pids')
  const bin = wrapPtyBin(dataDir, 'stuck-pty', `echo $$ >> '${pids}'\n[ -e '${fast}' ] || sleep 60`)
  const { page } = await launch({ MARU_PTY_BIN: bin })
  const before = await panes(page).first().getAttribute('data-pty')
  const reopen = page.locator('.opening-line').getByRole('button', { name: 'Reopen' })
  await expect(page.locator('.opening-line')).toContainText('Opening…')
  await expect(reopen).toBeVisible({ timeout: 10_000 })
  const [stuck] = readFileSync(pids, 'utf8').trim().split('\n').map(Number)

  writeFileSync(fast, '')
  await reopen.click()
  await run(page, 'echo reopened-$((1+1))', 'reopened-2')
  expect(await panes(page).first().getAttribute('data-pty')).not.toBe(before)
  await expect.poll(() => alive(stuck)).toBe(false)
})

test('띄우지 못한 pty 는 다시 열기로 새 pty 를 연다', async ({ launch, dataDir }) => {
  const fast = join(dataDir, 'fast')
  const bin = wrapPtyBin(dataDir, 'failing-pty', `[ -e '${fast}' ] || exit 1`)
  const { page } = await launch({ MARU_PTY_BIN: bin })
  const line = page.locator('.opening-line')
  await expect(line).toContainText(
    "Couldn't open the terminal: maru-pty exited before it was ready"
  )
  writeFileSync(fast, '')
  await line.getByRole('button', { name: 'Reopen' }).click()
  await run(page, 'echo reopened-$((2+2))', 'reopened-4')
})

test('pane 하나뿐인 cell 에서 다시 열어도 그 cell 의 job 은 살아 있다', async ({
  launch,
  dataDir
}) => {
  const slow = join(dataDir, 'slow')
  const bin = wrapPtyBin(
    dataDir,
    'once-slow-pty',
    `if [ -e '${slow}' ]; then rm '${slow}'; sleep 60; fi`
  )
  const { app, page } = await launch({ MARU_PTY_BIN: bin })
  await run(page, 'maru job new --name keeper sleep 300; echo started-$((1+1))', 'started-2')
  writeFileSync(slow, '')
  await split(app, page, 'split-right', 2)
  await expect(panes(page).nth(1).locator('.opening-line')).toContainText('Opening…')
  await panes(page).first().click()
  await clickMenu(app, 'close-pane')
  await expect(panes(page)).toHaveCount(1)

  const reopen = page.locator('.opening-line').getByRole('button', { name: 'Reopen' })
  await expect(reopen).toBeVisible({ timeout: 10_000 })
  await reopen.click()
  await run(page, 'maru job list', /keeper\s+running/)
})

test('되살린 pane 이 붙는 동안에는 5초가 지나도 다시 열기가 없고, 붙으면 같은 셸이다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await run(page, 'X=kept-$((40+2)); echo set-$((1+1))', 'set-2')
  await restartWith(app)
  // `Reopen` 이 붙는 시점(5초)이 지나도 없는지 보려고, 붙기를 그보다 늦춘다.
  const { page: again } = await launch({}, undefined, [], (a) => delayPtyPortFromStart(a, 8000))
  const line = again.locator('.opening-line')
  await expect(line).toContainText('Opening… 6s', { timeout: 10_000 })
  // 붙으면 줄째 사라지므로 `toHaveCount(0)` 처럼 기다리지 않고 지금 센다.
  expect(await line.getByRole('button', { name: 'Reopen' }).count()).toBe(0)
  await expect(line).toHaveCount(0, { timeout: 10_000 })
  await run(again, 'echo "x=$X"', 'x=kept-42')
})

test('maru pane new 로 연 pane 은 5초가 지나도 다시 열기가 없다', async ({ launch, dataDir }) => {
  const bin = wrapPtyBin(dataDir, 'slow-command-pty', `case " $* " in *" -- "*) sleep 60;; esac`)
  const { page } = await launch({ MARU_PTY_BIN: bin })
  await page.keyboard.type('maru pane new true\n')
  const line = panes(page).nth(1).locator('.opening-line')
  await expect(line).toContainText('Opening… 6s', { timeout: 10_000 })
  await expect(line.getByRole('button', { name: 'Reopen' })).toHaveCount(0)
})

test('앱을 띄운 터미널의 ZDOTDIR 과 CLAUDE_* 는 셸에 넘기지 않고, COLORTERM 은 앱의 값으로 덮는다', async ({
  launch,
  dataDir
}) => {
  test.skip(!existsSync('/bin/zsh'), 'zsh 가 없다')
  const home = join(dataDir, 'home')
  const zdotdir = join(dataDir, 'zdotdir')
  mkdirSync(home)
  mkdirSync(zdotdir)
  writeFileSync(join(home, '.zshrc'), 'echo rc-from-home\n')
  writeFileSync(join(zdotdir, '.zshrc'), 'echo rc-from-zdotdir\n')

  const { page } = await launch({
    SHELL: '/bin/zsh',
    HOME: home,
    ZDOTDIR: zdotdir,
    CLAUDE_CONFIG_DIR: '/outer/claude',
    COLORTERM: 'outer'
  })
  await expect(screen(page)).toShow('rc-from-home')
  await run(
    page,
    'echo "outer=[$CLAUDE_CONFIG_DIR] term=[$COLORTERM]" done-$((1+1))',
    'outer=[] term=[truecolor] done-2'
  )
  await expect(screen(page)).not.toShow('rc-from-zdotdir')
})

test('사용자가 rc 에서 export 한 CLAUDE_*·ANTHROPIC_* 는 셸이 다시 세운다', async ({
  launch,
  dataDir
}) => {
  test.skip(!existsSync('/bin/zsh'), 'zsh 가 없다')
  const home = join(dataDir, 'home')
  mkdirSync(home)
  writeFileSync(join(home, '.zshenv'), 'export CLAUDE_CONFIG_DIR=/from/zshenv\n')
  writeFileSync(join(home, '.zshrc'), 'export ANTHROPIC_BASE_URL=http://from.zshrc\n')
  const { page } = await launch({
    SHELL: '/bin/zsh',
    HOME: home,
    CLAUDE_CONFIG_DIR: '/outer/claude',
    ANTHROPIC_BASE_URL: 'http://example.invalid'
  })
  await run(
    page,
    'echo "rc=[$CLAUDE_CONFIG_DIR|$ANTHROPIC_BASE_URL]" done-$((1+1))',
    'rc=[/from/zshenv|http://from.zshrc] done-2'
  )
})

test('LANG 없이 띄워도 셸은 UTF-8 로케일로 떠 한글을 받는다', async ({ launch }) => {
  test.skip(process.platform !== 'darwin', 'macOS 의 지역 설정으로 채운다')
  const { page } = await launch({ LANG: '', LC_ALL: '', LC_CTYPE: '' })
  await page.keyboard.type('echo "charmap=[$(locale charmap)]" 한글-$((1+1))\n')
  await expect(screen(page)).toShow('charmap=[UTF-8] 한글-2')
})
