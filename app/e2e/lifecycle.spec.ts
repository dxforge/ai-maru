import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import electronBin from 'electron'
import { processExists, QUIT_TIMEOUT_MS, readRecord } from '../src/main/pty'
import { holderPid, waitGone } from '../src/main/takeover'
import { PROTOCOL_VERSION } from '../src/shared/protocol'
import { STATE_VERSIONS } from '../src/shared/screen'
import type { ElectronApplication } from '@playwright/test'
import {
  attachFromOutside,
  cli,
  clickMenu,
  DOM_RENDERER,
  expect,
  gridRows,
  hostPid,
  IGNORE_SAVED_WINDOWS,
  panes,
  resizeBy,
  rows,
  ptyDir,
  ptyFiles,
  screen,
  slowPtyBin,
  sockets,
  spawnApp,
  stateFile,
  split,
  stubDialog,
  END_EVERYTHING,
  test,
  typesInto,
  workspaceNames,
  wrapPtyBin
} from './app'

test('두 번째 실행은 pty 를 더 띄우지 않고 끝난다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await page.keyboard.type('echo one-$((0+1))\n')
  await expect(screen(page)).toShow('one-1')

  const second = spawnSync(
    electronBin as unknown as string,
    ['.', `--user-data-dir=${dataDir}`, ...IGNORE_SAVED_WINDOWS],
    {
      env: { ...process.env, MARU_UNOBTRUSIVE: '1' },
      timeout: 15_000
    }
  )
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

/** 진짜 `lsappinfo` 가 LaunchServices 가 모르는 pid 에 내는 것처럼, 빈 줄을 내고 exit 0 으로 끝나는 가짜 `lsappinfo` 를 만든다. */
function unknownToLaunchServices(dataDir: string): string {
  const bin = join(dataDir, 'lsappinfo')
  writeFileSync(bin, '#!/bin/sh\necho\n')
  chmodSync(bin, 0o755)
  return bin
}

function lockedBy(dataDir: string): number | null {
  try {
    return holderPid(readlinkSync(join(dataDir, 'SingletonLock')))
  } catch {
    return null
  }
}

test('LaunchServices 에 없는 첫 인스턴스는 두 번째 실행에 넘겨 pty 를 남기고 끝나고, 두 번째가 다시 띄운 앱이 같은 pty 에 붙는다', async ({
  launch,
  dataDir,
  defer
}) => {
  const { app, page } = await launch()
  await page.keyboard.type('echo before-$((1+1))\n')
  await expect(screen(page)).toShow('before-2')
  const pty = (await panes(page).first().getAttribute('data-pty'))!
  const shell = (await readRecord(ptyDir(dataDir), pty))!.shell_pid

  const relaunched = await handOverToSecond(app, dataDir, defer)
  await expect
    .poll(async () => (await cli(dataDir, pty, ['pane', 'list']).catch(() => '')).split('\n'))
    .toContainEqual(expect.stringMatching(new RegExp(`^${pty}\\t`)))
  expect((await readRecord(ptyDir(dataDir), pty))!.shell_pid).toBe(shell)
  expect(processExists(shell)).toBe(true)
  expect(await cli(dataDir, pty, ['pane', 'read', pty])).toContain('before-2')
  await quitApp(relaunched, dataDir)
  await expect.poll(() => processExists(shell)).toBe(false)
})

test('넘겨받을 때 설치본의 cells 형식이 다르면 묻지 않고 pty 를 남긴 채 끝나, 다시 띄운 앱이 그 pty 에 붙는다', async ({
  launch,
  dataDir,
  defer
}) => {
  const file = join(dataDir, 'installed-versions.json')
  writeFileSync(file, JSON.stringify({ ...STATE_VERSIONS, cells: STATE_VERSIONS.cells + 1 }))
  const { app, page } = await launch({ MARU_STATE_VERSIONS_FILE: file })
  await expect(panes(page)).toHaveCount(1)
  const pty = (await panes(page).first().getAttribute('data-pty'))!
  // 대화상자를 띄우면 취소를 골라, 앱이 끝나지 않아 테스트가 실패하게 한다.
  await stubDialog(app, 1)

  const relaunched = await handOverToSecond(app, dataDir, defer)
  expect(sockets(dataDir)).toHaveLength(1)
  await expect
    .poll(async () => (await cli(dataDir, pty, ['pane', 'list']).catch(() => '')).split('\n'))
    .toContainEqual(expect.stringMatching(new RegExp(`^${pty}\\t`)))
  await quitApp(relaunched, dataDir)
})

/**
 * 가짜 `lsappinfo` 로 두 번째 인스턴스를 띄워 `app` 을 넘겨받게 하고, 두 번째가 다시 띄운 앱의 pid 를 돌려준다. 테스트가 어디서
 * 실패해도 두 번째 인스턴스와 다시 띄운 앱을 끈다.
 */
async function handOverToSecond(
  app: ElectronApplication,
  dataDir: string,
  defer: (fn: () => unknown) => void
): Promise<number> {
  const first = await app.evaluate(() => process.pid)
  const closed = app.waitForEvent('close')
  const second = spawnApp(dataDir, { MARU_LSAPPINFO_BIN: unknownToLaunchServices(dataDir) })
  defer(() => {
    second.kill('SIGKILL')
    const holder = lockedBy(dataDir)
    if (holder !== null && holder !== first && processExists(holder))
      process.kill(holder, 'SIGKILL')
  })
  let stderr = ''
  second.stderr!.on('data', (d) => (stderr += d))
  const exited = new Promise((resolve) => second.once('exit', (code) => resolve(code)))
  await closed
  expect(await exited, stderr).toBe(0)
  expect(stderr).toContain(`instance ${first} has lost its connection to the window server`)

  let relaunched: number | null = null
  await expect
    .poll(() => {
      relaunched = lockedBy(dataDir)
      return relaunched !== null && relaunched !== first && processExists(relaunched)
    })
    .toBe(true)
  return relaunched!
}

/**
 * SIGTERM 으로 끄면 앱이 pty 도 끄므로 이 테스트가 띄운 shell 이 남지 않는다. 다시 띄운 앱은 Playwright 가 띄우지 않아
 * fixture 가 `exit` 때 거는 SIGKILL 이 없다. 그래서 `will-quit` 이 끝나 `SingletonLock` 이 풀리면 SIGKILL 로 끝낸다.
 */
async function quitApp(pid: number, dataDir: string): Promise<void> {
  process.kill(pid, 'SIGTERM')
  expect(await waitGone(pid, dataDir, 15_000)).toBe(true)
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 이미 끝났다.
  }
}

