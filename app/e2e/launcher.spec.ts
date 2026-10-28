import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  activeHeader,
  activeTerminal,
  cellGroups,
  cellItems,
  clickMenu,
  dialogCalls,
  expect,
  openPalette,
  paneRows,
  panes,
  programStatus,
  restartWith,
  rows,
  run,
  stubDialog,
  test,
  workspaceNames,
  writeConfig,
  zshHome,
  type Launched
} from './app'

function launcher(page: Page) {
  return page.locator('.palette.launcher')
}

function items(page: Page) {
  return launcher(page).locator('.item')
}

function query(page: Page) {
  return launcher(page).locator('.query')
}

/** 행의 글자. 최근 목록의 행에는 지우기 버튼의 아이콘 글자가 함께 들어 있어 행 대신 이것으로 잰다. */
function labels(page: Page) {
  return launcher(page).locator('.item .path')
}

function selected(page: Page) {
  return launcher(page).locator('.item.selected .path')
}

function section(page: Page) {
  return launcher(page).locator('.section')
}

async function toCommands(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Enter')
  await expect(section(page).locator('.path')).toHaveText(label)
}

async function delayHandler(app: ElectronApplication, channel: string, ms = 800): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, [channel, ms]) => {
      type Handler = (...args: unknown[]) => unknown
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers
      const original = handlers.get(channel)!
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args) => {
        await new Promise((r) => setTimeout(r, ms))
        return original(...args)
      })
    },
    [channel, ms] as const
  )
}

function writeLauncherState(dataDir: string, recent: string[], command: string): void {
  writeFileSync(join(dataDir, 'launcher.json'), JSON.stringify({ recent, command }))
}

async function finish(page: Page): Promise<void> {
  await page.keyboard.type('0\n')
  await expect(cellItems(page)).toHaveCount(1)
}

async function openLauncher({ app, page }: Launched): Promise<void> {
  await clickMenu(app, 'launcher')
  await expect(query(page)).toBeFocused()
}

function tool(dataDir: string): string {
  const bin = join(dataDir, 'tool')
  writeFileSync(bin, '#!/bin/sh\necho "$1-ran-in-$(pwd -P)"\nread code\nexit "$code"\n')
  chmodSync(bin, 0o755)
  return bin
}

function useTool(dataDir: string, config = ''): [string, string] {
  const bin = tool(dataDir)
  const commands: [string, string] = [`${bin} A`, `${bin} B`]
  writeConfig(dataDir, `${config}[launcher]\ncommands = ${JSON.stringify(commands)}\n`)
  return commands
}

type FakeClaude = { fake: string; env: Record<string, string>; signal(s: NodeJS.Signals): void }

/**
 * PATH 맨 앞에 OSC 7501 로 `working` 을 알리고 기다리는 `claude` 를 둔다. 런처의 `claude` 는 앱의 `.zshenv` 가 정의한
 * `claude` 함수를 거치고, 절대경로 `fake` 는 거치지 않는다.
 */
function fakeClaude(dataDir: string): FakeClaude {
  const bin = join(dataDir, 'fakebin')
  mkdirSync(bin)
  const fake = join(bin, 'claude')
  const pidFile = join(dataDir, 'claude.pid')
  writeFileSync(
    fake,
    `#!/bin/sh\necho $$ > '${pidFile}'\n${programStatus('working')}exec sleep 60\n`,
    { mode: 0o755 }
  )
  writeConfig(dataDir, `[launcher]\ncommands = ["claude", "${fake}"]\n`)
  return {
    fake,
    env: { SHELL: '/bin/zsh', HOME: zshHome(dataDir), PATH: `${bin}:${process.env.PATH}` },
    signal(s) {
      process.kill(Number(readFileSync(pidFile, 'utf8')), s)
      rmSync(pidFile)
    }
  }
}

async function launchFake(launched: Launched, { fake }: FakeClaude, dir: string): Promise<void> {
  const { page } = launched
  await openLauncher(launched)
  await page.keyboard.type(dir)
  await toCommands(page, dir)
  await page.keyboard.type('fakebin')
  await expect(labels(page)).toHaveText([fake])
  await page.keyboard.press('Enter')
  await expect(launcher(page)).toHaveCount(0)
  await expect(activeHeader(page)).toHaveClass(/working/)
}

