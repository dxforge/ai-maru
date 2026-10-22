import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { killSession } from '../src/main/session'
import {
  activeHeader,
  activeTerminal,
  canvasWidth,
  claudeConfig,
  claudeFile,
  claudeHook,
  clickMenu,
  expect,
  newWorkspace,
  dragCanvas,
  openCanvas,
  openPalette,
  paneHeader,
  paneRows,
  paneTerminalRows,
  panes,
  restartWith,
  rows,
  run,
  serveRenderer,
  sessionDir,
  sockets,
  split,
  test,
  toggleView,
  typesInto,
  workspaceGroups,
  workspaceItems,
  workspaceViews,
  wrapSessionBin,
  type Launched
} from './app'

async function shellUp(page: Launched['page'], i: number): Promise<void> {
  await panes(page).nth(i).locator('.xterm-screen').click()
  await typesInto(page, i, `up${i}`)
}

test('재시작 뒤 배치·포커스·선택·사이드바·보기 모드가 같고 셸의 상태가 남는다', async ({
  launch
}) => {
  const first = await launch()
  const { app, page } = first
  await split(app, page, 'split-right', 2)
  await shellUp(page, 0)
  await shellUp(page, 1)
  await page.keyboard.type('export MARK=kept-$((1+1))\n')
  await newWorkspace(first, 2)
  await shellUp(page, 0)
  await workspaceGroups(page).nth(1).locator('.fold').click()
  await workspaceItems(page).nth(0).click()
  await toggleView(first, 'columns')
  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)

  await restartWith(app)
  const { page: again } = await launch()
  await expect(again.locator('.sidebar')).toHaveClass(/collapsed/)
  await expect(again.locator('.terminals')).toHaveClass(/columns/)
  await expect(workspaceItems(again)).toHaveCount(2)
  await expect(workspaceGroups(again).nth(1).locator('.fold')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(panes(again)).toHaveCount(2)
  await expect(panes(again).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await run(again, 'echo $MARK', 'kept-2')
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

test('재시작하면 window-state.json 의 보기 설정보다 재시작 전 화면을 따른다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  await toggleView(first, 'columns')
  await clickMenu(first.app, 'toggle-sidebar')
  await expect(first.page.locator('.sidebar')).toHaveClass(/collapsed/)
  await restartWith(first.app)
  writeFileSync(
    join(dataDir, 'window-state.json'),
    JSON.stringify({ viewMode: 'single', sidebar: { open: true, width: 300 } })
  )

  const { page } = await launch()
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  await expect(page.locator('.terminals')).toHaveClass(/columns/)
})

test('재시작 뒤에도 claude 상태가 보이고, 되살린 셸의 hook 을 따른다', async ({
  launch,
  dataDir
}) => {
  const config = claudeConfig(dataDir)
  claudeFile(config, 1, 'c-1', 'busy', 0)
  const { app, page } = await launch()
  await shellUp(page, 0)
  await page.keyboard.type(claudeHook('UserPromptSubmit', { config }))
  await expect(paneRows(page)).toHaveClass(/working/)
  await restartWith(app)
  const { page: again } = await launch()
  await expect(paneRows(again)).toHaveClass(/working/)
  await expect(activeHeader(again)).toHaveClass(/working/)
  await again.locator('.xterm-screen').click()
  await again.keyboard.type(claudeHook('Stop', { config }))
  await expect(activeHeader(again)).toHaveClass(/idle/)
})

test('재시작 사이 claude 의 상태 파일이 바뀌었으면 따르고, 파일이 없어졌으면 상태를 지운다', async ({
  launch,
  dataDir
}) => {
  const config = claudeConfig(dataDir)
  claudeFile(config, 1, 'c-1', 'idle', 0)
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await shellUp(page, 1)
  await page.keyboard.type(claudeHook('Stop', { session: 'c-2', config }))
  await shellUp(page, 0)
  await page.keyboard.type(claudeHook('Stop', { config }))
  await expect(paneRows(page)).toHaveCount(2)
  await restartWith(app)
  claudeFile(config, 1, 'c-1', 'busy', Date.now())

  const { page: again } = await launch()
  await expect(paneRows(again)).toHaveCount(1)
  await expect(paneRows(again)).toHaveClass(/working/)
  await expect(paneHeader(again, 0)).toHaveClass(/working/)
})

test('다시 뜬 앱이 프로토콜이 달라 끈 세션의 claude 상태는 되살리지 않는다', async ({
  launch,
  dataDir
}) => {
  const config = claudeConfig(dataDir)
  claudeFile(config, 1, 'c-1', 'busy', 0)
  const { app, page } = await launch()
  await shellUp(page, 0)
  await page.keyboard.type(claudeHook('UserPromptSubmit', { config }))
  await expect(paneRows(page)).toHaveClass(/working/)
  await restartWith(app)
  const [sock] = sockets(dataDir)
  const record = join(sessionDir(dataDir), `${basename(sock, '.sock')}.json`)
  writeFileSync(
    record,
    JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), protocol_version: 999 })
  )

  const { page: again } = await launch()
  await expect(panes(again).filter({ hasText: 'ended while the app was restarting' })).toHaveCount(
    1
  )
  // `paneRows` 가 없는 것만으로는 아직 되살리기 전인지 알 수 없어, 되살린 뒤에 답하는 `claudeStatuses` 를 부른다.
  const statuses = await again.evaluate(() =>
    (window as unknown as { maru: { claudeStatuses(): Promise<object> } }).maru.claudeStatuses()
  )
  expect(statuses).toEqual({})
  await expect(paneRows(again)).toHaveCount(0)
})

