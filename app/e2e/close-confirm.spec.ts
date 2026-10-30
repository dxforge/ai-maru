import type { Page } from '@playwright/test'
import {
  activeHeader,
  cellItems,
  clickMenu,
  closeWindow,
  dialogCalls,
  expect,
  foregroundNames,
  newWorkspace,
  panes,
  restartWith,
  run,
  sockets,
  split,
  stubDialog,
  test,
  zshHome
} from './app'

async function startCat(page: Page, dataDir: string): Promise<void> {
  await page.keyboard.type('cat\n')
  await expect.poll(() => foregroundNames(dataDir)).toContain('cat')
}

test('⌘W 는 셸만 뜬 pane 을 묻지 않고 닫는다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await stubDialog(app, 1)
  await clickMenu(app, 'close-pane')
  await expect(panes(page)).toHaveCount(1)
  expect(await dialogCalls(app)).toEqual([])
})

test('⌘W 를 빠르게 두 번 누르면 셸만 뜬 pane 을 둘 닫는다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-right', 3)
  await stubDialog(app, 1)
  await Promise.all([clickMenu(app, 'close-pane'), clickMenu(app, 'close-pane')])
  await expect(panes(page)).toHaveCount(1)
  expect(await dialogCalls(app)).toEqual([])
})

test('⌘W 는 프로그램이 도는 pane 을 이름과 함께 묻고, 취소하면 남기고 Close 면 닫는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await startCat(page, dataDir)

  await stubDialog(app, 1)
  await clickMenu(app, 'close-pane')
  await expect
    .poll(() => dialogCalls(app))
    .toEqual([
      {
        type: 'warning',
        message: 'Close this pane?',
        detail: '`cat` is still running.',
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      }
    ])

  // 앞의 취소가 pane 을 닫았다면 이 ⌘W 는 셸만 뜬 pane 을 묻지 않고 닫아 pane 이 남지 않는다.
  await stubDialog(app, 0)
  await clickMenu(app, 'close-pane')
  await expect(panes(page)).toHaveCount(1)
  expect(await dialogCalls(app)).toHaveLength(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
})

test('확인 창이 뜨면 그 사이에 누른 ⌘W 는 버린다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-right', 3)
  await startCat(page, dataDir)
  await stubDialog(app, 1)
  await Promise.all([clickMenu(app, 'close-pane'), clickMenu(app, 'close-pane')])
  await expect.poll(async () => (await dialogCalls(app)).length).toBe(1)
  // 버리지 않았다면 취소한 뒤 같은 pane 을 다시 묻는다. 그 확인 창은 셸이 다시 답하기 전에 뜨므로, 셸의 답을 기다린 뒤 확인 창 수를 센다.
  await page.keyboard.press('Control+D')
  await run(page, 'echo alive-$((1+1))', 'alive-2')
  expect(await dialogCalls(app)).toHaveLength(1)
  await expect(panes(page)).toHaveCount(3)
})

test('셸이 알린 명령이 도는 pane 은 프로세스 이름 대신 친 명령으로 묻는다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir)
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('sleep 30\n')
  await expect.poll(() => foregroundNames(dataDir)).toContain('sleep')
  await expect(activeHeader(page).locator('.title')).toHaveText('sleep 30')
  await stubDialog(app, 1)
  await clickMenu(app, 'close-pane')
  await expect
    .poll(async () => (await dialogCalls(app)).map((c) => c.detail))
    .toEqual(['`sleep 30` is still running.'])
})

test('명령을 주어 띄운 pane 은 명령 전체로 묻고, Close 면 닫는다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await page.keyboard.type(`maru pane new bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(2)
  await panes(page).nth(1).locator('.xterm-screen').click()
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await stubDialog(app, 1)
  await clickMenu(app, 'close-pane')
  await expect
    .poll(async () => (await dialogCalls(app)).map((c) => c.detail))
    .toEqual(['`bash -c read x` is still running.'])

  await stubDialog(app, 0)
  await clickMenu(app, 'close-pane')
  await expect(panes(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
})

test('maru pane close 는 프로그램이 돌아도 묻지 않는다', async ({ launch }) => {
  const { app, page } = await launch()
  await stubDialog(app, 1)
  await page.keyboard.type(`ID=$(maru pane new bash -c 'read x')\n`)
  await expect(panes(page)).toHaveCount(2)
  await run(page, 'maru pane close "$ID"; echo closed-$?', 'closed-0')
  await expect(panes(page)).toHaveCount(1)
  expect(await dialogCalls(app)).toEqual([])
})

test('⇧⌘W 는 셸만 뜬 workspace 를 묻지 않고 닫는다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await stubDialog(app, 1)
  await clickMenu(app, 'close-workspace')
  await expect(cellItems(page)).toHaveCount(1)
  expect(await dialogCalls(app)).toEqual([])
})