function project(dataDir: string, name: string): string {
  const dir = join(dataDir, name)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

async function launchAt(launched: Launched, dir: string, key = 'Enter'): Promise<void> {
  await openLauncher(launched)
  await launched.page.keyboard.type(dir)
  await toCommands(launched.page, dir)
  await launched.page.keyboard.press(key)
  await expect(launcher(launched.page)).toHaveCount(0)
  await activeTerminal(launched.page)
}

test('File 메뉴와 팔레트의 Open Launcher 가 런처를 열고, Esc 로 닫으면 키는 터미널로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await page.keyboard.press('Escape')
  await expect(launcher(page)).toHaveCount(0)
  await run(page, 'echo back-$((1+1))', 'back-2')

  await openPalette(launched)
  await page.keyboard.type('launcher')
  await page.keyboard.press('Enter')
  await expect(page.locator('.palette:not(.launcher)')).toHaveCount(0)
  await expect(query(page)).toBeFocused()
})

test('런처가 열린 채 메뉴의 다른 명령을 부르면 런처가 닫히고, 팔레트를 부르면 런처 대신 팔레트가 뜬다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await openLauncher(launched)
  await clickMenu(app, 'new-workspace')
  await expect(launcher(page)).toHaveCount(0)
  await expect(cellItems(page)).toHaveCount(2)

  await openLauncher(launched)
  await openPalette(launched)
  await expect(launcher(page)).toHaveCount(0)
})

test('Enter 는 고른 디렉토리에서 명령을 새 workspace 에 띄우고, 명령이 0 으로 끝나면 pane·cell·workspace 가 닫힌다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await launchAt(launched, dir)
  await expect(cellItems(page)).toHaveCount(2)
  await expect(workspaceNames(page)).toHaveCount(2)
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)
  await expect(rows(page)).toContainText(`A-ran-in-${dir}`)

  await finish(page)
  await expect(workspaceNames(page)).toHaveCount(1)
  await run(page, 'echo left-$((1+1))', 'left-2')
})

test('⌘Enter 는 지금 workspace 의 고른 cell 바로 뒤에 새 cell 로 띄운다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { app, page } = launched
  await clickMenu(app, 'new-cell')
  await expect(cellItems(page)).toHaveCount(2)
  await clickMenu(app, 'previous-cell')
  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)

  await launchAt(launched, dir, 'Meta+Enter')
  await expect(cellItems(page)).toHaveCount(3)
  await expect(workspaceNames(page)).toHaveCount(1)
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)
  await expect(rows(page)).toContainText(`A-ran-in-${dir}`)
})

test('workspace 가 하나도 없으면 ⌘Enter 도 새 workspace 에 띄운다', async ({ launch, dataDir }) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type('exit\n')
  await expect(workspaceNames(page)).toHaveCount(0)
  await launchAt(launched, dir, 'Meta+Enter')
  await expect(workspaceNames(page)).toHaveCount(1)
  await expect(rows(page)).toContainText(`A-ran-in-${dir}`)
})

test('명령이 0 이 아닌 코드로 끝나면 pane 이 화면을 남긴 채 종료 코드를 보이고, ⌘W 는 묻지 않고 닫는다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { app, page } = launched
  await launchAt(launched, dir)
  await expect(rows(page)).toContainText('A-ran-in-')
  await page.keyboard.type('3\n')
  await expect(rows(page)).toContainText('[exited with code 3]')
  await expect(rows(page)).toContainText(`A-ran-in-${dir}`)
  await expect(cellItems(page)).toHaveCount(2)
  await expect(activeHeader(page).locator('.command-tail')).toHaveText('3')
  await expect(activeHeader(page)).toHaveClass(/command-failed/)

  await stubDialog(app, 1)
  await clickMenu(app, 'close-pane')
  await expect(cellItems(page)).toHaveCount(1)
  expect(await dialogCalls(app)).toEqual([])
})

