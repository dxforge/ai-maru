import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { killPty, killPtys } from '../src/main/pty'
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from '../src/shared/protocol'
import { STATE_VERSIONS } from '../src/shared/screen'
import {
  answerDialog,
  blockStateWrites,
  canvasTitles,
  canvasWidth,
  clickMenu,
  dialogCalls,
  DOM_RENDERER,
  END_EVERYTHING,
  expect,
  newCell,
  newWorkspace,
  dragCanvas,
  holdDialogs,
  openCanvas,
  openPalette,
  paneHeader,
  paneRows,
  programStatus,
  panes,
  readState,
  restartWith,
  rows,
  run,
  screen,
  serveRenderer,
  ptyDir,
  sockets,
  split,
  stateFile,
  shellSize,
  stubDialog,
  terminalRows,
  test,
  toast,
  keepWorkspace,
  toggleView,
  typesInto,
  cellGroups,
  workspaceHeads,
  cellFavorite,
  cellItems,
  cellPlaces,
  cellViews,
  workspaceNames,
  wrapPtyBin,
  zshHome,
  type Launched
} from './app'

async function shellUp(page: Launched['page'], i: number): Promise<void> {
  await panes(page).nth(i).locator('.xterm-screen').click()
  await typesInto(page, i, `up${i}`)
}

test('접은 채 닫은 workspace 의 key 를 재시작 뒤 새 workspace 가 다시 받아도 접힌 채 뜨지 않는다', async ({
  launch
}) => {
  const first = await launch()
  const { app, page } = first
  await newWorkspace(first, 2)
  await workspaceHeads(page).nth(1).click()
  await expect(cellItems(page)).toHaveCount(1)
  await clickMenu(app, 'close-workspace')
  await expect(workspaceHeads(page)).toHaveCount(1)

  await restartWith(app)
  const again = await launch()
  await newWorkspace(again, 2)
  await expect(workspaceHeads(again.page).nth(1)).toHaveAttribute('aria-expanded', 'true')
})

test('재시작 뒤 배치·포커스·선택·사이드바·보기 모드와 바꾼 workspace 이름이 같고 셸의 상태가 남는다', async ({
  launch
}) => {
  const first = await launch()
  const { app, page } = first
  await split(app, page, 'split-right', 2)
  await shellUp(page, 0)
  await shellUp(page, 1)
  await page.keyboard.type('export MARK=kept-$((1+1))\n')
  await clickMenu(app, 'rename-workspace')
  await expect(page.locator('.sidebar .workspace-name-input')).toBeFocused()
  await page.keyboard.type('renamed')
  await page.keyboard.press('Enter')
  await newWorkspace(first, 2)
  await shellUp(page, 0)
  await workspaceHeads(page).nth(1).click()
  await cellGroups(page).nth(0).locator('.pane-row').nth(1).click()
  await toggleView(first, 'columns')
  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)

  await restartWith(app)
  const { page: again } = await launch()
  await expect(again.locator('.sidebar')).toHaveClass(/collapsed/)
  await expect(again.locator('.terminals')).toHaveClass(/columns/)
  await expect(cellItems(again)).toHaveCount(1)
  await expect(workspaceHeads(again).nth(1)).toHaveAttribute('aria-expanded', 'false')
  await expect(workspaceNames(again).nth(0)).toHaveText('renamed')
  await expect(panes(again)).toHaveCount(2)
  await expect(panes(again).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await run(again, 'echo $MARK', 'kept-2')
})

test('single 보기에서 맨 앞이 아닌 cell 을 고른 채 재시작하면 그 cell 의 터미널이 입력을 받는다', async ({
  launch
}) => {
  const first = await launch()
  const { app, page } = first
  await newWorkspace(first, 2)
  await newCell(first, 3)
  await expect(cellViews(page).nth(2)).toHaveClass(/selected/)
  await typesInto(page, 0, 'up')

  await restartWith(app)
  const { page: again } = await launch()
  await expect(again.locator('.terminals')).toHaveClass(/single/)
  await expect(cellViews(again).nth(2)).toHaveClass(/selected/)
  await typesInto(again, 0, 'back')
})

test('재시작 뒤 Canvas 는 재시작 전에 끌어 정한 폭으로 열린다', async ({ launch }) => {
  const first = await launch()
  await openCanvas(first)
  const width = await dragCanvas(first.page, -70)

  await restartWith(first.app)
  const again = await launch()
  await openCanvas(again)
  await expect.poll(() => canvasWidth(again.page)).toBe(width)
})

test('재시작 뒤에도 pty 가 들고 있던 상태가 다시 붙을 때 돌아오고, 되살린 셸의 보고를 따른다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await shellUp(page, 1)
  await page.keyboard.type(programStatus('blocked', 'kind=permission'))
  await shellUp(page, 0)
  await page.keyboard.type(programStatus('working'))
  await expect(paneRows(page)).toHaveClass([/working/, /blocked/])
  await restartWith(app)
  const { page: again } = await launch()
  await expect(paneRows(again)).toHaveClass([/working/, /blocked/])
  await expect(paneHeader(again, 0)).toHaveClass(/working/)
  await expect(paneHeader(again, 1)).toHaveClass(/blocked/)
  await again.locator('.xterm-screen').first().click()
  await again.keyboard.type(programStatus('idle'))
  await expect(paneHeader(again, 0)).toHaveClass(/idle/)
})

