import { mkdtempSync, readdirSync } from 'node:fs'
import { createConnection } from 'node:net'
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

/** 앱을 닫아도 세션은 남으므로 테스트가 띄운 것을 kill 요청으로 끝낸다. */
export async function killSessions(dataDir: string): Promise<void> {
  const dir = join(dataDir, 's')
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.sock'))
  } catch {
    return
  }
  await Promise.all(names.map((n) => kill(join(dir, n))))
}

function kill(path: string): Promise<void> {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ type: 'kill', protocol_version: 1 }))
    const head = Buffer.alloc(5)
    head.writeUInt8(1, 0)
    head.writeUInt32BE(body.length, 1)
    const sock = createConnection(path, () => sock.write(Buffer.concat([head, body])))
    sock.on('data', () => sock.end())
    sock.on('close', () => resolve())
    sock.on('error', () => resolve())
  })
}

export function rows(page: Page) {
  return page.locator('.xterm-rows')
}
