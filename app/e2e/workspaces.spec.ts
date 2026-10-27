import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeTerminal,
  clickMenu,
  expect,
  gridRows,
  hostPid,
  newWorkspace,
  pressNew,
  putCanvas,
  resizeBy,
  rows,
  run,
  ptyFiles,
  slowPtyBin,
  shellSize,
  sockets,
  test,
  cellGroups,
  cellItems,
  cellPlaces,
  cellViews,
  marked,
  newCell,
  workspaceNames,
  zshHome
} from './app'

test('앱을 켜면 홈 디렉토리에서 cell 하나를 연다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await expect(cellPlaces(page)).toHaveText(['~'])
  await expect(cellGroups(page).first()).toHaveClass(/selected/)
  await run(page, '[ "$PWD" = "$HOME" ] && echo home-$((1+1))', 'home-2')
  expect(sockets(dataDir)).toHaveLength(1)
})

test('bash 에서 ⌘N 은 cd 와 상관없이 홈 디렉토리에서 새 pty 로 새 workspace 를 열고 그것을 선택한다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'cd /tmp; X=first-$((1+1)); echo moved-$((5+5))', 'moved-10')
  await expect(cellPlaces(page)).toHaveText(['~'])

  await newWorkspace(launched, 2)
  await expect(cellPlaces(page)).toHaveText(['~', '~'])

  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)
  await run(page, 'echo "x=$X pwd=$PWD" new-$((2+2))', `x= pwd=${process.env.HOME} new-4`)
  expect(sockets(dataDir)).toHaveLength(2)
})

test('사이드바에서 누른 cell 로 전환하고, 보이지 않던 동안의 출력도 남아 있다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('X=a-$((1+1)); (sleep 1; echo late-$((3+3))) &\n')
  await newWorkspace(launched, 2)
  await page.keyboard.type('X=b-$((2+2))\n')
  await expect(rows(page)).not.toContainText('late-6')
  await page.waitForTimeout(1500)

  await cellItems(page).first().click()

  await expect(cellGroups(page).first()).toHaveClass(/selected/)
  await expect(rows(page)).toContainText('late-6')
  await run(page, 'echo "x=$X"', 'x=a-2')
  await cellItems(page).nth(1).click()
  await run(page, 'echo "x=$X"', 'x=b-4')
})

test('셸이 끝나면 그 cell 을 닫고, 바로 위 cell 을 선택한다', async ({ launch, dataDir }) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('X=kept-$((1+1))\n')
  await newWorkspace(launched, 2)

  await page.keyboard.type('exit\n')

  await expect(cellItems(page)).toHaveCount(1)
  await expect(cellGroups(page).first()).toHaveClass(/selected/)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  await run(page, 'echo "x=$X"', 'x=kept-2')
})

test('마지막 workspace 가 닫혀도 창은 열려 있고, ⌘N 으로 다시 연다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  let closed = false
  app.once('close', () => (closed = true))

  await page.keyboard.type('exit\n')

  await expect(cellItems(page)).toHaveCount(0)
  await expect(page.locator('.terminal-view')).toHaveCount(0)
  await expect.poll(() => ptyFiles(dataDir)).toEqual(['app.sock'])
  await page.waitForTimeout(500)
  expect(closed).toBe(false)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  await newWorkspace(launched, 1)
  await run(page, 'echo again-$((4+4))', 'again-8')
})

test('앱을 끄면 열린 cell 의 pty 를 모두 종료한다', async ({ launch, dataDir }) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await run(page, 'echo three-$((1+2))', 'three-3')
  expect(sockets(dataDir)).toHaveLength(3)

  await app.close()

  expect(ptyFiles(dataDir)).toEqual([])
})

test('pty 를 잇는 utilityProcess 가 죽어도 cell 은 닫지 않는다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await run(page, 'echo set-$((3+3))', 'set-6')
  process.kill(await hostPid(app), 'SIGKILL')
  await expect(rows(page)).toContainText('disconnected from the pty')
  await expect(cellItems(page)).toHaveCount(2)
})