test('앱이 꺼진 동안 셸이 보고한 cwd·제목을 다시 뜬 앱이 프롬프트 없이 보인다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await shellUp(page, 0)
  const moved = join(dataDir, 'moved')
  mkdirSync(moved)
  const go = join(dataDir, 'go')
  const reported = join(dataDir, 'reported')
  // 앱이 꺼진 뒤에 보고하게, 테스트가 `go` 를 만들 때까지 기다린다. 다시 뜬 앱에는 프롬프트가 새로 뜨지 않는다.
  await page.keyboard.type(
    `(while [ ! -e '${go}' ]; do sleep 0.1; done; printf '\\033]7;file://%s\\007\\033]2;while-down\\007' '${moved}'; touch '${reported}') &\n`
  )
  await restartWith(app)
  writeFileSync(go, '')
  await expect.poll(() => existsSync(reported)).toBe(true)

  const { page: again } = await launch()
  await expect(paneHeader(again, 0).locator('.title')).toHaveText('while-down')
  await expect(paneHeader(again, 0).locator('.cwd')).toHaveText('moved')
  await expect(cellPlaces(again)).toHaveText(['moved'])
})

test('다시 뜬 앱은 붙지 못하는 버전의 pty 가 있으면 그 pty 를 끄고 레이아웃만 되살려 새 셸을 띄우며, 붙을 수 있는 버전의 pty 는 Recovered workspace 에 열고 알린다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(DOM_RENDERER)
  await split(app, page, 'split-right', 2)
  for (const i of [0, 1]) {
    await shellUp(page, i)
    await run(page, `X=kept-$((40+2)); echo set-$((${i}+1))`, `set-${i + 1}`)
  }
  await restartWith(app)
  const [other, same] = readState(dataDir).sessions.ptys.map((p: { pty: string }) => p.pty)
  const record = join(ptyDir(dataDir), `${other}.json`)
  writeFileSync(
    record,
    JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), protocol_version: 999 })
  )

  const { page: again } = await launch(DOM_RENDERER)
  await expect(
    toast(again).filter({ hasText: "Couldn't reattach to the terminals" })
  ).toContainText('because its pty protocol version is unsupported or unknown')
  await expect(toast(again).filter({ hasText: 'Terminals moved to Recovered' })).toHaveCount(1)
  await expect(workspaceNames(again).last()).toHaveText('Recovered')
  await expect(cellItems(again)).toHaveCount(2)
  await expect(cellViews(again).nth(0).locator('.pane')).toHaveCount(2)
  await expect(panes(again).filter({ hasText: 'pty had ended' })).toHaveCount(0)
  await run(again, 'echo "fresh-$((1+1)) x=$X"', 'fresh-2 x=\n')
  await cellItems(again).nth(1).click()
  await run(again, 'echo "x=$X"', 'x=kept-42')
  const now = sockets(dataDir).map((sock) => basename(sock, '.sock'))
  expect(now).toContain(same)
  expect(now).not.toContain(other)
})

test('재시작 동안 끝난 pty 의 pane 은 이유를 보인 뒤 같은 pane 에 저장한 cwd 로 새 셸을 띄운다', async ({
  launch,
  dataDir
}) => {
  // bash 는 cwd 를 알리지 않아, 저장할 cwd 가 생기도록 zsh 로 띄운다.
  const zsh = { SHELL: '/bin/zsh', HOME: zshHome(dataDir, 'moved') }
  const moved = join(zsh.HOME, 'moved')
  const { app, page } = await launch({ ...DOM_RENDERER, ...zsh })
  await split(app, page, 'split-right', 2)
  await shellUp(page, 0)
  await shellUp(page, 1)
  await run(page, `cd '${moved}'; X=old; echo in-$((1+1))`, 'in-2')
  await expect.poll(() => readState(dataDir).panes?.rows?.[1]?.cwd).toBe(moved)
  await restartWith(app)
  const second: string = readState(dataDir).sessions.ptys[1].pty
  await killPty(ptyDir(dataDir), second)

  const { page: shown } = await launch({ ...DOM_RENDERER, ...zsh })
  await expect(panes(shown)).toHaveCount(2)
  const gone = panes(shown).filter({ hasText: 'the pty had ended; trying to start a new shell' })
  await expect(gone).toHaveCount(1)
  await gone.locator('.xterm-screen').click()
  await run(shown, 'echo "at=$PWD x=$X"', `at=${moved} x=`)
  // 문구를 셸 화면 위에 끼우고도 커서가 셸이 아는 자리에 있어야, 친 명령이 프롬프트 뒤에 붙는다.
  await expect(gone.locator('.xterm-rows')).toContainText('% echo "at=$PWD')
  await expect(toast(shown)).toHaveCount(0)
})