test('다른 클라이언트가 primary 를 가져가면 창은 그 크기를 따르고 창 크기로 되돌리지 않는다', async ({
  launch,
  dataDir,
  defer
}) => {
  const { app, page } = await launch(DOM_RENDERER)
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

test('pty 를 잇는 utilityProcess 가 죽으면 끊김을 보인다', async ({ launch }) => {
  const { app, page } = await launch(DOM_RENDERER)
  await page.keyboard.type('echo set-$((1+1))\n')
  await expect(rows(page)).toContainText('set-2')
  process.kill(await hostPid(app), 'SIGKILL')
  await expect(rows(page)).toContainText('disconnected from the pty')
})

test('maru-pty 가 준비 전에 끝나면 그 이유를 터미널 첫 줄에 보인다', async ({
  launch,
  dataDir
}) => {
  const bin = join(dataDir, 'fake-pty')
  writeFileSync(bin, '#!/bin/sh\necho "reason-from-stderr" >&2\nexit 3\n')
  chmodSync(bin, 0o755)
  const { page } = await launch({ MARU_PTY_BIN: bin })
  const line = page.locator('.opening-line')
  await expect(line).toContainText('code=3')
  // 이유가 한 줄을 넘쳐 잘려도 마우스를 올려 읽을 수 있다.
  await expect(line.locator('.row-bar-text')).toHaveAttribute('title', /reason-from-stderr/)
  expect(ptyFiles(dataDir).filter((n) => n.endsWith('.log'))).toEqual([])
})

test('프로세스가 없는 pty 의 레코드는 지우고 새 pty 를 띄운다', async ({ launch, dataDir }) => {
  const dir = ptyDir(dataDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dead = spawnSync('/bin/sh', ['-c', 'echo $$']).stdout.toString().trim()
  writeFileSync(
    join(dir, 'p-dead.json'),
    JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      id: 'p-dead',
      pid: Number(dead),
      created_at_ms: 0
    })
  )
  writeFileSync(join(dir, 'p-dead.sock'), '')

  const { page } = await launch()
  await page.keyboard.type('echo fresh-$((3+3))\n')
  await expect(screen(page)).toShow('fresh-6')
  expect(existsSync(join(dir, 'p-dead.json'))).toBe(false)
  expect(existsSync(join(dir, 'p-dead.sock'))).toBe(false)
})

test('앱이 강제로 끝나 남은 pty 가 state.json 의 sessions 에 없으면 다음에 켤 때 끄지 않고 Recovered workspace 에 연다', async ({
  launch,
  dataDir
}) => {
  const first = await launch()
  await first.page.keyboard.type('echo left-$((1+1))\n')
  await expect(screen(first.page)).toShow('left-2')
  const [left] = sockets(dataDir)
  const closed = new Promise<void>((resolve) => first.app.once('close', () => resolve()))
  first.app.process().kill('SIGKILL')
  await closed
  expect(sockets(dataDir)).toEqual([left])
  rmSync(stateFile(dataDir), { force: true })

  const { page } = await launch()
  await expect(workspaceNames(page)).toHaveText(['Recovered'])
  await expect(screen(page)).toShow('left-2')
  await page.keyboard.type('echo again-$((2+2))\n')
  await expect(screen(page)).toShow('again-4')
  expect(sockets(dataDir)).toEqual([left])
})

test('셸이 뜨기 전에 앱을 끄면 띄우던 pty 를 멈추고 남기지 않는다', async ({ launch, dataDir }) => {
  const started = join(dataDir, 'started')
  const { app } = await launch({ MARU_PTY_BIN: slowPtyBin(dataDir, `touch '${started}'`) })
  expect(existsSync(started)).toBe(false)

  await app.close()

  // 멈춘 pty 가 `slowPtyBin` 의 `sleep 1.5` 뒤에 `started` 를 만들지 않는지, 그보다 길게 기다려 확인한다.
  await sleep(2500)
  expect(existsSync(started)).toBe(false)
  expect(sockets(dataDir)).toEqual([])
})

test('job 이 뜨기 전에 앱을 끄면 그 job 의 pty 는 뜬 뒤에 끝난다', async ({ launch, dataDir }) => {
  const bin = wrapPtyBin(
    dataDir,
    'marked-pty',
    `touch '${dataDir}/begun-'$$\nsleep 1.5\ntouch '${dataDir}/started-'$$`
  )
  const marks = (prefix: string) => readdirSync(dataDir).filter((n) => n.startsWith(prefix))
  const { app, page } = await launch({ MARU_PTY_BIN: bin })
  await expect.poll(() => sockets(dataDir), { timeout: 10_000 }).toHaveLength(1)
  await page.keyboard.type('maru job new --name j sleep 100\n')
  await expect.poll(() => marks('begun-')).toHaveLength(2)
  expect(marks('started-')).toHaveLength(1)

  // 띄우는 중인 job 도 끝나지 않은 job 이라 묻는다.
  await stubDialog(app, END_EVERYTHING)
  await app.close()

  await expect.poll(() => marks('started-'), { timeout: 10_000 }).toHaveLength(2)
  // 띄우던 pty 가 소켓을 열기에 넉넉한 시간을 기다린 뒤 확인한다.
  await sleep(1000)
  expect(sockets(dataDir)).toEqual([])
})

test('pty 를 잇는 utilityProcess 가 멈춰 있어도 앱은 7초 뒤에 꺼지고 pty 를 끝낸다', async ({
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

test('main 의 JS 가 끝난 뒤의 뒷정리가 오래 걸려도 테스트의 app.close 는 그것을 기다리지 않는다', async ({
  launch
}) => {
  const { app } = await launch()
  const slowMs = 20_000
  // Electron 이 `exit` 뒤에 하는 뒷정리 대신, `exit` 에서 main 을 `slowMs` 동안 멈추는 listener 를 더한다. fixture 가
  // `launch` 때 등록한 SIGKILL listener 가 먼저 불리므로, 이 listener 는 돌지 않는다.
  await app.evaluate((_electron, ms) => {
    process.on('exit', () => {
      const end = Date.now() + ms
      while (Date.now() < end);
    })
  }, slowMs)
  const started = Date.now()
  await app.close()
  expect(Date.now() - started).toBeLessThan(slowMs / 2)
})

for (const { name, trap } of [
  { name: '앱을 끌 때 소켓을 열기 전에 멈춘 pty 는 기다리지 않고 멈춘다', trap: '' },
  {
    name: '앱을 끌 때 소켓을 열기 전에 멈춰 SIGTERM 으로 끝나지 않는 pty 도 SIGKILL 로 멈춘다',
    trap: "trap '' TERM; "
  }
]) {
  test(name, async ({ launch, dataDir }) => {
    const stall = join(dataDir, 'stall')
    const pidFile = join(dataDir, 'stalled-pid')
    const bin = wrapPtyBin(
      dataDir,
      'stalling-pty',
      `if [ -e '${stall}' ]; then ${trap}echo $$ > '${pidFile}'; exec sleep 100; fi`
    )
    const { app, page } = await launch({ MARU_PTY_BIN: bin })
    await expect.poll(() => sockets(dataDir)).toHaveLength(1)
    writeFileSync(stall, '')
    await split(app, page, 'split-right', 2)
    await expect.poll(() => existsSync(pidFile)).toBe(true)
    const stalled = Number(readFileSync(pidFile, 'utf8'))
    try {
      const start = Date.now()
      await app.close()
      expect(Date.now() - start).toBeLessThan(QUIT_TIMEOUT_MS)
      await expect.poll(() => alive(stalled), { timeout: 3000 }).toBe(false)
    } finally {
      try {
        process.kill(stalled, 'SIGKILL')
      } catch {
        // 이미 끝났다.
      }
    }
  })
}

test('pty 를 잇는 utilityProcess 가 죽은 뒤에 닫은 pane 의 pty 도 끝난다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch(DOM_RENDERER)
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'second')
  expect(sockets(dataDir)).toHaveLength(2)
  process.kill(await hostPid(app), 'SIGKILL')
  await expect(rows(page)).toContainText('disconnected from the pty')

  await clickMenu(app, 'close-pane')

  await expect(panes(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir)).toHaveLength(1)
})

test('저장하다 앱이 죽어 남은 임시 파일은 다음 실행이 지운다', async ({ launch, dataDir }) => {
  const left = ['state.json.123.4.tmp', 'launcher.json.123.5.tmp'].map((n) => join(dataDir, n))
  for (const file of left) writeFileSync(file, '{')
  await launch()
  expect(left.filter((file) => existsSync(file))).toEqual([])
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