test('재시작 동안 끝난 세션의 pane 은 이유를 보이고 남는다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await shellUp(page, 0)
  await shellUp(page, 1)
  await restartWith(app)
  const [gone] = sockets(dataDir)
  await killSession(sessionDir(dataDir), basename(gone, '.sock'))

  const { app: again, page: shown } = await launch()
  await expect(panes(shown)).toHaveCount(2)
  const ended = panes(shown).filter({ hasText: 'ended while the app was restarting' })
  await expect(ended).toHaveCount(1)
  await ended.locator('.xterm-screen').click()
  await clickMenu(again, 'close-pane')
  await expect(panes(shown)).toHaveCount(1)
})

test('재시작 뒤 maru pane new 가 되살린 pane 을 나눈다', async ({ launch }) => {
  const { app, page: first } = await launch()
  await shellUp(first, 0)
  await restartWith(app)
  const { page } = await launch()
  await page.keyboard.type(`"$MARU_CLI" pane new -- sh -c 'echo split-$((1+1)); sleep 5'\n`)
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page).nth(1).locator('.xterm-rows')).toContainText('split-2')
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

test('재시작 직후 선택하지 않은 workspace 의 남은 세션이 곧바로 부른 maru workspace new 는 그 workspace 뒤에 띄운다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  const { app, page } = first
  await newWorkspace(first, 2)
  await newWorkspace(first, 3)
  await workspaceItems(page).nth(1).click()
  await run(page, 'echo up-$((1+1))', 'up-2')
  const out = join(dataDir, 'workspace-new')
  await page.keyboard.type(callOnReturn(`workspace new bash -c 'echo mark-new; read x'`, out))
  await workspaceItems(page).nth(0).click()
  await expect(workspaceViews(page).nth(0)).toHaveClass(/selected/)
  await restartWith(app)
  const { page: again } = await launch()
  await expect.poll(readResult(out), { timeout: 15_000 }).toBe('code=0')
  await expect(workspaceItems(again)).toHaveCount(4)
  await expect(workspaceViews(again).nth(2).locator('.xterm-rows')).toContainText('mark-new')
})