test('명령으로 띄운 pane 의 pty 가 재시작 동안 끝났으면 명령을 다시 돌리지 않고 셸을 띄운다', async ({
  launch,
  dataDir
}) => {
  const ran = join(dataDir, 'ran')
  const { app, page } = await launch(DOM_RENDERER)
  await run(page, `maru pane new sh -c 'echo x >> ${ran}; read x'; echo made-$((1+1))`, 'made-2')
  await expect(panes(page)).toHaveCount(2)
  await expect.poll(readResult(ran)).toBe('x')
  await restartWith(app)
  const saved = readState(dataDir)
  const commandPane = saved.panes.rows[1].id
  const pty = saved.sessions.ptys.find((p: { pane: string }) => p.pane === commandPane).pty
  await killPty(ptyDir(dataDir), pty)

  const { page: again } = await launch(DOM_RENDERER)
  await expect(panes(again)).toHaveCount(2)
  const gone = panes(again).nth(1)
  await expect(gone).toContainText('the pty had ended; trying to start a new shell')
  await gone.locator('.xterm-screen').click()
  await run(again, 'echo shell-$((1+1))', 'shell-2')
  expect(readFileSync(ran, 'utf8')).toBe('x\n')
  await expect.poll(() => readState(dataDir).panes.rows[1].command).toBeUndefined()
})

test('앱이 강제로 끝나도 다음 실행은 살아 있는 셸에 다시 붙는다', async ({ launch, dataDir }) => {
  const first = await launch()
  await run(first.page, 'X=crash-$((40+2)); echo set-$((1+1))', 'set-2')
  await expect.poll(() => readState(dataDir).sessions?.ptys?.length).toBe(1)
  const closed = new Promise<void>((resolve) => first.app.once('close', () => resolve()))
  first.app.process().kill('SIGKILL')
  await closed

  const { page } = await launch()
  await run(page, 'echo "x=$X"', 'x=crash-42')
  await expect(toast(page)).toHaveCount(0)
})

test('앱이 강제로 끝나 sessions 에 없는 pty 가 남으면 다음 실행은 그 pty 를 Recovered workspace 에 열고 알린다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  await run(first.page, 'echo left-$((1+1))', 'left-2')
  await expect.poll(() => readState(dataDir).sessions?.ptys?.length).toBe(1)
  const closed = new Promise<void>((resolve) => first.app.once('close', () => resolve()))
  first.app.process().kill('SIGKILL')
  await closed
  // 앱이 pty 를 띄운 뒤 sessions 를 쓰기 전에 끝난 것과 같은 상태를 만든다.
  const saved = readState(dataDir)
  writeFileSync(
    stateFile(dataDir),
    JSON.stringify({ ...saved, sessions: { ...saved.sessions, ptys: [] } })
  )

  const { page } = await launch()
  await expect(toast(page).filter({ hasText: 'Terminals moved to Recovered' })).toHaveCount(1)
  await expect(workspaceNames(page).last()).toHaveText('Recovered')
})

test('앱과 pty 가 함께 끝났으면 다음 실행은 레이아웃을 되살리고 pane 마다 새 셸을 띄우며 알리지 않는다', async ({
  launch,
  dataDir
}) => {
  const first = await launch(DOM_RENDERER)
  await split(first.app, first.page, 'split-right', 2)
  await shellUp(first.page, 1)
  await expect.poll(() => readState(dataDir).sessions?.ptys?.length).toBe(2)
  const closed = new Promise<void>((resolve) => first.app.once('close', () => resolve()))
  first.app.process().kill('SIGKILL')
  await closed
  await killPtys(ptyDir(dataDir))

  const { page } = await launch(DOM_RENDERER)
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page).filter({ hasText: 'the pty had ended' })).toHaveCount(2)
  await expect(toast(page)).toHaveCount(0)
  await run(page, 'echo back-$((1+1))', 'back-2')
})

const dirRows = (page: Launched['page']) => page.locator('.sidebar .dir-row')

test('state.json 의 cells 를 읽지 못하면 keep 을 켠 workspace 만 이름·즐겨찾기와 함께 cell 없이 되살리고, 살아 있는 pty 는 띄운 순서로 Recovered workspace 에 cell 하나씩으로 열며 알린다', async ({
  launch,
  dataDir
}) => {
  const shell = { SHELL: '/bin/zsh', HOME: zshHome(dataDir, 'sub') }
  const first = await launch(shell)
  await clickMenu(first.app, 'rename-workspace')
  await expect(first.page.locator('.sidebar .workspace-name-input')).toBeFocused()
  await first.page.keyboard.type('atlas')
  await first.page.keyboard.press('Enter')
  await run(first.page, 'cd sub && X=first-$((1+1)) && echo in-$((1+1))', 'in-2')
  await keepWorkspace(first.page, 0)
  await cellItems(first.page).nth(0).hover()
  await cellFavorite(first.page, 0).click()
  await expect(cellFavorite(first.page, 0)).toHaveAttribute('aria-pressed', 'true')
  await newWorkspace(first, 2)
  await expect.poll(() => sockets(dataDir)).toHaveLength(2)
  await restartWith(first.app)
  const saved = readState(dataDir)
  saved.cells.version = 999
  writeFileSync(stateFile(dataDir), JSON.stringify(saved))
  const old = sockets(dataDir)

  const { page } = await launch(shell)
  await expect(toast(page).filter({ hasText: "Couldn't restore the cells" })).toHaveCount(1)
  await expect(toast(page).filter({ hasText: 'Terminals moved to Recovered' })).toHaveCount(1)
  await expect(workspaceNames(page)).toHaveText(['atlas', 'Recovered'])
  await expect(dirRows(page)).toHaveText(['~/sub'])
  await expect(page.locator('.sidebar .dir-card .more')).toHaveText('+1')
  await expect(cellItems(page)).toHaveCount(2)
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
  await cellItems(page).nth(0).click()
  await run(page, 'echo "x=$X"', 'x=first-2')
  expect(sockets(dataDir).sort()).toEqual(old.sort())
})

