import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  expect,
  type Launched,
  gridRows,
  resizeBy,
  rows,
  sessionFiles,
  shellSize,
  sockets,
  test,
  workspaceItems
} from './app'

async function activeTerminal(page: Page): Promise<void> {
  await page.waitForSelector('.terminal-view.active .xterm-screen')
}

// Playwright 의 키 입력은 macOS 메뉴를 거치지 않아 메뉴 항목을 직접 누른다.
async function pressNew(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('new-workspace')!.click()
  )
}

async function newWorkspace({ app, page }: Launched, count: number): Promise<void> {
  await pressNew(app)
  await expect(workspaceItems(page)).toHaveCount(count)
  await activeTerminal(page)
}

function slowSessionBin(dataDir: string): string {
  const real =
    process.env.MARU_SESSION_BIN ?? join(__dirname, '../../core/target/debug/maru-session')
  const bin = join(dataDir, 'slow-session')
  writeFileSync(bin, `#!/bin/sh\nsleep 1.5\nexec '${real}' "$@"\n`)
  chmodSync(bin, 0o755)
  return bin
}

function hostPid(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ app }) => app.getAppMetrics().find((m) => m.name === 'maru-session-host')!.pid
  )
}

async function run(page: Page, command: string, expected: string): Promise<void> {
  await page.keyboard.type(`${command}\n`)
  await expect(rows(page)).toContainText(expected)
}

test('⌘N 은 File 메뉴의 New Workspace 다', async ({ launch }) => {
  const { app } = await launch()
  const item = await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()!.items.find((i) => i.role?.toLowerCase() === 'filemenu')!
    const found = file.submenu!.getMenuItemById('new-workspace')!
    return { label: found.label, accelerator: found.accelerator }
  })
  expect(item).toEqual({ label: 'New Workspace', accelerator: 'Command+N' })
})

test('앱을 켜면 홈 디렉토리에서 workspace 하나를 연다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await expect(workspaceItems(page)).toHaveText(['Shell'])
  await expect(workspaceItems(page).first()).toHaveClass(/selected/)
  await run(page, '[ "$PWD" = "$HOME" ] && echo home-$((1+1))', 'home-2')
  expect(sockets(dataDir)).toHaveLength(1)
})

test('⌘N 은 홈 디렉토리에서 새 세션으로 새 workspace 를 열고 그것을 선택한다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('cd /tmp; X=first-$((1+1))\n')

  await newWorkspace(launched, 2)

  await expect(workspaceItems(page).nth(1)).toHaveClass(/selected/)
  await run(page, 'echo "x=$X pwd=$PWD" new-$((2+2))', `x= pwd=${process.env.HOME} new-4`)
  expect(sockets(dataDir)).toHaveLength(2)
})

test('사이드바에서 누른 workspace 로 전환하고, 보이지 않던 동안의 출력도 남아 있다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('X=a-$((1+1)); (sleep 1; echo late-$((3+3))) &\n')
  await newWorkspace(launched, 2)
  await page.keyboard.type('X=b-$((2+2))\n')
  await expect(rows(page)).not.toContainText('late-6')
  await page.waitForTimeout(1500)

  await workspaceItems(page).first().click()

  await expect(workspaceItems(page).first()).toHaveClass(/selected/)
  await expect(rows(page)).toContainText('late-6')
  await run(page, 'echo "x=$X"', 'x=a-2')
  await workspaceItems(page).nth(1).click()
  await run(page, 'echo "x=$X"', 'x=b-4')
})

test('셸이 끝나면 그 workspace 를 닫고, 바로 위 workspace 를 선택한다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('X=kept-$((1+1))\n')
  await newWorkspace(launched, 2)

  await page.keyboard.type('exit\n')

  await expect(workspaceItems(page)).toHaveCount(1)
  await expect(workspaceItems(page).first()).toHaveClass(/selected/)
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

  await expect(workspaceItems(page)).toHaveCount(0)
  await expect(page.locator('.terminal-view')).toHaveCount(0)
  await expect.poll(() => sessionFiles(dataDir)).toEqual(['app.sock'])
  await page.waitForTimeout(500)
  expect(closed).toBe(false)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  await newWorkspace(launched, 1)
  await run(page, 'echo again-$((4+4))', 'again-8')
})

test('앱을 끄면 열린 workspace 의 세션을 모두 종료한다', async ({ launch, dataDir }) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await run(page, 'echo three-$((1+2))', 'three-3')
  expect(sockets(dataDir)).toHaveLength(3)

  await app.close()

  expect(sessionFiles(dataDir)).toEqual([])
})

