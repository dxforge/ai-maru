import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import electronBin from 'electron'
import { PROTOCOL_VERSION } from '../src/shared/protocol'
import {
  attachFromOutside,
  clickMenu,
  expect,
  gridRows,
  hostPid,
  panes,
  resizeBy,
  rows,
  sessionDir,
  sessionFiles,
  slowSessionBin,
  sockets,
  split,
  test,
  typesInto,
  wrapSessionBin
} from './app'

test('두 번째 실행은 세션을 더 띄우지 않고 끝난다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await page.keyboard.type('echo one-$((0+1))\n')
  await expect(rows(page)).toContainText('one-1')

  const second = spawnSync(electronBin as unknown as string, ['.', `--user-data-dir=${dataDir}`], {
    env: { ...process.env, MARU_UNOBTRUSIVE: '1' },
    timeout: 15_000
  })
  const stderr = second.stderr.toString()
  // timeout 의 SIGTERM 에도 Electron 은 0 으로 끝나므로 스스로 끝났는지를 함께 본다.
  expect(
    { status: second.status, signal: second.signal, error: second.error?.message },
    stderr
  ).toEqual({ status: 0, signal: null, error: undefined })
  const printed = stderr.match(/another instance is using (.+); quitting/)?.[1]
  expect(printed && realpathSync(printed), stderr).toBe(realpathSync(dataDir))
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
  await expect(rows(page)).toContainText('took over input and size')
  await expect(gridRows(page)).toHaveCount(12)

  await resizeBy(app, 100, 100)
  await page.waitForTimeout(300)
  await expect(gridRows(page)).toHaveCount(12)
})

test('세션을 잇는 utilityProcess 가 죽으면 끊김을 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await page.keyboard.type('echo set-$((1+1))\n')
  await expect(rows(page)).toContainText('set-2')
  process.kill(await hostPid(app), 'SIGKILL')
  await expect(rows(page)).toContainText('disconnected from the session')
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

test('셸이 뜨기 전에 앱을 끄면 그 세션은 뜬 뒤에 끝난다', async ({ launch, dataDir }) => {
  const started = join(dataDir, 'started')
  const { app } = await launch({ MARU_SESSION_BIN: slowSessionBin(dataDir, `touch '${started}'`) })
  expect(existsSync(started)).toBe(false)

  await app.close()

  await expect.poll(() => existsSync(started), { timeout: 10_000 }).toBe(true)
  // 띄우던 세션이 소켓을 열기에 넉넉한 시간을 기다린 뒤 확인한다.
  await sleep(1000)
  expect(sockets(dataDir)).toEqual([])
})

test('job 이 뜨기 전에 앱을 끄면 그 job 의 세션은 뜬 뒤에 끝난다', async ({ launch, dataDir }) => {
  const bin = wrapSessionBin(
    dataDir,
    'marked-session',
    `touch '${dataDir}/begun-'$$\nsleep 1.5\ntouch '${dataDir}/started-'$$`
  )
  const marks = (prefix: string) => readdirSync(dataDir).filter((n) => n.startsWith(prefix))
  const { app, page } = await launch({ MARU_SESSION_BIN: bin })
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await page.keyboard.type('maru job new --name j sleep 100\n')
  await expect.poll(() => marks('begun-')).toHaveLength(2)
  expect(marks('started-')).toHaveLength(1)

  await app.close()

  await expect.poll(() => marks('started-'), { timeout: 10_000 }).toHaveLength(2)
  // 띄우던 세션이 소켓을 열기에 넉넉한 시간을 기다린 뒤 확인한다.
  await sleep(1000)
  expect(sockets(dataDir)).toEqual([])
})

test('세션을 잇는 utilityProcess 가 멈춰 있어도 앱은 7초 뒤에 꺼지고 세션을 끝낸다', async ({
  launch,
  dataDir
}) => {
  const { app } = await launch()
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  const pid = await hostPid(app)
  process.kill(pid, 'SIGSTOP')
  try {
    const closed = app.close().then(() => 'closed')
    const late = sleep(10_000).then(() => 'still open')
    expect(await Promise.race([closed, late])).toBe('closed')
  } finally {
    // 앱이 host 를 끄지 못했으면 이어서 끝날 수 있게 깨운다.
    try {
      process.kill(pid, 'SIGCONT')
    } catch {
      // 이미 끝났다.
    }
  }
  expect(sockets(dataDir)).toEqual([])
})

test('앱을 끌 때 소켓을 열기 전에 멈춘 세션은 host 가 spawn 시간 제한 뒤에 끝낸다', async ({
  launch,
  dataDir
}) => {
  const stall = join(dataDir, 'stall')
  const pidFile = join(dataDir, 'stalled-pid')
  const bin = wrapSessionBin(
    dataDir,
    'stalling-session',
    `if [ -e '${stall}' ]; then echo $$ > '${pidFile}'; exec sleep 100; fi`
  )
  const { app, page } = await launch({ MARU_SESSION_BIN: bin })
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
  writeFileSync(stall, '')
  const host = await hostPid(app)
  // host 가 open 을 늦게 받게 해, host 의 spawn 시간 제한이 main 의 상한보다 1초 늦게 시작하게 한다.
  process.kill(host, 'SIGSTOP')
  let stalled = 0
  try {
    await split(app, page, 'split-right', 2)
    await sleep(300)
    const closed = app.close()
    await sleep(1000)
    process.kill(host, 'SIGCONT')
    await closed
    stalled = Number(readFileSync(pidFile, 'utf8'))
    await expect.poll(() => alive(stalled), { timeout: 3000 }).toBe(false)
  } finally {
    for (const pid of [host, stalled])
      try {
        if (pid) process.kill(pid, pid === host ? 'SIGCONT' : 'SIGKILL')
      } catch {
        // 이미 끝났다.
      }
  }
})

test('세션을 잇는 utilityProcess 가 죽은 뒤에 닫은 pane 의 세션도 끝난다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'second')
  expect(sockets(dataDir)).toHaveLength(2)
  process.kill(await hostPid(app), 'SIGKILL')
  await expect(rows(page)).toContainText('disconnected from the session')

  await clickMenu(app, 'close-pane')

  await expect(panes(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
