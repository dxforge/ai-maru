import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { encodeFrame, TAG_TEXT } from '../src/main/frame'
import { appSocketPath, killSessions } from '../src/main/session'
import { PROTOCOL_VERSION } from '../src/shared/protocol'

export { expect }

export type Launched = { app: ElectronApplication; page: Page }

type Fixtures = {
  dataDir: string
  launch: (env?: Record<string, string>, executablePath?: string) => Promise<Launched>
  defer: (fn: () => void) => void
}

export const test = base.extend<Fixtures>({
  // playwright 는 첫 인자가 객체 분해 패턴인지 보고 주입할 fixture 를 정하므로 `{}` 를 지우면 안 된다.
  // eslint-disable-next-line no-empty-pattern
  dataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-e2e-'))
    await use(dir)
    // 앱을 강제로 끝낸 테스트는 세션을 남긴다.
    await killSessions(sessionDir(dir))
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  },
  launch: async ({ dataDir }, use) => {
    const apps: ElectronApplication[] = []
    await use(async (env = {}, executablePath) => {
      const launched = await launchApp(dataDir, env, executablePath)
      apps.push(launched.app)
      return launched
    })
    for (const app of apps) await app.close().catch(() => {})
  },
  // eslint-disable-next-line no-empty-pattern
  defer: async ({}, use) => {
    const fns: (() => void)[] = []
    await use((fn) => fns.push(fn))
    for (const fn of fns) fn()
  }
})

async function launchApp(
  dataDir: string,
  env: Record<string, string>,
  executablePath?: string
): Promise<Launched> {
  const inherited = { ...process.env }
  // 패키징한 앱이 번들 안의 바이너리를 쓰는지 봐야 하므로 바깥의 덮어쓰기를 물려주지 않는다.
  if (executablePath) {
    delete inherited.MARU_SESSION_BIN
    delete inherited.MARU_CLI_BIN
  }
  const app = await electron.launch({
    executablePath,
    args: executablePath ? [`--user-data-dir=${dataDir}`] : ['.', `--user-data-dir=${dataDir}`],
    env: {
      ...inherited,
      MARU_UNOBTRUSIVE: '1',
      SHELL: '/bin/bash',
      BASH_SILENCE_DEPRECATION_WARNING: '1',
      ...env
    } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.xterm-screen')
  return { app, page }
}

/** 셸의 `$PWD` 와 견줄 수 있게 심볼릭 링크를 푼 경로를 준다. */
export function zshHome(dataDir: string, ...dirs: string[]): string {
  const home = join(dataDir, 'home')
  mkdirSync(home)
  for (const dir of dirs) mkdirSync(join(home, dir), { recursive: true })
  writeFileSync(join(home, '.zshrc'), "PS1='%# '\nMARK=rc-$((1+1))\n")
  return realpathSync(home)
}

export function slowSessionBin(dataDir: string): string {
  const real =
    process.env.MARU_SESSION_BIN ?? join(__dirname, '../../core/target/debug/maru-session')
  const bin = join(dataDir, 'slow-session')
  writeFileSync(bin, `#!/bin/sh\nsleep 1.5\nexec '${real}' "$@"\n`)
  chmodSync(bin, 0o755)
  return bin
}

export function sessionDir(dataDir: string): string {
  return join(dataDir, 's')
}

export function sessionFiles(dataDir: string): string[] {
  try {
    return readdirSync(sessionDir(dataDir)).sort()
  } catch {
    return []
  }
}

export function sockets(dataDir: string): string[] {
  return sessionFiles(dataDir)
    .filter((n) => n.endsWith('.sock'))
    .map((n) => join(sessionDir(dataDir), n))
    .filter((p) => p !== appSocketPath(sessionDir(dataDir)))
}

function request(v: object): Buffer {
  const body = JSON.stringify({ ...v, protocol_version: PROTOCOL_VERSION })
  return encodeFrame(TAG_TEXT, Buffer.from(body))
}

export function attachFromOutside(sockPath: string, cols: number, rows: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(sockPath, () => {
      sock.write(request({ type: 'attach', role: 'primary', cols, rows }))
      resolve(sock)
    })
    sock.on('data', () => {})
    sock.on('error', reject)
  })
}

export function panes(page: Page) {
  return page.locator('.panes.selected .pane')
}

export function activePane(page: Page) {
  return page.locator('.pane:has(> .terminal-view.active)')
}

export function rows(page: Page) {
  return page.locator('.terminal-view.active .xterm-rows')
}

let sizeMarker = 0

export async function shellSize(page: Page): Promise<{ rows: number; cols: number }> {
  const marker = `size${++sizeMarker}`
  await page.keyboard.type(`clear; echo ${marker}=$(stty size | tr ' ' x)\n`)
  const re = new RegExp(`${marker}=(\\d+)x(\\d+)`)
  let m: RegExpMatchArray | null = null
  await expect.poll(async () => (m = (await rows(page).innerText()).match(re))).not.toBeNull()
  return { rows: Number(m![1]), cols: Number(m![2]) }
}

export async function activeTerminal(page: Page): Promise<void> {
  await page.waitForSelector('.terminal-view.active .xterm-screen')
}

export async function run(page: Page, command: string, expected: string): Promise<void> {
  await page.keyboard.type(`${command}\n`)
  await expect(rows(page)).toContainText(expected)
}

export function gridRows(page: Page) {
  return rows(page).locator('> div')
}

export function workspaceItems(page: Page) {
  return page.locator('.sidebar .workspace')
}

// Playwright 의 키 입력은 macOS 메뉴를 거치지 않아 메뉴 항목을 직접 누른다.
export async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id)
}

export async function pressNew(app: ElectronApplication): Promise<void> {
  await clickMenu(app, 'new-workspace')
}

export async function newWorkspace({ app, page }: Launched, count: number): Promise<void> {
  await pressNew(app)
  await expect(workspaceItems(page)).toHaveCount(count)
  await activeTerminal(page)
}

export async function split(
  app: ElectronApplication,
  page: Page,
  id: 'split-right' | 'split-down',
  count: number
): Promise<void> {
  await clickMenu(app, id)
  await expect(panes(page)).toHaveCount(count)
  await activeTerminal(page)
}

export async function openPalette({ app, page }: Launched): Promise<void> {
  await clickMenu(app, 'command-palette')
  await expect(page.locator('.palette .query')).toBeFocused()
}

export async function resizeBy(app: ElectronApplication, dw: number, dh: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [dw, dh]) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [w, h] = win.getContentSize()
      win.setContentSize(w + dw, h + dh)
    },
    [dw, dh]
  )
}