test('명령이 Ctrl-C 의 종료 코드 130 으로 끝나면 0 처럼 pane·cell·workspace 가 닫힌다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await launchAt(launched, dir)
  await expect(rows(page)).toContainText(`A-ran-in-${dir}`)
  await page.keyboard.type('130\n')
  await expect(cellItems(page)).toHaveCount(1)
  await expect(workspaceNames(page)).toHaveCount(1)
  await run(page, 'echo left-$((1+1))', 'left-2')
})

test('런처로 띄운 claude 가 working 을 알린 뒤 SIGKILL 로 끝나면 셸 함수의 clear 로 Working 이 사라지고 종료 코드 137 을 보인다', async ({
  launch,
  dataDir
}) => {
  const claude = fakeClaude(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch(claude.env)
  const { page } = launched
  await launchAt(launched, dir)
  await expect(activeHeader(page)).toHaveClass(/working/)
  await expect(paneRows(page)).toHaveClass(/working/)
  claude.signal('SIGKILL')
  await expect(rows(page)).toContainText('[exited with code 137]')
  await expect(activeHeader(page)).not.toHaveClass(/working/)
  await expect(activeHeader(page)).toHaveClass(/command-failed/)
  await expect(activeHeader(page).locator('.command-tail')).toHaveText('137')
  await expect(paneRows(page)).toHaveCount(0)
  const row = cellItems(page).nth(1)
  await expect(row).toHaveClass(/shell/)
  await expect(row).toHaveClass(/command-failed/)
  await expect(row).toHaveAttribute('aria-label', 'Exited with code 137: claude, proj-a')

  // 셸 함수를 거치지 않는 명령은 끝날 때 OSC 7501 `clear` 를 보내는 쪽이 없어 레코드가 남는다. zsh 가 명령을 exec 하므로
  // 셸이 시그널로 끝난다.
  await launchFake(launched, claude, dir)
  claude.signal('SIGKILL')
  await expect(rows(page)).toContainText('[exited with signal 9]')
  await expect(activeHeader(page)).toHaveClass(/working/)
  await expect(activeHeader(page).locator('.command-tail')).toHaveCount(0)
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page)).toHaveAttribute('aria-label', 'Working: Claude, proj-a')
})

test('셸이 SIGINT 로 끝나도 종료 코드 130 처럼 pane·cell·workspace 가 닫힌다', async ({
  launch,
  dataDir
}) => {
  const claude = fakeClaude(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch(claude.env)
  const { page } = launched
  await launchFake(launched, claude, dir)
  await expect(cellItems(page)).toHaveCount(2)
  claude.signal('SIGINT')
  await expect(cellItems(page)).toHaveCount(1)
  await expect(workspaceNames(page)).toHaveCount(1)
})

test('커서를 그린 내용 위에 두고 끝난 명령의 종료 코드는 그 내용을 덮지 않고 마지막 줄 아래에 쓴다', async ({
  launch,
  dataDir
}) => {
  const bin = join(dataDir, 'tui')
  writeFileSync(bin, "#!/bin/sh\nprintf 'top\\ninput\\nstatus-bar\\n\\033[2A'\nexit 3\n")
  chmodSync(bin, 0o755)
  writeConfig(dataDir, `[launcher]\ncommands = ["${bin}"]\n`)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await launchAt(launched, dir)
  await expect(rows(page)).toContainText('[exited with code 3]')
  const lines = (await rows(page).innerText()).split('\n').map((l) => l.trim())
  const status = lines.indexOf('status-bar')
  expect(status).toBeGreaterThan(lines.indexOf('input'))
  expect(lines.indexOf('[exited with code 3]')).toBe(status + 1)
})

test('PATH 에 없는 명령은 셸의 오류와 종료 코드 127 을 남긴다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[launcher]\ncommands = ["no-such-command-xyz"]\n')
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await launchAt(launched, dir)
  await expect(rows(page)).toContainText('[exited with code 127]')
  await expect(rows(page)).toContainText('no-such-command-xyz')
  await expect(cellItems(page)).toHaveCount(2)
})