test('재시작 직후 남은 세션이 곧바로 부른 maru pane new 는 그 pane 을 나눈다', async ({
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
  await expect(panes(again).nth(1).locator('.xterm-rows')).toContainText('split-2')
})

test('재시작한 뒤의 종료는 세션을 끄고 restart 파일을 남기지 않는다', async ({
  launch,
  dataDir
}) => {
  const { app, page: first } = await launch()
  await shellUp(first, 0)
  await restartWith(app)
  expect(sockets(dataDir)).toHaveLength(1)
  const { app: again, page } = await launch()
  await run(page, 'echo back-$((1+1))', 'back-2')
  expect(existsSync(join(dataDir, 'restart.json'))).toBe(false)
  await again.close()
  expect(sockets(dataDir)).toEqual([])
})

async function stubDialog(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, response) => {
    const calls: unknown[] = []
    Object.assign(globalThis, { dialogCalls: calls })
    dialog.showMessageBox = (async (opts: unknown) => {
      calls.push(opts)
      return { response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, response)
}

function dialogCalls(app: ElectronApplication): Promise<{ detail: string }[]> {
  return app.evaluate(
    () => (globalThis as unknown as { dialogCalls: { detail: string }[] }).dialogCalls
  )
}

function otherProtocolBin(dataDir: string): Record<string, string> {
  const bin = wrapSessionBin(dataDir, 'v2', '[ "$1" = --protocol-version ] && { echo 2; exit 0; }')
  return { MARU_SESSION_BIN: bin }
}

test('버전이 다르면 확인 창을 띄우고, 취소하면 재시작하지 않는다', async ({ launch, dataDir }) => {
  const { app, page } = await launch(otherProtocolBin(dataDir))
  await run(page, 'echo up-$((1+1))', 'up-2')
  await stubDialog(app, 1)
  await clickMenu(app, 'restart')
  await expect.poll(() => dialogCalls(app)).toHaveLength(1)
  expect((await dialogCalls(app))[0].detail).toContain('1 terminal(s) will end')
  await run(page, 'echo still-$((1+1))', 'still-2')
  expect(existsSync(join(dataDir, 'restart.json'))).toBe(false)
})

test('버전이 달라도 확인하면 재시작한다', async ({ launch, dataDir }) => {
  const { app, page } = await launch(otherProtocolBin(dataDir))
  await run(page, 'echo up-$((1+1))', 'up-2')
  await stubDialog(app, 0)
  await restartWith(app)
  expect(existsSync(join(dataDir, 'restart.json'))).toBe(true)
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

test('버전이 달라도 maru app restart --kill-sessions 는 재시작한다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(otherProtocolBin(dataDir))
  await shellUp(page, 0)
  await restartWith(app, () => page.keyboard.type('"$MARU_CLI" app restart --kill-sessions\n'))
  expect(existsSync(join(dataDir, 'restart.json'))).toBe(true)
})

test('화면을 저장하지 못하면 maru app restart 는 실패하고 앱은 그대로다', async ({
  launch,
  dataDir
}) => {
  // 임시 파일 자리에 디렉토리가 있으면 쓰기가 실패한다.
  mkdirSync(join(dataDir, 'restart.json.tmp'))
  const { page } = await launch()
  await run(page, '"$MARU_CLI" app restart; echo "cli=$?"', 'cli=1')
  await run(page, 'echo still-$((1+1))', 'still-2')
})

test('버전이 다르면 maru app restart 는 이유를 보이고 재시작하지 않는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch(otherProtocolBin(dataDir))
  await run(page, '"$MARU_CLI" app restart', 'Pass --kill-sessions to restart anyway.')
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
  const first = await launch()
  const { app, page } = first
  await split(app, page, 'split-right', 2)
  await toggleView(first, 'columns')
  for (const i of [0, 1]) {
    await panes(page).nth(i).locator('.xterm-screen').click()
    await typesInto(page, i, `wide${i}-abcdefghijklmnopqrstuvwxyz`)
  }

  await restartWith(app)
  const { page: again } = await launch()
  // 행 div 를 이어 붙이는 textContent 로는 접힌 줄도 한 줄로 이어져 통과하므로 innerText 의 줄로 본다.
  for (const i of [0, 1]) {
    // 창보다 넓은 columns 보기에서 화면 밖 pane 은 xterm 이 렌더링을 멈추므로, 받은 출력이 DOM 에 그려지지 않는다.
    await panes(again).nth(i).scrollIntoViewIfNeeded()
    await expect
      .poll(async () => (await paneTerminalRows(again, i).innerText()).split('\n'))
      .toContain(`wide${i}-abcdefghijklmnopqrstuvwxyz-2`)
  }
})

test('columns 보기로 재시작한 뒤 대체 화면을 나가도 그 아래 출력이 접히지 않는다', async ({
  launch
}) => {
  const first = await launch()
  const { app, page } = first
  await toggleView(first, 'columns')
  await typesInto(page, 0, 'under-abcdefghijklmnopqrstuvwxyz')
  await run(page, "printf '\\033[?1049h'; echo alt-$((1+1))", 'alt-2')

  await restartWith(app)
  const { page: again } = await launch()
  await activeTerminal(again)
  await run(again, "printf '\\033[?1049l'; echo back-$((1+1))", 'back-2')
  expect((await rows(again).innerText()).split('\n')).toContain(
    'under-abcdefghijklmnopqrstuvwxyz-2'
  )
})