test('보이지 않는 동안 창 크기가 바뀐 cell 도 셸이 보는 크기가 화면과 맞다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  const before = await shellSize(page)

  await resizeBy(app, -200, -180)
  await expect.poll(async () => (await shellSize(page)).rows).toBeLessThan(before.rows)
  await cellItems(page).first().click()

  const size = await shellSize(page)
  expect(size.rows).toBe(await gridRows(page).count())
  expect(size.rows).toBeLessThan(before.rows)
})

test('보이지 않는 cell 의 셸이 끝나면 그것만 닫고, 선택과 입력은 그대로다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('sleep 1; exit\n')
  await newWorkspace(launched, 2)
  await page.keyboard.type('X=stay-$((1+1))\n')

  await expect(cellItems(page)).toHaveCount(1)
  await expect(cellGroups(page).first()).toHaveClass(/selected/)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  await run(page, 'echo "x=$X"', 'x=stay-2')
})

test('다른 곳을 눌러 터미널의 포커스가 빠진 뒤 선택된 cell 을 누르면 키 입력이 다시 터미널로 간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: '# 문서\n\n본문\n' })
  const sidebar = page.locator('.sidebar')
  const blurs = [
    () => page.locator('.canvas .markdown p').click(),
    async () => {
      const box = (await sidebar.boundingBox())!
      await sidebar.click({ position: { x: box.width / 2, y: box.height - 10 } })
    }
  ]

  for (const [i, blur] of blurs.entries()) {
    await blur()
    await expect(page.locator('.terminal-view.active .xterm-helper-textarea')).not.toBeFocused()
    await cellItems(page).first().click()
    await run(page, `echo back-$((${i}+10))`, `back-${i + 10}`)
  }
})

test('zsh 에서 cell 이름은 셸을 띄운 디렉토리에서 시작해 cd 를 따른다', async ({
  launch,
  dataDir
}) => {
  const long = 'a'.repeat(80)
  const home = zshHome(dataDir, 'proj', join('a b', '한글 폴더'), long)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await expect(cellPlaces(page)).toHaveText(['~'])
  await run(page, 'echo "mark=$MARK"', 'mark=rc-2')

  await page.keyboard.type('cd proj\n')
  await expect(cellPlaces(page)).toHaveText(['proj'])
  await page.keyboard.type("cd ~/'a b'\n")
  await expect(cellPlaces(page)).toHaveText(['a b'])
  await page.keyboard.type(
    `cd "$(printf '\\355\\225\\234\\352\\270\\200 \\355\\217\\264\\353\\215\\224')"\n`
  )
  await expect(cellPlaces(page)).toHaveText(['한글 폴더'])

  await page.keyboard.type(`cd ~/${long}\n`)
  await expect(cellPlaces(page)).toHaveText([long])
  const sidebar = page.locator('.sidebar')
  expect(await sidebar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0)
})

test('zsh 에서 ⌘N 은 선택된 cell 의 디렉토리에서 연다', async ({ launch, dataDir }) => {
  const home = zshHome(dataDir, 'proj')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(cellPlaces(page)).toHaveText(['proj'])

  await newWorkspace(launched, 2)

  await expect(cellPlaces(page)).toHaveText(['proj', 'proj'])
  await run(page, '[ "$PWD" = "$HOME/proj" ] && echo in-proj-$((1+1))', 'in-proj-2')
  await page.keyboard.type('cd ~\n')
  await expect(cellPlaces(page)).toHaveText(['proj', '~'])
})

test('zsh 에서 ⌘N 을 연달아 눌러도 선택된 cell 의 디렉토리에서 연다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'proj')
  const { app, page } = await launch({
    SHELL: '/bin/zsh',
    HOME: home,
    MARU_PTY_BIN: slowPtyBin(dataDir)
  })
  await expect(rows(page)).toContainText('%', { timeout: 10_000 })
  await page.keyboard.type('cd proj\n')
  await expect(cellPlaces(page)).toHaveText(['proj'])

  await pressNew(app)
  await expect(cellItems(page)).toHaveCount(2)
  await pressNew(app)

  await expect(cellPlaces(page)).toHaveText(['proj', 'proj', 'proj'], { timeout: 10_000 })
  await activeTerminal(page)
  await run(page, '[ "$PWD" = "$HOME/proj" ] && echo in-proj-$((1+1))', 'in-proj-2')
})