test('최근 목록은 런처로 연 디렉토리를 최근 순으로 보이고, 친 단어로 거르며, ⇧⌘⌫ 로 지운 행은 다시 띄워도 없다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const a = project(dataDir, 'proj-a')
  const b = project(dataDir, 'proj-b')
  const first = await launch()
  await launchAt(first, a)
  await finish(first.page)
  await launchAt(first, b)
  await finish(first.page)

  await openLauncher(first)
  await expect(section(first.page)).toHaveText('Recent')
  await expect(labels(first.page)).toHaveText([b, a])
  await first.page.keyboard.type('PROJ-A')
  await expect(labels(first.page)).toHaveText([a])
  await first.page.keyboard.press('Shift+Meta+Backspace')
  await expect(items(first.page)).toHaveCount(0)
  await expect(query(first.page)).toHaveValue('PROJ-A')
  await expect(launcher(first.page)).toContainText('No matching directories')
  await first.app.close()

  const again = await launch()
  await openLauncher(again)
  await expect(labels(again.page)).toHaveText([b])
})

test('최근 목록이 비었으면 그렇다고 보이고, 입력이 경로가 아니면 Enter 는 아무것도 띄우지 않는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await expect(launcher(page)).toContainText('No recent directories')
  await page.keyboard.type('anything')
  await page.keyboard.press('Enter')
  await expect(launcher(page)).toBeVisible()
  await expect(cellItems(page)).toHaveCount(1)
})

test('/ 로 시작한 입력은 하위 디렉토리를 후보로 보이고, → 는 고른 후보로 한 단계 들어가며, 숨은 디렉토리는 . 을 칠 때만 보인다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const tree = project(dataDir, 'tree')
  for (const name of ['alpha', 'Beta', '.hidden', 'alpha/inner']) mkdirSync(join(tree, name))
  writeFileSync(join(tree, 'file'), '')
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await page.keyboard.type(`${tree}/`)
  await expect(labels(page)).toHaveText([`${tree}/alpha`, `${tree}/Beta`])
  await page.keyboard.type('b')
  await expect(labels(page)).toHaveText([`${tree}/Beta`])
  await page.keyboard.press('Backspace')
  await page.keyboard.type('.')
  await expect(labels(page)).toHaveText([`${tree}/.hidden`])
  await page.keyboard.press('Backspace')
  await page.keyboard.type('al')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await expect(query(page)).toHaveValue(`${tree}/al`)
  await page.keyboard.press('ArrowRight')
  await expect(query(page)).toHaveValue(`${tree}/alpha/`)
  await expect(labels(page)).toHaveText([`${tree}/alpha/inner`])

  await page.keyboard.press('Meta+Backspace')
  await expect(query(page)).toHaveValue('')

  await page.keyboard.type(`${tree}/alpha/in`)
  await expect(section(page)).toHaveText('Open directory')
  await toCommands(page, `${tree}/alpha/inner`)
  await page.keyboard.press('Enter')
  await expect(launcher(page)).toHaveCount(0)
  await activeTerminal(page)
  await expect(rows(page)).toContainText(`A-ran-in-${tree}/alpha/inner`)
})

test('후보가 오기 전에 누른 Enter 는 후보를 기다려 고른 후보의 명령 단계로 가고, 그 사이 한 번 더 누른 Enter 는 띄우지 않는다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const tree = project(dataDir, 'tree')
  mkdirSync(join(tree, 'alpha'))
  const launched = await launch()
  const { app, page } = launched
  await delayHandler(app, 'launcher:dirs')
  await openLauncher(launched)
  await page.keyboard.type(`${tree}/al`)
  await page.keyboard.press('Enter')
  await toCommands(page, `${tree}/alpha`)
  await expect(cellItems(page)).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(launcher(page)).toHaveCount(0)
  await activeTerminal(page)
  await expect(rows(page)).toContainText(`A-ran-in-${tree}/alpha`)
})

