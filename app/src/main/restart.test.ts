import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { SCREEN_VERSION, type ScreenState } from '../shared/screen'
import type { JobsFile } from './job'
import {
  checkRestart,
  restartFile,
  screenPtys,
  ptyProtocol,
  takeRestart,
  writeRestart,
  type RestartState
} from './restart'
import { socketPath } from './pty'

const screen: ScreenState = {
  version: SCREEN_VERSION,
  workspaces: [
    {
      key: 3,
      id: 'w-00000001',
      cells: [
        {
          key: 1,
          id: 'c-00000001',
          panes: [
            { key: 0, ptyId: 'p-0000000a', cwd: '/tmp' },
            { key: 2, ptyId: 'p-0000000b', command: ['sh', '-c', 'true'], title: 't' }
          ],
          layout: { split: 'right', first: { pane: 0 }, second: { pane: 2 } },
          focused: 2
        },
        {
          key: 4,
          id: 'c-00000002',
          panes: [{ key: 5, ptyId: 'p-0000000c' }],
          layout: { pane: 5 },
          focused: 5
        }
      ]
    }
  ],
  selected: 1,
  sidebar: { open: false, width: 300, folded: [1] },
  viewMode: 'columns'
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maru-restart-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function fakeBin(output: string): string {
  const bin = join(dir, 'maru-pty')
  writeFileSync(bin, `#!/bin/sh\necho ${output}\n`)
  chmodSync(bin, 0o755)
  return bin
}

describe('restart 파일', () => {
  const jobs: JobsFile = {
    version: 3,
    jobs: [
      {
        pty: 'p-0000000a',
        cell: 'c-1',
        owner: 'p-0000000b',
        command: ['x'],
        pending: false
      }
    ]
  }
  const state: RestartState = { screen, jobs }

  it('쓴 화면·job 표를 한 번만 읽고 지운다', async () => {
    const path = restartFile(dir)
    await writeRestart(path, state)
    expect(await takeRestart(path)).toEqual(state)
    expect(existsSync(path)).toBe(false)
    expect(await takeRestart(path)).toBeNull()
  })

  it('job 표가 없거나 맞지 않으면 그 부분만 버리고, 옛 앱이 쓴 claude 부분은 무시한다', async () => {
    const path = restartFile(dir)
    await writeRestart(path, { screen, jobs: null })
    expect(await takeRestart(path)).toEqual({ screen, jobs: null })
    writeFileSync(
      path,
      JSON.stringify({
        screen,
        jobs: { ...jobs, version: 1 },
        claude: { version: 1, sessions: {} }
      })
    )
    expect(await takeRestart(path)).toEqual({ screen, jobs: null })
  })

  it('화면이 맞지 않거나 깨진 파일은 되살리지 않고 지운다', async () => {
    const path = restartFile(dir)
    const cases = [
      JSON.stringify({ screen: { ...screen, version: SCREEN_VERSION + 1 }, jobs }),
      // 화면만 담던 옛 모양이다.
      JSON.stringify(screen),
      'null',
      '{'
    ]
    for (const text of cases) {
      writeFileSync(path, text)
      expect(await takeRestart(path)).toBeNull()
      expect(existsSync(path)).toBe(false)
    }
  })

  it('쓰지 못하면 던진다', async () => {
    const path = restartFile(dir)
    // 디렉토리가 그 자리에 있으면 tmp 를 옮겨 놓지 못한다.
    mkdirSync(path)
    await expect(writeRestart(path, state)).rejects.toThrow()
  })

  it('화면의 모든 cell 에서 pty id 를 모은다', () => {
    expect(screenPtys(screen)).toEqual(new Set(['p-0000000a', 'p-0000000b', 'p-0000000c']))
    expect(screenPtys(null)).toEqual(new Set())
  })
})

describe('ptyProtocol', () => {
  it('바이너리가 알려 준 버전을 읽고, 못 읽으면 null 이다', async () => {
    expect(await ptyProtocol(fakeBin('7'))).toBe(7)
    expect(await ptyProtocol(fakeBin('nope'))).toBeNull()
    expect(await ptyProtocol(fakeBin(''))).toBeNull()
    expect(await ptyProtocol(join(dir, 'missing'))).toBeNull()
  })
})

describe('checkRestart', () => {
  const ptyDir = (): string => join(dir, 'run')

  it('dev 서버로 띄웠거나 받은 화면이 없으면 재시작하지 않는다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION))
    expect(await checkRestart({ devServer: true, screen, bin, dir: ptyDir() })).toEqual({
      ok: false,
      reason: 'dev_server'
    })
    expect(await checkRestart({ devServer: false, screen: null, bin, dir: ptyDir() })).toEqual({
      ok: false,
      reason: 'no_screen'
    })
  })

  it('버전이 같으면 재시작한다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION))
    expect(await checkRestart({ devServer: false, screen, bin, dir: ptyDir() })).toEqual({
      ok: true
    })
  })

  it('버전이 달라도 산 pty 가 없으면 재시작한다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION + 1))
    expect(await checkRestart({ devServer: false, screen, bin, dir: ptyDir() })).toEqual({
      ok: true
    })
  })

  it('버전이 다르고 산 pty 가 있으면 꺼질 pty 수를 알린다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION + 1))
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = createServer((s) => s.destroy())
    await new Promise<void>((r) => server.listen(socketPath(d, 'p-0000000a'), r))
    writeFileSync(
      join(d, 'p-0000000a.json'),
      JSON.stringify({ protocol_version: PROTOCOL_VERSION, id: 'p-0000000a', pid: process.pid })
    )
    try {
      expect(await checkRestart({ devServer: false, screen, bin, dir: d })).toEqual({
        ok: false,
        reason: 'incompatible',
        ptys: 1,
        protocol: PROTOCOL_VERSION + 1
      })
    } finally {
      server.close()
      rmSync(d, { recursive: true, force: true })
    }
  })
})