test('⇧⌘W 는 프로그램이 도는 pane 과 job 의 수를 묻고, Close 면 workspace 와 job 을 끝낸다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  // 다른 workspace 의 job 은 세지 않고 끄지도 않는다.
  await run(page, 'maru job new --name other sleep 100; echo first-$((1+1))', 'first-2')
  await newWorkspace(launched, 2)
  await run(page, 'maru job new --name j sleep 100; echo up-$((1+1))', 'up-2')
  await split(app, page, 'split-right', 2)
  await startCat(page, dataDir)
  expect(sockets(dataDir)).toHaveLength(5)

  await stubDialog(app, 1)
  await clickMenu(app, 'close-workspace')
  await expect
    .poll(() => dialogCalls(app))
    .toMatchObject([
      {
        message: 'Close this workspace?',
        detail: '1 pane is running a program and 1 job is running.',
        buttons: ['Close', 'Cancel']
      }
    ])

  await stubDialog(app, 0)
  await clickMenu(app, 'close-workspace')
  await expect(cellItems(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(2)
  expect(await dialogCalls(app)).toHaveLength(1)
})

test('⌘Q 는 프로그램이 돌면 묻고, 취소하면 앱이 남고 Quit 면 끝난다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await startCat(page, dataDir)

  await stubDialog(app, 1)
  await app.evaluate(({ app }) => app.quit())
  await expect
    .poll(() => dialogCalls(app))
    .toMatchObject([
      {
        message: 'Quit and end all terminals?',
        detail: '1 pane is running a program.',
        buttons: ['Quit', 'Cancel']
      }
    ])
  await page.keyboard.press('Control+D')
  await run(page, 'echo alive-$((1+1))', 'alive-2')

  await startCat(page, dataDir)
  await stubDialog(app, 0)
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
  expect(sockets(dataDir)).toEqual([])
})

test('⌘Q 는 job 만 돌아도 묻는다', async ({ launch }) => {
  const { app, page } = await launch()
  await run(page, 'maru job new sleep 100; echo up-$((1+1))', 'up-2')
  await stubDialog(app, 1)
  await app.evaluate(({ app }) => app.quit())
  await expect
    .poll(async () => (await dialogCalls(app)).map((c) => c.detail))
    .toEqual(['1 job is running.'])
})

test('창을 닫을 때도 묻고, 취소하면 창이 남고 Quit 면 앱이 끝난다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await startCat(page, dataDir)

  await stubDialog(app, 1)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect
    .poll(async () => (await dialogCalls(app)).map((c) => c.message))
    .toEqual(['Quit and end all terminals?'])
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  await stubDialog(app, 0)
  await closeWindow(app)
  expect(sockets(dataDir)).toEqual([])
})

test('재시작은 프로그램이 돌아도 묻지 않는다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await startCat(page, dataDir)
  // 물었다면 취소해 재시작이 멈추고 `restartWith` 가 끝나지 않는다.
  await stubDialog(app, 1)
  await restartWith(app)
})

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  test(`${signal} 로 끝낼 때는 묻지 않고 pty 를 끄고 끝난다`, async ({ launch, dataDir }) => {
    const { app, page } = await launch()
    await startCat(page, dataDir)
    // 물었다면 취소해 앱이 끝나지 않는다.
    await stubDialog(app, 1)
    const closed = app.waitForEvent('close')
    process.kill(app.process().pid!, signal)
    await closed
    expect(sockets(dataDir)).toEqual([])
  })
}

test('macOS 가 로그아웃·재시동으로 앱을 끝낼 때는 묻지 않는다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await startCat(page, dataDir)
  await stubDialog(app, 1)
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app, powerMonitor }) => {
    powerMonitor.emit('shutdown')
    app.quit()
  })
  await closed
  expect(sockets(dataDir)).toEqual([])
})