test('~ 로 시작한 입력은 홈 아래의 디렉토리를 ~ 로 줄여 보이고, 연 디렉토리도 목록에 ~ 로 보인다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const home = project(dataDir, 'home')
  mkdirSync(join(home, 'code'))
  const launched = await launch({ HOME: home })
  const { page } = launched
  await openLauncher(launched)
  await page.keyboard.type('~/c')
  await expect(labels(page)).toHaveText(['~/code'])
  await toCommands(page, '~/code')
  await page.keyboard.press('Enter')
  await activeTerminal(page)
  await expect(rows(page)).toContainText(`A-ran-in-${home}/code`)
  await finish(page)

  await openLauncher(launched)
  await expect(labels(page)).toHaveText(['~/code'])
})

test('없는 디렉토리는 띄우지 않고 런처 안에 이유를 보이며, 최근 목록의 행은 지우지 않는다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const gone = project(dataDir, 'gone')
  const launched = await launch()
  const { page } = launched
  await launchAt(launched, gone)
  await finish(page)
  rmSync(gone, { recursive: true })

  await openLauncher(launched)
  await expect(labels(page)).toHaveText([gone])
  await toCommands(page, gone)
  await page.keyboard.press('Enter')
  await expect(launcher(page).locator('.problem')).toHaveText(`No such directory: ${gone}`)
  await expect(cellItems(page)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(labels(page)).toHaveText([gone])

  const file = join(dataDir, 'plain')
  writeFileSync(file, '')
  await page.keyboard.type(file)
  await toCommands(page, file)
  await expect(launcher(page).locator('.problem')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(launcher(page).locator('.problem')).toHaveText(`Not a directory: ${file}`)
  await expect(cellItems(page)).toHaveCount(1)
})

test('명령 단계는 명령 뒤에 shell 을 붙여 보이고, 마지막으로 띄운 명령을 다음에 열 때와 재시작 뒤에도 먼저 고른다', async ({
  launch,
  dataDir
}) => {
  const [a, b] = useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const first = await launch()
  const { app, page } = first
  await openLauncher(first)
  await page.keyboard.type(dir)
  await toCommands(page, dir)
  await expect(labels(page)).toHaveText([a, b, 'shell'])
  await expect(selected(page)).toHaveText(a)
  await page.keyboard.press('ArrowUp')
  await expect(selected(page)).toHaveText(b)
  await page.keyboard.press('Enter')
  await activeTerminal(page)
  await expect(rows(page)).toContainText(`B-ran-in-${dir}`)

  await openLauncher(first)
  await page.keyboard.type(dir)
  await toCommands(page, dir)
  await expect(selected(page)).toHaveText(b)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await restartWith(app)

  const again = await launch()
  await openLauncher(again)
  await again.page.keyboard.type(dir)
  await toCommands(again.page, dir)
  await expect(selected(again.page)).toHaveText(b)
})

test('shell 은 명령 없이 고른 디렉토리에서 셸을 열고, 다음에 열 때 먼저 고른다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await page.keyboard.type(dir)
  await toCommands(page, dir)
  await page.keyboard.type('shell')
  await expect(labels(page)).toHaveText(['shell'])
  await page.keyboard.press('Enter')
  await activeTerminal(page)
  await expect(workspaceNames(page)).toHaveCount(2)
  await run(page, 'echo at-$(pwd -P)', `at-${dir}`)

  await openLauncher(launched)
  await page.keyboard.type(dir)
  await toCommands(page, dir)
  await expect(selected(page)).toHaveText('shell')
})

test('명령 단계에서 Esc 나 입력이 빈 채 누른 ⌫ 는 디렉토리 단계로 돌아가고, 치던 입력을 되살린다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await page.keyboard.type(dir)
  await toCommands(page, dir)
  await expect(query(page)).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(query(page)).toHaveValue(dir)
  await expect(section(page)).toHaveText('Open directory')

  await toCommands(page, dir)
  await page.keyboard.type('x')
  await page.keyboard.press('Backspace')
  await expect(section(page).locator('.path')).toHaveText(dir)
  await page.keyboard.press('Backspace')
  await expect(query(page)).toHaveValue(dir)
  await page.keyboard.press('Escape')
  await expect(launcher(page)).toHaveCount(0)
})