async function keepAs(launched: Launched, name: string): Promise<void> {
  await clickMenu(launched.app, 'rename-workspace')
  await expect(launched.page.locator('.sidebar .workspace-name-input')).toBeFocused()
  await launched.page.keyboard.type(name)
  await launched.page.keyboard.press('Enter')
  await expect(workspaceNames(launched.page).nth(0)).toHaveText(name)
  await clickMenu(launched.app, 'toggle-keep-workspace')
  await expect(workspaceHeads(launched.page).nth(0).locator('.keep')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
}

test('state.json 의 panes 를 읽지 못하면 cell 마다 workspace 의 dir 에서 셸 하나를 띄우고, 살아 있는 pty 는 Recovered workspace 에 열며 알린다', async ({
  launch,
  dataDir
}) => {
  // bash 는 cwd 를 알리지 않아, workspace 의 dir 이 생기도록 zsh 로 띄운다.
  const zsh = { SHELL: '/bin/zsh', HOME: zshHome(dataDir, 'sub') }
  const sub = join(zsh.HOME, 'sub')
  const first = await launch(zsh)
  await run(first.page, `cd '${sub}'; X=old; echo in-$((1+1))`, 'in-2')
  await expect.poll(() => readState(dataDir).panes?.rows?.[0]?.cwd).toBe(sub)
  await split(first.app, first.page, 'split-right', 2)
  await expect.poll(() => sockets(dataDir)).toHaveLength(2)
  await restartWith(first.app)
  const saved = readState(dataDir)
  expect(saved.workspaces.rows[0].dir).toBe(sub)
  saved.panes.version = 999
  writeFileSync(stateFile(dataDir), JSON.stringify(saved))
  const old = sockets(dataDir)

  const { page } = await launch(zsh)
  await expect(toast(page).filter({ hasText: "Couldn't restore the panes" })).toHaveCount(1)
  await expect(toast(page).filter({ hasText: 'Terminals moved to Recovered' })).toHaveCount(1)
  await expect(cellItems(page)).toHaveCount(3)
  await expect(workspaceNames(page).last()).toHaveText('Recovered')
  await expect(cellViews(page).nth(0).locator('.pane')).toHaveCount(1)
  await run(page, 'echo "at=$PWD x=$X"', `at=${sub} x=\n`)
  await cellItems(page).nth(1).click()
  await run(page, 'echo "x=$X"', 'x=old')
  expect(sockets(dataDir)).toEqual(expect.arrayContaining(old))
})

test('state.json 의 workspaces 를 읽지 못하면 cell 과 셸은 되살리고, 이름·keep 을 잃었다고 알린다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  await keepAs(first, 'atlas')
  await run(first.page, 'export MARK=kept-$((1+1)) && echo set-$((2+2))', 'set-4')
  await restartWith(first.app)
  const saved = readState(dataDir)
  saved.workspaces.version = 999
  writeFileSync(stateFile(dataDir), JSON.stringify(saved))

  const { page } = await launch()
  await expect(toast(page)).toContainText("Couldn't restore workspace details")
  await expect(workspaceNames(page)).toHaveCount(1)
  await expect(workspaceNames(page).nth(0)).not.toHaveText('atlas')
  await run(page, 'echo $MARK', 'kept-2')
})

