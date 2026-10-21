import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { SCREEN_VERSION, type ScreenState } from '../shared/screen'
import type { ClaudeFile } from './claude-status'
import type { JobsFile } from './job'
import {
  checkRestart,
  restartFile,
  screenSessions,
  sessionProtocol,
  takeRestart,
  writeRestart,
  type RestartState
} from './restart'
import { socketPath } from './session'

const screen: ScreenState = {
  version: SCREEN_VERSION,
  workspaces: [
    {
      key: 1,
      id: 'w-00000001',
      panes: [
        { key: 0, sessionId: 's-0000000a', cwd: '/tmp' },
        { key: 2, sessionId: 's-0000000b', command: ['sh', '-c', 'true'], title: 't' }
      ],
      layout: { split: 'right', first: { pane: 0 }, second: { pane: 2 } },
      focused: 2
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
  const bin = join(dir, 'maru-session')
  writeFileSync(bin, `#!/bin/sh\necho ${output}\n`)
  chmodSync(bin, 0o755)
  return bin
}

describe('restart 파일', () => {
  const jobs: JobsFile = {
    version: 1,
    jobs: [
      {
        session: 's-0000000a',
        workspace: 'w-1',
        owner: 's-0000000b',
        command: ['x'],
        pending: false
      }
    ]
  }
  const claude: ClaudeFile = {
    version: 1,
    sessions: {
      's-0000000a': {
        state: 'working',
        claudeSession: 'c-1',
        configDir: '/cfg',
        since: 5,
        file: '1.json'
      }
    }
  }
  const state: RestartState = { screen, jobs, claude }

  it('쓴 화면·job 표·claude 상태를 한 번만 읽고 지운다', async () => {
    const path = restartFile(dir)
    await writeRestart(path, state)
    expect(await takeRestart(path)).toEqual(state)
    expect(existsSync(path)).toBe(false)
    expect(await takeRestart(path)).toBeNull()
  })

  it('job 표나 claude 상태가 없거나 맞지 않으면 그 부분만 버린다', async () => {
    const path = restartFile(dir)
    await writeRestart(path, { screen, jobs: null, claude: null })
    expect(await takeRestart(path)).toEqual({ screen, jobs: null, claude: null })
    writeFileSync(
      path,
      JSON.stringify({ screen, jobs: { ...jobs, version: 2 }, claude: { ...claude, version: 2 } })
    )
    expect(await takeRestart(path)).toEqual({ screen, jobs: null, claude: null })
  })

  it('화면이 맞지 않거나 깨진 파일은 되살리지 않고 지운다', async () => {
    const path = restartFile(dir)
    const cases = [
      JSON.stringify({ screen: { ...screen, version: SCREEN_VERSION + 1 }, jobs, claude }),
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

  it('화면의 세션 id 를 모은다', () => {
    expect(screenSessions(screen)).toEqual(new Set(['s-0000000a', 's-0000000b']))
    expect(screenSessions(null)).toEqual(new Set())
  })
})

describe('sessionProtocol', () => {
  it('바이너리가 알려 준 버전을 읽고, 못 읽으면 null 이다', async () => {
    expect(await sessionProtocol(fakeBin('7'))).toBe(7)
    expect(await sessionProtocol(fakeBin('nope'))).toBeNull()
    expect(await sessionProtocol(fakeBin(''))).toBeNull()
    expect(await sessionProtocol(join(dir, 'missing'))).toBeNull()
  })
})

describe('checkRestart', () => {
  const sessions = (): string => join(dir, 's')

  it('dev 서버로 띄웠거나 받은 화면이 없으면 재시작하지 않는다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION))
    expect(await checkRestart({ devServer: true, screen, bin, dir: sessions() })).toEqual({
      ok: false,
      reason: 'dev_server'
    })
    expect(await checkRestart({ devServer: false, screen: null, bin, dir: sessions() })).toEqual({
      ok: false,
      reason: 'no_screen'
    })
  })

  it('버전이 같으면 재시작한다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION))
    expect(await checkRestart({ devServer: false, screen, bin, dir: sessions() })).toEqual({
      ok: true
    })
  })

  it('버전이 달라도 산 세션이 없으면 재시작한다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION + 1))
    expect(await checkRestart({ devServer: false, screen, bin, dir: sessions() })).toEqual({
      ok: true
    })
  })

  it('버전이 다르고 산 세션이 있으면 꺼질 세션 수를 알린다', async () => {
    const bin = fakeBin(String(PROTOCOL_VERSION + 1))
    const d = mkdtempSync(join(tmpdir(), 'maru-live-'))
    const server = createServer((s) => s.destroy())
    await new Promise<void>((r) => server.listen(socketPath(d, 's-0000000a'), r))
    writeFileSync(
      join(d, 's-0000000a.json'),
      JSON.stringify({ protocol_version: PROTOCOL_VERSION, id: 's-0000000a', pid: process.pid })
    )
    try {
      expect(await checkRestart({ devServer: false, screen, bin, dir: d })).toEqual({
        ok: false,
        reason: 'incompatible',
        sessions: 1,
        protocol: PROTOCOL_VERSION + 1
      })
    } finally {
      server.close()
      rmSync(d, { recursive: true, force: true })
    }
  })
})