test('새로 고치면 모든 workspace 를 되살리고 가장 최근 것을 선택한다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('X=a-$((1+1))\n')
  await newWorkspace(launched, 2)
  await run(page, 'X=b-$((2+2)); echo set-$((3+3))', 'set-6')

  await page.reload()

  await expect(workspaceItems(page)).toHaveCount(2)
  await expect(workspaceItems(page).nth(1)).toHaveClass(/selected/)
  await activeTerminal(page)
  await run(page, 'echo "x=$X"', 'x=b-4')
  await workspaceItems(page).first().click()
  await run(page, 'echo "x=$X"', 'x=a-2')
  expect(sockets(dataDir)).toHaveLength(2)
})

test('⌘N 직후에 새로 고쳐도 띄우던 세션을 잃거나 하나 더 띄우지 않는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await run(page, 'echo first-$((1+1))', 'first-2')
  await pressNew(app)
  await page.reload()

  await expect(workspaceItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await run(page, 'echo second-$((2+2))', 'second-4')
  expect(sockets(dataDir)).toHaveLength(2)
})

test('세션을 잇는 utilityProcess 가 죽어도 workspace 는 닫지 않고, 새로 고치면 모두 다시 붙는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await page.keyboard.type('X=a-$((1+1))\n')
  await newWorkspace(launched, 2)
  await run(page, 'X=b-$((2+2)); echo set-$((3+3))', 'set-6')
  process.kill(await hostPid(app), 'SIGKILL')
  await expect(rows(page)).toContainText('disconnected from the session')
  await expect(workspaceItems(page)).toHaveCount(2)

  await page.reload()

  await expect(workspaceItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await run(page, 'echo "x=$X"', 'x=b-4')
  await workspaceItems(page).first().click()
  await run(page, 'echo "x=$X"', 'x=a-2')
})

test('보이지 않는 동안 창 크기가 바뀐 workspace 도 셸이 보는 크기가 화면과 맞다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  const before = await shellSize(page)

  await resizeBy(app, -200, -180)
  await expect.poll(async () => (await shellSize(page)).rows).toBeLessThan(before.rows)
  await workspaceItems(page).first().click()

  const size = await shellSize(page)
  expect(size.rows).toBe(await gridRows(page).count())
  expect(size.rows).toBeLessThan(before.rows)
})

test('보이지 않는 workspace 의 셸이 끝나면 그것만 닫고, 선택과 입력은 그대로다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('sleep 1; exit\n')
  await newWorkspace(launched, 2)
  await page.keyboard.type('X=stay-$((1+1))\n')

  await expect(workspaceItems(page)).toHaveCount(1)
  await expect(workspaceItems(page).first()).toHaveClass(/selected/)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  await run(page, 'echo "x=$X"', 'x=stay-2')
})

test('마지막 workspace 가 닫힌 뒤 새로 고치면 workspace 하나를 새로 연다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  await page.keyboard.type('exit\n')
  await expect(workspaceItems(page)).toHaveCount(0)

  await page.reload()

  await expect(workspaceItems(page)).toHaveCount(1)
  await activeTerminal(page)
  await run(page, 'echo fresh-$((2+3))', 'fresh-5')
  expect(sockets(dataDir)).toHaveLength(1)
})

test('되살리는 동안 누른 ⌘N 은 되살린 뒤에 연다', async ({ launch, dataDir }) => {
  const { app, page } = await launch({ MARU_SESSION_BIN: slowSessionBin(dataDir) })
  await expect(rows(page)).toContainText('$', { timeout: 10_000 })
  await pressNew(app)
  await page.reload()
  await page.waitForSelector('.sidebar')
  await pressNew(app)

  await expect(workspaceItems(page)).toHaveCount(3, { timeout: 10_000 })
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(3)
})

test('되살리는 중에 utilityProcess 가 죽어도 살아 있는 세션을 되살리고 새 세션을 띄우지 않는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch({ MARU_SESSION_BIN: slowSessionBin(dataDir) })
  await run(page, 'X=first-$((1+1)); echo set-$((2+2))', 'set-4')
  await pressNew(app)
  const pid = await hostPid(app)
  const reload = page.reload()
  await page.waitForTimeout(300)
  process.kill(pid, 'SIGKILL')
  await reload

  await expect(workspaceItems(page)).toHaveCount(1)
  await activeTerminal(page)
  await run(page, 'echo "x=$X"', 'x=first-2')
  // 죽은 host 가 띄우던 세션은 되살린 뒤에 뜬다.
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(2)
  await page.waitForTimeout(2000)
  expect(sockets(dataDir)).toHaveLength(2)
})

test('다른 곳을 눌러 터미널의 포커스가 빠진 뒤 선택된 workspace 를 누르면 키 입력이 다시 터미널로 간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('canvas:put', {
      id: 'a',
      kind: 'markdown',
      text: '# 문서\n\n본문\n'
    })
  )
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
    await workspaceItems(page).first().click()
    await run(page, `echo back-$((${i}+10))`, `back-${i + 10}`)
  }
})