test('End everything 으로 끈 뒤에도 접어 둔 keep 을 켠 workspace 는 접힌 채 뜬다', async ({
  launch
}) => {
  const first = await launch()
  await keepAs(first, 'atlas')
  await newWorkspace(first, 2)
  await workspaceHeads(first.page).nth(0).click()
  await expect(workspaceHeads(first.page).nth(0)).toHaveAttribute('aria-expanded', 'false')
  await first.app.close()

  const { page } = await launch()
  await expect(workspaceNames(page).nth(0)).toHaveText('atlas')
  await expect(workspaceHeads(page).nth(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(workspaceHeads(page).nth(1)).toHaveAttribute('aria-expanded', 'true')
})

test('재시작 뒤 maru pane new 가 되살린 pane 을 나눈다', async ({ launch }) => {
  const { app, page: first } = await launch()
  await shellUp(first, 0)
  await restartWith(app)
  const { page } = await launch()
  await page.keyboard.type(`"$MARU_CLI" pane new -- sh -c 'echo split-$((1+1)); sleep 5'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect(screen(page, 1)).toShow('split-2')
})

function callOnReturn(command: string, out: string): string {
  const cli = '"$MARU_CLI"'
  return (
    `(while ${cli} ping >/dev/null 2>&1; do sleep 0.02; done; ` +
    `until ${cli} ping >/dev/null 2>&1; do sleep 0.01; done; ` +
    `${cli} ${command} >/dev/null 2>'${out}.err'; echo "code=$? $(cat '${out}.err')" > '${out}') &\n`
  )
}

function readResult(out: string): () => string | null {
  return () => (existsSync(out) ? readFileSync(out, 'utf8').trim() : null)
}

test('재시작 직후 선택하지 않은 cell 의 남은 pty 가 곧바로 부른 maru cell new 는 그 cell 의 workspace 안, 그 cell 뒤에 띄운다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  const { app, page } = first
  await newWorkspace(first, 2)
  await newWorkspace(first, 3)
  await cellItems(page).nth(1).click()
  await run(page, 'echo up-$((1+1))', 'up-2')
  const out = join(dataDir, 'cell-new')
  await page.keyboard.type(callOnReturn(`cell new bash -c 'echo mark-new; read x'`, out))
  await cellItems(page).nth(0).click()
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
  await restartWith(app)
  const { page: again } = await launch()
  await expect.poll(readResult(out), { timeout: 15_000 }).toBe('code=0')
  await expect(cellItems(again)).toHaveCount(4)
  await expect(workspaceNames(again)).toHaveCount(3)
  await expect(screen(again, cellViews(again).nth(2).locator('.pane'))).toShow('mark-new')
})

test('재시작 직후 남은 pty 가 곧바로 부른 maru cell new --before 는 가리킨 cell 앞에 띄운다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  const { app, page } = first
  await newWorkspace(first, 2)
  await newWorkspace(first, 3)
  await cellItems(page).nth(1).click()
  await run(page, 'echo up-$((1+1))', 'up-2')
  const out = join(dataDir, 'cell-new-before')
  await page.keyboard.type(
    callOnReturn(`cell new --before $MARU_PTY_ID bash -c 'echo mark-new; read x'`, out)
  )
  await cellItems(page).nth(0).click()
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
  await restartWith(app)
  const { page: again } = await launch()
  await expect.poll(readResult(out), { timeout: 15_000 }).toBe('code=0')
  await expect(cellItems(again)).toHaveCount(4)
  await expect(workspaceNames(again)).toHaveCount(3)
  await expect(screen(again, cellViews(again).nth(1).locator('.pane'))).toShow('mark-new')
})

test('재시작 직후 남은 pty 가 곧바로 부른 maru pane new 는 그 pane 을 나눈다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await shellUp(page, 0)
  const out = join(dataDir, 'pane-new')
  await page.keyboard.type(callOnReturn(`pane new -- sh -c 'echo split-$((1+1)); sleep 5'`, out))
  await restartWith(app)
  const { page: again } = await launch()
  await expect.poll(readResult(out), { timeout: 15_000 }).toBe('code=0')
  await expect(panes(again)).toHaveCount(2)
  await expect(screen(again, 1)).toShow('split-2')
})

test('재시작 직후 남은 pty 가 곧바로 부른 maru canvas put 은 창이 준비된 뒤 문서를 띄우고 성공한다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await shellUp(page, 0)
  const doc = join(dataDir, 'restarted.md')
  writeFileSync(doc, '# Restarted\n')
  const out = join(dataDir, 'canvas-put')
  await page.keyboard.type(callOnReturn(`canvas put --title restarted '${doc}'`, out))
  await restartWith(app)
  const { page: again } = await launch()
  await expect.poll(readResult(out), { timeout: 15_000 }).toBe('code=0')
  await expect(canvasTitles(again)).toHaveText(['restarted'])
  await expect(again.locator('.canvas .markdown h1')).toHaveText('Restarted')
})

test('재시작 전에 maru cell new 가 찍은 cell id 로 재시작 뒤에도 maru pane new --cell 이 그 cell 에 띄운다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const saved = join(dataDir, 'cell-id')
  await run(
    page,
    `maru cell new bash -c 'read x' | awk 'NR == 2 { print $2 }' > '${saved}'; echo saved-$((1+1))`,
    'saved-2'
  )
  await expect(cellItems(page)).toHaveCount(2)
  await restartWith(app)
  const { page: again } = await launch()
  await expect(cellItems(again)).toHaveCount(2)
  await shellUp(again, 0)
  await run(
    again,
    `maru pane new --cell $(cat '${saved}') bash -c 'echo mark-added; read x'; echo code-$?`,
    /p-[0-9a-f]{8}\s*code-0/
  )
  await expect(cellViews(again).nth(1).locator('.pane')).toHaveCount(2)
  await expect(screen(again, cellViews(again).nth(1).locator('.pane').nth(1))).toShow('mark-added')
})

test('재시작한 뒤 End everything 으로 끄면 되살린 pty 도 끈다', async ({ launch, dataDir }) => {
  const { app, page: first } = await launch()
  await shellUp(first, 0)
  await restartWith(app)
  expect(sockets(dataDir)).toHaveLength(1)
  const { app: again, page } = await launch()
  await run(page, 'echo back-$((1+1))', 'back-2')
  await stubDialog(again, END_EVERYTHING)
  await again.close()
  expect(sockets(dataDir)).toEqual([])
})

/** 설치본의 `maru-pty` 가 `min` 부터 `max` 까지의 버전을 받는다고 답하게 한다. 띄우는 pty 는 지금 버전이다. */
function installedProtocols(dataDir: string, min: number, max: number): Record<string, string> {
  const bin = wrapPtyBin(
    dataDir,
    'other-protocol',
    [
      `[ "$1" = --protocol-version ] && { echo ${max}; exit 0; }`,
      `[ "$1" = --min-protocol-version ] && { echo ${min}; exit 0; }`
    ].join('\n')
  )
  return { MARU_PTY_BIN: bin }
}

const otherProtocolBin = (dataDir: string): Record<string, string> =>
  installedProtocols(dataDir, PROTOCOL_VERSION + 1, PROTOCOL_VERSION + 1)

function rewriteProtocol(dataDir: string, pty: string, version: number): void {
  const record = join(ptyDir(dataDir), `${pty}.json`)
  writeFileSync(
    record,
    JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), protocol_version: version })
  )
}

test('앱의 버전이 pty 의 버전보다 높아도 그 pty 의 버전으로 요청해 붙고, 재시작 뒤 다시 붙어 재생·입력·크기·상태 표시가 된다', async ({
  launch
}) => {
  const newer = { ...DOM_RENDERER, MARU_TEST_PROTOCOL_VERSION: String(PROTOCOL_VERSION + 1) }
  const { app, page } = await launch(newer)
  await split(app, page, 'split-right', 2)
  await shellUp(page, 1)
  await page.keyboard.type(programStatus('blocked', 'kind=permission'))
  await shellUp(page, 0)
  await run(page, 'X=kept-$((40+2)); echo set-$((1+1))', 'set-2')
  await expect(paneHeader(page, 1)).toHaveClass(/blocked/)
  await restartWith(app)

  const { page: again } = await launch(newer)
  await expect(paneHeader(again, 1)).toHaveClass(/blocked/)
  await expect(screen(again, 0)).toShow('set-2')
  await again.locator('.xterm-screen').first().click()
  await run(again, 'echo "x=$X"', 'x=kept-42')
  expect((await shellSize(again)).rows).toBe(await terminalRows(screen(again, 0)))
  await expect(workspaceNames(again)).not.toContainText(['Recovered'])
  await expect(toast(again)).toHaveCount(0)
})

test('설치본이 받는 버전의 범위 안이면 설치본의 버전이 달라도 묻지 않고 pty 를 남긴 채 재시작하고, 다시 뜬 앱이 그 pty 에 붙는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(
    installedProtocols(dataDir, PROTOCOL_VERSION, PROTOCOL_VERSION + 1)
  )
  await run(page, 'X=kept-$((40+2)); echo set-$((1+1))', 'set-2')
  await expect.poll(() => readState(dataDir).sessions?.ptys?.length).toBe(1)
  await holdDialogs(app)
  // 대화창이 뜨면 `holdDialogs` 가 답하지 않아 앱이 끝나지 않으므로 `restartWith` 가 실패한다.
  await restartWith(app)
  expect(sockets(dataDir)).toHaveLength(1)

  const { page: again } = await launch()
  await run(again, 'echo "x=$X"', 'x=kept-42')
  await expect(workspaceNames(again)).not.toContainText(['Recovered'])
})

test('설치본이 붙지 못하는 pty 만 끈다고 세어 묻고, 확인하면 그 pty 만 끄며 다시 뜬 앱은 남긴 pty 를 Recovered workspace 에 연다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch({
    ...DOM_RENDERER,
    ...installedProtocols(dataDir, PROTOCOL_VERSION, PROTOCOL_VERSION + 1)
  })
  await split(app, page, 'split-right', 2)
  for (const i of [0, 1]) {
    await shellUp(page, i)
    await run(page, `X=kept-$((40+2)); echo set-$((${i}+1))`, `set-${i + 1}`)
  }
  await expect.poll(() => readState(dataDir).sessions?.ptys?.length).toBe(2)
  const [older, kept] = readState(dataDir).sessions.ptys.map((p: { pty: string }) => p.pty)
  rewriteProtocol(dataDir, older, MIN_PROTOCOL_VERSION - 1)
  await holdDialogs(app)
  await clickMenu(app, 'restart')
  await expect.poll(() => dialogCalls(app)).toHaveLength(1)
  expect((await dialogCalls(app))[0]).toMatchObject({
    message: 'Restart with layout only?',
    detail: `The installed app can't reattach to terminals that use pty protocol version ${MIN_PROTOCOL_VERSION - 1}. This will end 1 terminal. The panes will reopen with new shells in their last directories. 1 terminal will keep running in a new workspace named Recovered.`
  })
  await restartWith(app, () => answerDialog(app, 0, 0))
  expect(sockets(dataDir).map((sock) => basename(sock, '.sock'))).toEqual([kept])

  const { page: again } = await launch(DOM_RENDERER)
  await expect(workspaceNames(again).last()).toHaveText('Recovered')
  await expect(cellItems(again)).toHaveCount(2)
  await expect(cellViews(again).nth(0).locator('.pane')).toHaveCount(2)
  await cellItems(again).nth(1).click()
  await run(again, 'echo "x=$X id=$MARU_PTY_ID"', `x=kept-42 id=${kept}`)
})

function otherVersions(
  dataDir: string,
  part: 'workspaces' | 'cells' | 'panes' | 'sessions'
): Record<string, string> {
  const file = join(dataDir, 'installed-versions.json')
  writeFileSync(file, JSON.stringify({ ...STATE_VERSIONS, [part]: STATE_VERSIONS[part] + 1 }))
  return { MARU_STATE_VERSIONS_FILE: file }
}

test('pty 프로토콜이 다르면 레이아웃만 되살릴지 묻고, 취소하면 재시작하지 않는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(otherProtocolBin(dataDir))
  await run(page, 'echo up-$((1+1))', 'up-2')
  await expect.poll(() => readState(dataDir).sessions?.ptys?.length).toBe(1)
  await stubDialog(app, 1)
  await clickMenu(app, 'restart')
  await expect.poll(() => dialogCalls(app)).toHaveLength(1)
  expect((await dialogCalls(app))[0]).toMatchObject({
    message: 'Restart with layout only?',
    detail: expect.stringContaining(
      `The installed app can't reattach to terminals that use pty protocol version ${PROTOCOL_VERSION}.`
    ),
    buttons: ['Restart with layout only', 'Cancel']
  })
  expect((await dialogCalls(app))[0].detail).toContain('This will end 1 terminal.')
  await run(page, 'echo still-$((1+1))', 'still-2')
  expect(readState(dataDir).sessions).not.toBeNull()
})