test('Tab 은 고른 후보를 입력에 채우고 / 를 붙이며, / 로 끝난 경로에서 Enter 는 후보가 아니라 친 디렉토리를 고른다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const tree = project(dataDir, 'tree')
  mkdirSync(join(tree, 'alpha/inner'), { recursive: true })
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await page.keyboard.type(`${tree}/al`)
  await expect(labels(page)).toHaveText([`${tree}/alpha`])
  await page.keyboard.press('Tab')
  await expect(query(page)).toHaveValue(`${tree}/alpha/`)
  await expect(labels(page)).toHaveText([`${tree}/alpha/inner`])
  await expect(launcher(page).locator('.item.selected')).toHaveCount(0)
  await toCommands(page, `${tree}/alpha`)
  await page.keyboard.press('Enter')
  await activeTerminal(page)
  await expect(rows(page)).toContainText(`A-ran-in-${tree}/alpha`)
  await expect(rows(page)).not.toContainText(`A-ran-in-${tree}/alpha/inner`)
})

test('명령 단계의 헤더는 ⌘ 를 누르고 있는 동안 New Workspace 대신 New Cell 을 보인다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await expect(section(page).locator('.where')).toHaveCount(0)
  await page.keyboard.type(dir)
  await toCommands(page, dir)
  const where = section(page).locator('.where')
  await expect(where).toHaveText('New Workspace')
  await page.keyboard.down('Meta')
  await expect(where).toHaveText('New Cell')
  await page.keyboard.up('Meta')
  await expect(where).toHaveText('New Workspace')
})

test('재시작 뒤에도 실패한 채 남긴 pane 은 화면과 종료 코드를 보이고, 런처의 목록이 남는다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  const first = await launch()
  await launchAt(first, dir)
  await first.page.keyboard.type('4\n')
  await expect(rows(first.page)).toContainText('[exited with code 4]')
  await restartWith(first.app)

  const again = await launch()
  const { app, page } = again
  await expect(cellItems(page)).toHaveCount(2)
  const kept = panes(page).filter({ hasText: '[exited with code 4]' })
  await cellItems(page).nth(1).click()
  await expect(kept).toContainText(`A-ran-in-${dir}`)
  await expect(activeHeader(page).locator('.command-tail')).toHaveText('4')

  await openLauncher(again)
  await expect(labels(page)).toHaveText([dir])
  await page.keyboard.press('Escape')
  await stubDialog(app, 1)
  await clickMenu(app, 'close-pane')
  await expect(cellItems(page)).toHaveCount(1)
  expect(await dialogCalls(app)).toEqual([])
})

test('config.toml 의 launcher.commands 를 고치면 열린 런처의 명령도 바뀐다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[launcher]\ncommands = ["first", "second"]\n')
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await page.keyboard.type(dir)
  await toCommands(page, dir)
  await expect(labels(page)).toHaveText(['first', 'second', 'shell'])
  writeConfig(dataDir, '[launcher]\ncommands = ["third"]\n')
  await expect(labels(page)).toHaveText(['third', 'shell'])
  await expect(selected(page)).toHaveText('third')
})

test('기본 명령은 claude 와 codex 다', async ({ launch, dataDir }) => {
  const dir = project(dataDir, 'proj-a')
  const launched = await launch()
  await openLauncher(launched)
  await launched.page.keyboard.type(dir)
  await toCommands(launched.page, dir)
  await expect(labels(launched.page)).toHaveText(['claude', 'codex', 'shell'])
  await expect(selected(launched.page)).toHaveText('claude')
})

test('layout.palette = "top" 이면 런처도 창 위에 뜬다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[layout]\npalette = "top"\n')
  const launched = await launch()
  await openLauncher(launched)
  const box = (await launcher(launched.page).boundingBox())!
  const height = await launched.page.evaluate(() => window.innerHeight)
  expect(box.y).toBeLessThan(height / 2)
})

