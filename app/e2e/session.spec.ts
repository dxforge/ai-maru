import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeTerminal,
  delaySessionPort,
  expect,
  gridRows,
  newWorkspace,
  resizeBy,
  rows,
  run,
  sessionFiles,
  shellSize,
  slowSessionBin,
  sockets,
  test,
  zshHome
} from './app'

// 산술 확장을 쓰면 화면에 찍힌 입력과 셸의 출력이 구별된다.

test('키 입력이 셸에 가고 셸의 출력이 터미널에 뜬다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('echo out-$((1+2))\n')
  await expect(rows(page)).toContainText('out-3')
})

test('앱을 끄면 세션도 끝나고, 다시 켜면 새 셸이 뜬다', async ({ launch, dataDir }) => {
  const first = await launch()
  await first.page.keyboard.type('X=gone-$((40+2)); echo before-$((1+1))\n')
  await expect(rows(first.page)).toContainText('before-2')
  const [before] = sockets(dataDir)
  await first.app.close()
  expect(sessionFiles(dataDir)).toEqual([])

  const { page } = await launch()
  await page.keyboard.type('echo "x=$X" after-$((2+2))\n')
  await expect(rows(page)).toContainText('after-4')
  await expect(rows(page)).toContainText('x= after-4')
  expect(sockets(dataDir)).not.toContain(before)
})

test('창을 닫으면 세션도 끝난다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await page.keyboard.type('echo open-$((1+1))\n')
  await expect(rows(page)).toContainText('open-2')
  const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  expect(sessionFiles(dataDir)).toEqual([])
})

test('창이 새로 고쳐지면 이전 화면이 연 세션은 끝나고, 새 화면의 셸만 남는다', async ({
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

test('새 터미널이 세션에 붙기 전에 친 키도 셸에 간다', async ({ launch }) => {
  const launched = await launch()
  await delaySessionPort(launched.app, 1500)
  await newWorkspace(launched, 2)
  await launched.page.keyboard.type('echo ')
  await launched.page.keyboard.insertText('한글')
  await run(launched.page, '-$((1+1))', '한글-2')
})

test('새 터미널이 세션에 붙기 전에 창 크기가 바뀌어도 셸은 바뀐 크기를 본다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await delaySessionPort(app, 1500)
  await newWorkspace(launched, 2)
  const before = await gridRows(page).count()
  await resizeBy(app, -200, -180)
  await expect.poll(() => gridRows(page).count()).toBeLessThan(before)
  expect((await shellSize(page)).rows).toBe(await gridRows(page).count())
})

test('zsh 가 뜨는 동안 친 키도 셸에 간다', async ({ launch, dataDir }) => {
  test.skip(!existsSync('/bin/zsh'), 'zsh 가 없다')
  const { page } = await launch({
    SHELL: '/bin/zsh',
    HOME: zshHome(dataDir),
    MARU_SESSION_BIN: slowSessionBin(dataDir)
  })
  await run(page, 'echo "$MARK" typeahead-$((1+1))', 'rc-2 typeahead-2')
})

test('창 크기를 바꾸면 셸이 보는 크기도 바뀐다', async ({ launch }) => {
  const { app, page } = await launch()
  const before = await shellSize(page)
  expect(before.rows).toBe(await gridRows(page).count())

  await resizeBy(app, -200, -180)
  await expect.poll(async () => (await shellSize(page)).rows).toBeLessThan(before.rows)
  const after = await shellSize(page)
  expect(after.rows).toBe(await gridRows(page).count())
  expect(after.cols).toBeLessThan(before.cols)
})

test('maru-session 을 띄울 수 없으면 터미널에 이유를 보인다', async ({ launch }) => {
  const { page } = await launch({ MARU_SESSION_BIN: '/nonexistent/maru-session' })
  await expect(rows(page)).toContainText('open_failed')
})

test('앱을 띄운 터미널의 ZDOTDIR 과 CLAUDE_*·ANTHROPIC_*·MARU_*·ELECTRON_* 는 셸에 넘기지 않는다', async ({
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
    ANTHROPIC_BASE_URL: 'http://example.invalid',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    COLORTERM: 'outer',
    CLAUDE_CODE_FORCE_STRIKETHROUGH: 'outer'
  })
  await expect(rows(page)).toContainText('rc-from-home')
  await run(
    page,
    'echo "outer=[$CLAUDE_CONFIG_DIR|$ANTHROPIC_BASE_URL|$MARU_UNOBTRUSIVE|$ELECTRON_NO_ATTACH_CONSOLE] term=[$COLORTERM|$CLAUDE_CODE_FORCE_STRIKETHROUGH]" done-$((1+1))',
    'outer=[|||] term=[truecolor|1] done-2'
  )
  await expect(rows(page)).not.toContainText('rc-from-zdotdir')
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
  await expect(rows(page)).toContainText('charmap=[UTF-8] 한글-2')
})
