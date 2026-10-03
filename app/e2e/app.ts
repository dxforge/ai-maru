import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { encodeFrame, TAG_TEXT } from '../src/main/frame'
import { killSessions } from '../src/main/session'
import { PROTOCOL_VERSION } from '../src/shared/protocol'

export { expect } from '@playwright/test'

export type Launched = { app: ElectronApplication; page: Page }

type Fixtures = {
  dataDir: string
  launch: (env?: Record<string, string>) => Promise<Launched>
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
    await use(async (env = {}) => {
      const launched = await launchApp(dataDir, env)
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

async function launchApp(dataDir: string, env: Record<string, string>): Promise<Launched> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    env: {
      ...process.env,
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

export function rows(page: Page) {
  return page.locator('.xterm-rows')
}

export function gridRows(page: Page) {
  return page.locator('.xterm-rows > div')
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