test('pty 프로토콜이 달라도 확인하면 pty 를 끄고 재시작하고, 다시 뜬 앱은 레이아웃만 되살리며 알리지 않는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(otherProtocolBin(dataDir))
  await split(app, page, 'split-right', 2)
  await run(page, 'echo up-$((1+1))', 'up-2')
  await expect.poll(() => sockets(dataDir)).toHaveLength(2)
  await stubDialog(app, 0)
  await restartWith(app)
  expect(sockets(dataDir)).toEqual([])
  expect(readState(dataDir)).toMatchObject({
    sessions: null,
    cells: { version: STATE_VERSIONS.cells },
    panes: { version: STATE_VERSIONS.panes }
  })

  const again = await launch()
  await expect(panes(again.page)).toHaveCount(2)
  await expect(toast(again.page)).toHaveCount(0)
})

test('cells 형식이 다른 빌드로는 cell 을 모두 닫고 재시작할지 묻고, 확인하면 pty 를 남긴 채 재시작하고 다음 실행은 pty 를 Recovered workspace 에 열며 알리지 않는다', async ({
  launch,
  dataDir
}) => {
  const first = await launch(otherVersions(dataDir, 'cells'))
  await newWorkspace(first, 2)
  await expect.poll(() => sockets(dataDir)).toHaveLength(2)
  await stubDialog(first.app, 1)
  await clickMenu(first.app, 'restart')
  await expect
    .poll(() => dialogCalls(first.app))
    .toMatchObject([
      {
        message: 'Restart and close all cells?',
        detail: expect.stringContaining(
          'a different saved-state format for the cells. All cells will close. 2 terminals will keep running in a new workspace named Recovered.'
        ),
        buttons: ['Restart and close all cells', 'Cancel']
      }
    ])
  await stubDialog(first.app, 0)
  await restartWith(first.app)
  expect(readState(dataDir).cells).toBeNull()
  expect(sockets(dataDir)).toHaveLength(2)

  const { page } = await launch()
  await expect(workspaceNames(page)).toHaveText(['Recovered'])
  await expect(cellItems(page)).toHaveCount(2)
  await expect(toast(page)).toHaveCount(0)
})

