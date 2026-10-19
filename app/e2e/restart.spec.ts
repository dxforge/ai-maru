import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { killSession } from '../src/main/session'
import {
  activeHeader,
  claudeHook,
  clickMenu,
  expect,
  newWorkspace,
  openPalette,
  paneRows,
  panes,
  restartWith,
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

test('재시작 뒤 claude 상태는 비어 있다가 되살린 셸의 hook 으로 다시 보인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await shellUp(page, 0)
  await page.keyboard.type(claudeHook('UserPromptSubmit'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await restartWith(app)
  const { page: again } = await launch()
  await expect(paneRows(again)).toHaveCount(0)
  await again.locator('.xterm-screen').click()
  await again.keyboard.type(claudeHook('UserPromptSubmit'))
  await expect(paneRows(again)).toHaveClass(/working/)
  await expect(activeHeader(again)).toHaveClass(/working/)
  await again.keyboard.type(claudeHook('Stop'))
  await expect(activeHeader(again)).toHaveClass(/idle/)
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
