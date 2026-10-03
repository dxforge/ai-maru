import { mkdtempSync, readdirSync } from 'node:fs'
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
import { PROTOCOL_VERSION } from '../src/shared/protocol'

export { expect } from '@playwright/test'

export type Launched = { app: ElectronApplication; page: Page }

type Fixtures = {
  /** 테스트마다 새 userData. 세션 디렉토리는 그 아래 `s` 다. */
  dataDir: string
  /** 이 테스트의 dataDir 로 앱을 띄운다. 띄운 앱은 테스트가 끝나면 닫는다. */
  launch: (env?: Record<string, string>) => Promise<Launched>
  /** 테스트가 끝나면 부를 정리. */
  defer: (fn: () => void) => void
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  dataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-e2e-'))
    await use(dir)
    // 앱을 닫아도 세션은 남으므로 테스트가 띄운 것을 kill 요청으로 끝낸다.
    await killSessions(dir)
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

async function killSessions(dataDir: string): Promise<void> {
  await Promise.all(sockets(dataDir).map(kill))
}

function request(v: object): Buffer {
  const body = JSON.stringify({ ...v, protocol_version: PROTOCOL_VERSION })
  return encodeFrame(TAG_TEXT, Buffer.from(body))
}

/** 앱 밖의 클라이언트로 세션에 primary 로 붙는다. 받는 출력은 버린다. */
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

function kill(path: string): Promise<void> {
  return new Promise((resolve) => {
    const sock = createConnection(path, () => sock.write(request({ type: 'kill' })))
    sock.on('data', () => sock.end())
    sock.on('close', () => resolve())
    sock.on('error', () => resolve())
  })
}

export function rows(page: Page) {
  return page.locator('.xterm-rows')
}

/** xterm 그리드의 행들. 행 수가 곧 터미널의 rows 다. */
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