test('panes 형식이 다른 빌드로는 cell 마다 셸 하나로 재시작할지 묻고, 확인하면 다음 실행은 cell 을 남기고 셸 하나로 뜨며 pty 는 Recovered workspace 에 열고 알리지 않는다', async ({
  launch,
  dataDir
}) => {
  const first = await launch(otherVersions(dataDir, 'panes'))
  await split(first.app, first.page, 'split-right', 2)
  await expect(panes(first.page)).toHaveCount(2)
  await expect.poll(() => sockets(dataDir)).toHaveLength(2)
  await stubDialog(first.app, 1)
  await clickMenu(first.app, 'restart')
  await expect
    .poll(() => dialogCalls(first.app))
    .toMatchObject([
      {
        message: 'Restart with one shell per cell?',
        detail: expect.stringContaining(
          'a different saved-state format for the panes. Each cell will reopen with one new shell. 2 terminals will keep running in a new workspace named Recovered.'
        ),
        buttons: ['Restart with one shell per cell', 'Cancel']
      }
    ])
  await stubDialog(first.app, 0)
  await restartWith(first.app)
  expect(readState(dataDir).panes).toBeNull()
  expect(readState(dataDir).cells?.rows).toHaveLength(1)
  expect(sockets(dataDir)).toHaveLength(2)

  const { page } = await launch()
  await expect(cellItems(page)).toHaveCount(3)
  await expect(cellViews(page).nth(0).locator('.pane')).toHaveCount(1)
  await expect(workspaceNames(page).last()).toHaveText('Recovered')
  await expect(toast(page)).toHaveCount(0)
})

test('workspaces 형식만 다른 빌드로는 workspace 의 이름·즐겨찾기·keep 을 잃고 재시작할지 묻고, 확인하면 pty 를 남긴 채 재시작한다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(otherVersions(dataDir, 'workspaces'))
  await run(page, 'export MARK=kept-$((1+1)) && echo set-$((2+2))', 'set-4')
  await expect.poll(() => readState(dataDir).sessions?.ptys?.length).toBe(1)
  await stubDialog(app, 1)
  await clickMenu(app, 'restart')
  await expect
    .poll(() => dialogCalls(app))
    .toMatchObject([
      {
        message: 'Restart and lose workspace details?',
        detail: expect.stringContaining('a different saved-state format for the workspaces.'),
        buttons: ['Restart and lose workspace details', 'Cancel']
      }
    ])
  expect((await dialogCalls(app))[0].detail).not.toContain('This will end')
  await stubDialog(app, 0)
  await restartWith(app)
  expect(sockets(dataDir)).toHaveLength(1)
  expect(readState(dataDir).workspaces).toBeNull()

  const again = await launch()
  await run(again.page, 'echo $MARK', 'kept-2')
})

