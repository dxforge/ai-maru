import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import electronBin from 'electron'
import { attachFromOutside, killSessions, launch, newDataDir, rows, sessionFiles } from './app'

let dataDir: string
let app: ElectronApplication | undefined
const cleanups: (() => void)[] = []

test.beforeEach(() => {
  dataDir = newDataDir()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  for (const c of cleanups.splice(0)) c()
  await killSessions(dataDir)
})

const socks = () => sessionFiles(dataDir).filter((n) => n.endsWith('.sock'))

test('두 번째 실행은 세션을 더 띄우지 않고 끝난다', async () => {
  const first = await launch(dataDir)
  app = first.app
  await first.page.keyboard.type('echo one-$((0+1))\n')
  await expect(rows(first.page)).toContainText('one-1')

  const second = spawnSync(electronBin as unknown as string, ['.', `--user-data-dir=${dataDir}`], {
    env: { ...process.env, MARU_SHOW_INACTIVE: '1' },
    timeout: 30_000
  })
  expect(second.status).toBe(0)
  expect(socks()).toHaveLength(1)
})

test('다른 클라이언트가 primary 를 가져가면 창은 그 크기를 따르고 창 크기로 되돌리지 않는다', async () => {
  const { app: a, page } = await launch(dataDir)
  app = a
  await page.keyboard.type('echo ready-$((1+1))\n')
  await expect(rows(page)).toContainText('ready-2')

  const other = await attachFromOutside(join(dataDir, 's', socks()[0]), 60, 12)
  cleanups.push(() => other.destroy())
  await expect(rows(page)).toContainText('입력과 크기를 가져갔다')
  await expect(rows(page).locator('> div')).toHaveCount(12)

  await a.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [w, h] = win.getContentSize()
    win.setContentSize(w + 100, h + 100)
  })
  await page.waitForTimeout(300)
  await expect(rows(page).locator('> div')).toHaveCount(12)
})

test('세션을 잇는 utilityProcess 가 죽으면 끊김을 보이고, 새로 고치면 다시 붙는다', async () => {
  const { app: a, page } = await launch(dataDir)
  app = a
  await page.keyboard.type('X=same-$((5+5)); echo set-$((1+1))\n')
  await expect(rows(page)).toContainText('set-2')
  const pid = await a.evaluate(
    ({ app }) => app.getAppMetrics().find((m) => m.name === 'maru-session-host')!.pid
  )
  process.kill(pid, 'SIGKILL')
  await expect(rows(page)).toContainText('세션 연결이 끊겼다')

  await page.reload()
  await page.waitForSelector('.xterm-screen')
  await page.keyboard.type('echo $X\n')
  await expect(rows(page)).toContainText('same-10')
})

test('maru-session 이 준비 전에 끝나면 그 이유를 터미널에 보인다', async () => {
  const bin = join(dataDir, 'fake-session')
  writeFileSync(bin, '#!/bin/sh\necho "reason-from-stderr" >&2\nexit 3\n')
  chmodSync(bin, 0o755)
  const { app: a, page } = await launch(dataDir, { MARU_SESSION_BIN: bin })
  app = a
  await expect(rows(page)).toContainText('code=3')
  await expect(rows(page)).toContainText('reason-from-stderr')
  expect(sessionFiles(dataDir).filter((n) => n.endsWith('.log'))).toEqual([])
})

test('프로세스가 없는 세션의 레코드는 지우고 새 세션을 띄운다', async () => {
  const dir = join(dataDir, 's')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dead = spawnSync('/bin/sh', ['-c', 'echo $$']).stdout.toString().trim()
  writeFileSync(
    join(dir, 's-dead.json'),
    JSON.stringify({ protocol_version: 1, id: 's-dead', pid: Number(dead), created_at_ms: 0 })
  )
  writeFileSync(join(dir, 's-dead.sock'), '')

  const { app: a, page } = await launch(dataDir)
  app = a
  await page.keyboard.type('echo fresh-$((3+3))\n')
  await expect(rows(page)).toContainText('fresh-6')
  expect(existsSync(join(dir, 's-dead.json'))).toBe(false)
  expect(existsSync(join(dir, 's-dead.sock'))).toBe(false)
})

test('프로토콜 버전이 다른 세션에는 붙지 않는다', async () => {
  const dir = join(dataDir, 's')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const received: Buffer[] = []
  const server: Server = createServer((s: Socket) => s.on('data', (d) => received.push(d)))
  await new Promise<void>((r) => server.listen(join(dir, 's-old.sock'), r))
  cleanups.push(() => server.close())
  writeFileSync(
    join(dir, 's-old.json'),
    JSON.stringify({
      protocol_version: 999,
      id: 's-old',
      pid: process.pid,
      created_at_ms: Date.now()
    })
  )

  const { app: a, page } = await launch(dataDir)
  app = a
  await page.keyboard.type('echo other-$((4+4))\n')
  await expect(rows(page)).toContainText('other-8')
  expect(received).toEqual([])
  expect(existsSync(join(dir, 's-old.json'))).toBe(true)
})

test('다시 붙을 때 화면 아래의 빈 행까지 맞춰 이어 그린다', async () => {
  let { app: a, page } = await launch(dataDir)
  // 스크롤백을 남긴 채 화면만 지워, 맨 위 몇 줄 아래로 빈 행이 남게 한다.
  await page.keyboard.type("seq 1 200; printf '\\033[H\\033[2J'; echo top-$((1+1))\n")
  await expect(rows(page)).toContainText('top-2')
  await a.close()

  ;({ app: a, page } = await launch(dataDir))
  app = a
  await expect(rows(page)).toContainText('top-2')
  await page.keyboard.type('echo next-$((2+2))\n')
  await expect(rows(page)).toContainText('next-4')
  const lines = await rows(page).locator('> div').allInnerTexts()
  const top = lines.findIndex((l) => l.includes('top-2'))
  const next = lines.findIndex((l) => l.includes('next-4') && !l.includes('echo'))
  expect(top).toBeGreaterThanOrEqual(0)
  // top-2, 프롬프트+입력, next-4 순서로 붙어 있어야 한다.
  expect(next - top).toBe(2)
})
