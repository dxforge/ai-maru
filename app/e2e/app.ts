import { mkdtempSync, readdirSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export function newDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'maru-e2e-'))
}

export async function launch(
  dataDir: string,
  env: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dataDir}`],
    env: {
      ...process.env,
      MARU_SHOW_INACTIVE: '1',
      SHELL: '/bin/bash',
      BASH_SILENCE_DEPRECATION_WARNING: '1',
      ...env
    } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.xterm-screen')
  return { app, page }
}

export function sessionFiles(dataDir: string): string[] {
  try {
    return readdirSync(join(dataDir, 's')).sort()
  } catch {
    return []
  }
}

/** 앱을 닫아도 세션은 남으므로 테스트가 띄운 것을 kill 요청으로 끝낸다. */
export async function killSessions(dataDir: string): Promise<void> {
  const names = sessionFiles(dataDir).filter((n) => n.endsWith('.sock'))
  await Promise.all(names.map((n) => kill(join(dataDir, 's', n))))
}

export function textFrame(v: object): Buffer {
  const body = Buffer.from(JSON.stringify(v))
  const head = Buffer.alloc(5)
  head.writeUInt8(1, 0)
  head.writeUInt32BE(body.length, 1)
  return Buffer.concat([head, body])
}

/** 앱 밖의 클라이언트로 세션에 붙는다. 받는 출력은 버린다. */
export function attachFromOutside(sockPath: string, cols: number, rows: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(sockPath, () => {
      sock.write(textFrame({ type: 'attach', protocol_version: 1, role: 'primary', cols, rows }))
      resolve(sock)
    })
    sock.on('data', () => {})
    sock.on('error', reject)
  })
}

function kill(path: string): Promise<void> {
  return new Promise((resolve) => {
    const sock = createConnection(path, () =>
      sock.write(textFrame({ type: 'kill', protocol_version: 1 }))
    )
    sock.on('data', () => sock.end())
    sock.on('close', () => resolve())
    sock.on('error', () => resolve())
  })
}

export function rows(page: Page) {
  return page.locator('.xterm-rows')
}