test('maru app restart 로 재시작한다', async ({ launch, dataDir }) => {
  const done = join(dataDir, 'done.txt')
  const { app, page } = await launch()
  await split(app, page, 'split-down', 2)
  await shellUp(page, 0)
  await shellUp(page, 1)
  await restartWith(app, () =>
    page.keyboard.type(`"$MARU_CLI" app restart; echo "cli=$?" > '${done}'\n`)
  )
  const { page: again } = await launch()
  await expect(panes(again)).toHaveCount(2)
  await run(again, `cat '${done}'`, 'cli=0')
})

test('버전이 달라도 maru app restart --kill-ptys 는 레이아웃만 남기고 재시작한다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(otherProtocolBin(dataDir))
  await shellUp(page, 0)
  await restartWith(app, () => page.keyboard.type('"$MARU_CLI" app restart --kill-ptys\n'))
  expect(readState(dataDir)).toMatchObject({
    sessions: null,
    cells: { version: STATE_VERSIONS.cells },
    panes: { version: STATE_VERSIONS.panes }
  })
})

test('화면을 저장하지 못하면 maru app restart 는 실패하고 앱은 그대로다', async ({
  launch,
  dataDir
}) => {
  blockStateWrites(dataDir)
  const { page } = await launch()
  await run(page, '"$MARU_CLI" app restart; echo "cli=$?"', 'cli=1')
  await run(page, 'echo still-$((1+1))', 'still-2')
})

test('버전이 다르면 maru app restart 는 이유를 보이고 재시작하지 않는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch(otherProtocolBin(dataDir))
  await run(page, '"$MARU_CLI" app restart', 'Pass --kill-ptys to restart with the layout only.')
  await run(page, 'echo still-$((1+1))', 'still-2')
})

test('Restart 는 앱 메뉴의 Quit 바로 위에 있다', async ({ launch }) => {
  const { app } = await launch()
  const items = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.items[0].submenu!.items.map((i) => i.id ?? i.role ?? '')
  )
  expect(items.slice(-2)).toEqual(['restart', 'quit'])
})

test('dev 서버로 띄운 앱에는 Restart 가 없다', async ({ launch, defer }) => {
  const url = await serveRenderer(defer)
  const launched: Launched = await launch({ ELECTRON_RENDERER_URL: url })
  const item = await launched.app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('restart') !== null
  )
  expect(item).toBe(false)
  await openPalette(launched)
  await launched.page.keyboard.type('restart')
  await expect(launched.page.locator('.palette .item')).toHaveCount(0)
  await expect(launched.page.locator('.palette .empty')).toBeVisible()
})

test('팔레트에서 Restart 를 고르면 재시작한다', async ({ launch }) => {
  const launched = await launch()
  await shellUp(launched.page, 0)
  await restartWith(launched.app, async () => {
    await openPalette(launched)
    await launched.page.keyboard.type('restart')
    await launched.page.keyboard.press('Enter')
  })
})

test('columns 보기로 재시작해도 재시작 전 출력이 좁은 폭으로 접히지 않는다', async ({ launch }) => {
  const first = await launch(DOM_RENDERER)
  const { app, page } = first
  await split(app, page, 'split-right', 2)
  await toggleView(first, 'columns')
  for (const i of [0, 1]) {
    await panes(page).nth(i).locator('.xterm-screen').click()
    await typesInto(page, i, `wide${i}-abcdefghijklmnopqrstuvwxyz`)
  }

  await restartWith(app)
  const { page: again } = await launch(DOM_RENDERER)
  // 행 div 를 이어 붙이는 textContent 로는 접힌 줄도 한 줄로 이어져 통과하므로 innerText 의 줄로 본다.
  for (const i of [0, 1]) {
    // 창보다 넓은 columns 보기에서 화면 밖 pane 은 xterm 이 렌더링을 멈추므로, 받은 출력이 DOM 에 그려지지 않는다.
    await panes(again).nth(i).scrollIntoViewIfNeeded()
    await expect
      .poll(async () => (await panes(again).nth(i).locator('.xterm-rows').innerText()).split('\n'))
      .toContain(`wide${i}-abcdefghijklmnopqrstuvwxyz-2`)
  }
})

test('columns 보기로 재시작한 뒤 대체 화면을 나가도 그 아래 출력이 접히지 않는다', async ({
  launch
}) => {
  const first = await launch(DOM_RENDERER)
  const { app, page } = first
  await toggleView(first, 'columns')
  await typesInto(page, 0, 'under-abcdefghijklmnopqrstuvwxyz')
  await run(page, "printf '\\033[?1049h'; echo alt-$((1+1))", 'alt-2')

  await restartWith(app)
  const { page: again } = await launch(DOM_RENDERER)
  await run(again, "printf '\\033[?1049l'; echo back-$((1+1))", 'back-2')
  expect((await rows(again).innerText()).split('\n')).toContain(
    'under-abcdefghijklmnopqrstuvwxyz-2'
  )
})