for (const [position, label, next] of [
  ['bottom', '아래', 'ArrowUp'],
  ['top', '위', 'ArrowDown']
] as const) {
  test(`런처가 ${label}일 때 ${next} 로 다음 행을 고르고, 한글을 조합하는 중의 Enter 는 띄우지 않는다`, async ({
    launch,
    dataDir
  }) => {
    const [a] = useTool(dataDir, `[layout]\npalette = "${position}"\n`)
    const first = project(dataDir, 'proj-a')
    const second = project(dataDir, 'proj-b')
    writeLauncherState(dataDir, [first, second], a)
    const launched = await launch()
    const { page } = launched
    await openLauncher(launched)
    await expect(labels(page)).toHaveText([first, second])
    await expect(items(page).nth(0)).toHaveClass(/selected/)
    await page.keyboard.press(next)
    await expect(items(page).nth(1)).toHaveClass(/selected/)

    await query(page).dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    await expect(launcher(page)).toBeVisible()
    await expect(cellItems(page)).toHaveCount(1)

    await toCommands(page, second)
    await page.keyboard.press('Enter')
    await activeTerminal(page)
    await expect(rows(page)).toContainText(`A-ran-in-${second}`)
  })
}

test('디렉토리 행을 누르면 명령 단계로 가고, 명령 행을 누르면 새 workspace 에, ⌘ 를 누른 채 누르면 지금 workspace 의 새 cell 에 띄운다', async ({
  launch,
  dataDir
}) => {
  const [a] = useTool(dataDir)
  const first = project(dataDir, 'proj-a')
  const second = project(dataDir, 'proj-b')
  writeLauncherState(dataDir, [first, second], a)
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  await items(page).nth(1).click()
  await expect(section(page).locator('.path')).toHaveText(second)
  await items(page).nth(0).click()
  await activeTerminal(page)
  await expect(workspaceNames(page)).toHaveCount(2)
  await expect(rows(page)).toContainText(`A-ran-in-${second}`)
  await finish(page)

  await openLauncher(launched)
  await expect(labels(page)).toHaveText([second, first])
  await items(page).nth(1).click()
  await expect(section(page).locator('.path')).toHaveText(first)
  await items(page)
    .nth(0)
    .click({ modifiers: ['Meta'] })
  await activeTerminal(page)
  await expect(cellItems(page)).toHaveCount(2)
  await expect(workspaceNames(page)).toHaveCount(1)
  await expect(rows(page)).toContainText(`A-ran-in-${first}`)
})

test('최근 목록 행에 마우스를 올리면 나오는 × 는 띄우지 않고 그 행을 지운다', async ({
  launch,
  dataDir
}) => {
  const [a] = useTool(dataDir)
  const first = project(dataDir, 'proj-a')
  const second = project(dataDir, 'proj-b')
  writeLauncherState(dataDir, [first, second], a)
  const launched = await launch()
  const { page } = launched
  await openLauncher(launched)
  const remove = items(page).nth(1).locator('.remove')
  await expect(remove).toBeHidden()
  await items(page).nth(1).hover()
  await remove.click()
  await expect(labels(page)).toHaveText([first])
  await expect(section(page)).toHaveText('Recent')
  await expect(query(page)).toBeFocused()
  await expect(cellItems(page)).toHaveCount(1)
})

test('최근 목록이 오기 전에 누른 Enter 는 목록과 기억한 명령을 기다려 맨 앞 디렉토리의 명령 단계로 간다', async ({
  launch,
  dataDir
}) => {
  const [, b] = useTool(dataDir)
  const dir = project(dataDir, 'proj-a')
  writeLauncherState(dataDir, [dir], b)
  const launched = await launch()
  await delayHandler(launched.app, 'launcher:read')
  await openLauncher(launched)
  await toCommands(launched.page, dir)
  await expect(selected(launched.page)).toHaveText(b)
  await launched.page.keyboard.press('Enter')
  await expect(launcher(launched.page)).toHaveCount(0)
  await activeTerminal(launched.page)
  await expect(rows(launched.page)).toContainText(`B-ran-in-${dir}`)
})