test('zsh 에서 호스트가 실린 OSC 7 은 이름과 ⌘N 의 디렉토리에 쓰지 않는다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'proj', 'remote')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(cellPlaces(page)).toHaveText(['proj'])

  // ssh 로 붙은 원격 셸처럼, 이 앱의 zsh 가 다시 OSC 7 을 보내지 않게 bash 로 바꾼다.
  await page.keyboard.type(
    `printf '\\e]7;file://remote.example%s\\a' "$HOME/remote"; exec bash --norc --noprofile\n`
  )
  await run(page, 'echo in-bash-$((1+1))', 'in-bash-2')
  await expect(cellPlaces(page)).toHaveText(['proj'])

  await newWorkspace(launched, 2)

  await expect(cellPlaces(page)).toHaveText(['proj', 'proj'])
  await run(page, '[ "$PWD" = "$HOME/proj" ] && echo in-proj-$((1+1))', 'in-proj-2')
})

test('zsh 에서 선택된 cell 의 디렉토리가 지워졌으면 ⌘N 은 홈에서 연다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'gone')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd gone\n')
  await expect(cellPlaces(page)).toHaveText(['gone'])
  rmSync(join(home, 'gone'), { recursive: true })

  await newWorkspace(launched, 2)

  await expect(cellPlaces(page)).toHaveText(['gone', '~'])
  await run(page, '[ "$PWD" = "$HOME" ] && echo at-home-$((1+1))', 'at-home-2')
})

test('zsh 에서 ⌘T 는 선택한 cell 바로 뒤(그 cell 이 앞서 띄운 것보다 앞)에 선택한 pane 의 디렉토리에서 cell 을 더해 선택한다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'proj')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await newWorkspace(launched, 2)
  await cellItems(page).nth(0).click()
  await page.keyboard.type(`maru cell new ${marked('spawned')} >/dev/null\n`)
  await expect(cellItems(page)).toHaveCount(3)
  await page.keyboard.type('cd proj\n')
  await expect(cellPlaces(page).nth(0)).toHaveText('proj')

  await newCell(launched, 4)

  await expect(workspaceNames(page)).toHaveCount(2)
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)
  await expect(cellViews(page).nth(2).locator('.xterm-rows')).toContainText('mark-spawned')
  await run(page, '[ "$PWD" = "$HOME/proj" ] && echo in-proj-$((1+1))', 'in-proj-2')
})

test('⌘T 로 연 cell 의 셸이 끝나면 그 cell 만 닫히고 workspace 는 남으며, 마지막 cell 이 닫히면 workspace 가 닫힌다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newCell(launched, 3)
  await expect(workspaceNames(page)).toHaveCount(2)

  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(2)
  await expect(workspaceNames(page)).toHaveCount(2)
  await activeTerminal(page)

  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(1)
  await expect(workspaceNames(page)).toHaveCount(1)
})

test('Next·Previous Cell 은 workspace 안의 cell 을 지나 다음 workspace 로 넘어가고, 끝에서는 처음으로 돈다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newCell(launched, 2)
  await newWorkspace(launched, 3)
  await cellItems(page).nth(0).click()
  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)
  for (const i of [1, 2, 0]) {
    await clickMenu(app, 'next-cell')
    await expect(cellGroups(page).nth(i)).toHaveClass(/selected/)
  }
  await clickMenu(app, 'previous-cell')
  await expect(cellGroups(page).nth(2)).toHaveClass(/selected/)
  await expect(workspaceNames(page)).toHaveCount(2)
})

test('workspace 가 없을 때 ⌘T 는 ⌘N 과 같다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveCount(0)

  await newCell(launched, 1)

  await expect(workspaceNames(page)).toHaveCount(1)
  await expect(cellGroups(page).first()).toHaveClass(/selected/)
  await run(page, 'echo back-$((1+1))', 'back-2')
})
