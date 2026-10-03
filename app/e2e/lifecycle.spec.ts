import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import electronBin from 'electron'
import { PROTOCOL_VERSION } from '../src/shared/protocol'
import {
  attachFromOutside,
  expect,
  gridRows,
  resizeBy,
  rows,
  sessionDir,
  sessionFiles,
  sockets,
  test
} from './app'

test('두 번째 실행은 세션을 더 띄우지 않고 끝난다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await page.keyboard.type('echo one-$((0+1))\n')
  await expect(rows(page)).toContainText('one-1')

  const second = spawnSync(electronBin as unknown as string, ['.', `--user-data-dir=${dataDir}`], {
    env: { ...process.env, MARU_UNOBTRUSIVE: '1' },
    timeout: 15_000
  })
  // timeout 의 SIGTERM 에도 Electron 은 0 으로 끝나므로 스스로 끝났는지를 함께 본다.
  expect(
    { status: second.status, signal: second.signal, error: second.error?.message },
    second.stderr.toString()
  ).toEqual({ status: 0, signal: null, error: undefined })
  expect(sockets(dataDir)).toHaveLength(1)
})

test('다른 클라이언트가 primary 를 가져가면 창은 그 크기를 따르고 창 크기로 되돌리지 않는다', async ({
  launch,
  dataDir,
  defer
}) => {
  const { app, page } = await launch()
  await page.keyboard.type('echo ready-$((1+1))\n')
  await expect(rows(page)).toContainText('ready-2')

  const other = await attachFromOutside(sockets(dataDir)[0], 60, 12)
  defer(() => other.destroy())
  await expect(rows(page)).toContainText('입력과 크기를 가져갔다')
  await expect(gridRows(page)).toHaveCount(12)

  await resizeBy(app, 100, 100)
  await page.waitForTimeout(300)
  await expect(gridRows(page)).toHaveCount(12)
})

test('세션을 잇는 utilityProcess 가 죽으면 끊김을 보이고, 새로 고치면 다시 붙는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await page.keyboard.type('X=same-$((5+5)); echo set-$((1+1))\n')
  await expect(rows(page)).toContainText('set-2')
  const pid = await app.evaluate(
    ({ app }) => app.getAppMetrics().find((m) => m.name === 'maru-session-host')!.pid
  )
  process.kill(pid, 'SIGKILL')
  await expect(rows(page)).toContainText('세션 연결이 끊겼다')

  await page.reload()
  await page.waitForSelector('.xterm-screen')
  await page.keyboard.type('echo $X\n')
  await expect(rows(page)).toContainText('same-10')
})

test('maru-session 이 준비 전에 끝나면 그 이유를 터미널에 보인다', async ({ launch, dataDir }) => {
  const bin = join(dataDir, 'fake-session')
  writeFileSync(bin, '#!/bin/sh\necho "reason-from-stderr" >&2\nexit 3\n')
  chmodSync(bin, 0o755)
  const { page } = await launch({ MARU_SESSION_BIN: bin })
  await expect(rows(page)).toContainText('code=3')
  await expect(rows(page)).toContainText('reason-from-stderr')
  expect(sessionFiles(dataDir).filter((n) => n.endsWith('.log'))).toEqual([])
})

test('프로세스가 없는 세션의 레코드는 지우고 새 세션을 띄운다', async ({ launch, dataDir }) => {
  const dir = sessionDir(dataDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dead = spawnSync('/bin/sh', ['-c', 'echo $$']).stdout.toString().trim()
  writeFileSync(
    join(dir, 's-dead.json'),
    JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      id: 's-dead',
      pid: Number(dead),
      created_at_ms: 0
    })
  )
  writeFileSync(join(dir, 's-dead.sock'), '')

  const { page } = await launch()
  await page.keyboard.type('echo fresh-$((3+3))\n')
  await expect(rows(page)).toContainText('fresh-6')
  expect(existsSync(join(dir, 's-dead.json'))).toBe(false)
  expect(existsSync(join(dir, 's-dead.sock'))).toBe(false)
})

test('앱이 강제로 끝나 남은 세션은 다음에 켤 때 끝낸다', async ({ launch, dataDir }) => {
  const first = await launch()
  await first.page.keyboard.type('echo left-$((1+1))\n')
  await expect(rows(first.page)).toContainText('left-2')
  const [left] = sockets(dataDir)
  const closed = new Promise<void>((resolve) => first.app.once('close', () => resolve()))
  first.app.process().kill('SIGKILL')
  await closed
  expect(sockets(dataDir)).toEqual([left])

  const { page } = await launch()
  await page.keyboard.type('echo fresh-$((2+2))\n')
  await expect(rows(page)).toContainText('fresh-4')
  expect(sockets(dataDir)).toHaveLength(1)
  expect(sockets(dataDir)).not.toContain(left)
})

test('남은 세션은 프로토콜 버전이 달라도 kill 로 끝낸다', async ({ launch, dataDir, defer }) => {
  const dir = sessionDir(dataDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const received: Buffer[] = []
  const server = createServer((s: Socket) =>
    s.on('data', (d) => {
      received.push(d)
      rmSync(join(dir, 's-old.json'))
      server.close()
      s.end()
    })
  )
  await new Promise<void>((r) => server.listen(join(dir, 's-old.sock'), r))
  defer(() => server.close())
  writeFileSync(
    join(dir, 's-old.json'),
    JSON.stringify({
      protocol_version: PROTOCOL_VERSION + 1,
      id: 's-old',
      pid: process.pid,
      created_at_ms: Date.now()
    })
  )

  const { page } = await launch()
  await page.keyboard.type('echo other-$((4+4))\n')
  await expect(rows(page)).toContainText('other-8')
  expect(JSON.parse(Buffer.concat(received).subarray(5).toString())).toMatchObject({ type: 'kill' })
  expect(sockets(dataDir)).toHaveLength(1)
  expect(sockets(dataDir)).not.toContain(join(dir, 's-old.sock'))
})

for (const [label, region] of [
  ['', ''],
  [' 스크롤 리전이 걸려 있어도', '\\033[1;20r']
] as const) {
  test(`다시 붙을 때${label} 화면 아래의 빈 행까지 맞춰 이어 그린다`, async ({ launch }) => {
    const { page } = await launch()
    await page.keyboard.type(`seq 1 200; printf '\\033[H\\033[2J${region}'; echo top-$((1+1))\n`)
    await expect(rows(page)).toContainText('top-2')
    await page.reload()

    await expect(rows(page)).toContainText('top-2')
    await page.keyboard.type('echo next-$((2+2))\n')
    await expect(rows(page)).toContainText('next-4')
    const lines = await gridRows(page).allInnerTexts()
    const top = lines.findIndex((l) => l.includes('top-2'))
    const next = lines.findIndex((l) => l.includes('next-4') && !l.includes('echo'))
    expect(top).toBeGreaterThanOrEqual(0)
    expect(next - top).toBe(2)
  })
}

test('세션이 뜨는 동안 다시 연결을 청해도 세션은 하나만 뜬다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await page.reload()
  await page.reload()
  await page.waitForSelector('.xterm-screen')
  await page.keyboard.type('echo single-$((1+1))\n')
  await expect(rows(page)).toContainText('single-2')
  expect(sockets(dataDir)).toHaveLength(1)
})
