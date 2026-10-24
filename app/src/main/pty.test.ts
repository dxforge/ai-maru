import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION, TAG_TEXT } from '../shared/protocol'
import { encodeFrame, FrameDecoder } from './frame'
import {
  capturePty,
  foregroundCwd,
  killPtys,
  readRecord,
  runDir,
  sameDirAs,
  ptyEnv,
  shellEnv,
  socketPath,
  spawnPty,
  startDir,
  utf8Locale,
  waitPtyExit,
  writePtyInput
} from './pty'

const hang = vi.hoisted(() => ({ path: undefined as string | undefined }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    access: (path: string, mode?: number) =>
      path === hang.path ? new Promise<void>(() => {}) : real.access(path, mode)
  }
})

describe('runDir', () => {
  it('MARU_RUN_DIR 가 없거나 비었으면 ~/.ai-maru/run 아래, userData 경로의 해시 8자리 디렉토리다', () => {
    const want = join(homedir(), '.ai-maru', 'run', '6a50dc85')
    expect(runDir('/a', {})).toBe(want)
    expect(runDir('/a', { MARU_RUN_DIR: '' })).toBe(want)
  })

  it('MARU_RUN_DIR 가 있으면 그 아래다', () => {
    expect(runDir('/a', { MARU_RUN_DIR: '/r' })).toBe('/r/6a50dc85')
  })

  it('userData 가 다르면 디렉토리도 다르다', () => {
    expect(runDir('/a', {})).not.toBe(runDir('/b', {}))
  })
})

describe('utf8Locale', () => {
  it('지역 태그를 로케일 이름으로 바꾼다', () => {
    expect(utf8Locale('ko-KR', (n) => n === 'ko_KR.UTF-8')).toBe('ko_KR.UTF-8')
  })

  it('문자 체계가 낀 태그에서도 언어와 지역을 고른다', () => {
    expect(utf8Locale('zh-Hans-CN', (n) => n === 'zh_CN.UTF-8')).toBe('zh_CN.UTF-8')
  })

  it('지역이 없으면 C.UTF-8 이다', () => {
    expect(utf8Locale('en', () => true)).toBe('C.UTF-8')
  })

  it('없는 조합이면 C.UTF-8 이다', () => {
    expect(utf8Locale('en-KR', () => false)).toBe('C.UTF-8')
  })
})

describe('ptyEnv', () => {
  it('앱을 띄운 쪽의 Claude Code·tmux 세션 값은 빼고 나머지는 넘긴다', () => {
    const env = ptyEnv({
      PATH: '/bin',
      HOME: '/h',
      CLAUDECODE: '1',
      CLAUDE_PID: '1',
      TMUX: '/tmp/t,0,0',
      TMUX_PANE: '%0'
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' })
  })

  it.each([
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_SESSION_ID',
    'ANTHROPIC_BASE_URL',
    'MARU_PTY_BIN',
    'ELECTRON_RENDERER_URL'
  ])('%s 처럼 앱·claude·Electron 의 접두사로 시작하는 값은 뺀다', (name) => {
    expect(ptyEnv({ PATH: '/bin', [name]: 'x' })).toEqual({ PATH: '/bin' })
  })

  it('접두사가 이름 중간에 있는 값과 AI_MARU_ 로 시작하는 값은 넘긴다', () => {
    const env = { MY_CLAUDE_X: 'x', XMARU_Y: 'y', AI_MARU_TTY: 't' }
    expect(ptyEnv(env)).toEqual(env)
  })
})

describe('shellEnv', () => {
  const cli = { socket: '/run/app.sock', bin: '/build/bin/maru' }
  const setup = { cli, zdotdir: '/res/zsh', claudePlugin: '/res/claude-plugin' }

  it('앱 소켓과 pty id, CLI 와 claude plugin 의 경로를 넣고 CLI 의 디렉토리를 PATH 앞에 붙인다', () => {
    const env = shellEnv({ PATH: '/usr/bin:/bin', HOME: '/h' }, 'p-1', setup)
    expect(env).toEqual({
      PATH: '/build/bin:/usr/bin:/bin',
      HOME: '/h',
      MARU_SOCKET: '/run/app.sock',
      MARU_PTY_ID: 'p-1',
      MARU_CLI: '/build/bin/maru',
      MARU_CLAUDE_PLUGIN: '/res/claude-plugin',
      ZDOTDIR: '/res/zsh',
      COLORTERM: 'truecolor',
      CLAUDE_CODE_FORCE_STRIKETHROUGH: '1'
    })
  })

  it('앱을 띄운 터미널에서 물려받은 값을 덮는다', () => {
    const env = shellEnv(
      {
        PATH: '/bin',
        MARU_SOCKET: '/outer.sock',
        MARU_PTY_ID: 'p-outer',
        MARU_CLI: '/outer/maru',
        MARU_CLAUDE_PLUGIN: '/outer/plugin',
        COLORTERM: 'outer',
        CLAUDE_CODE_FORCE_STRIKETHROUGH: 'outer'
      },
      'p-1',
      setup
    )
    expect(env).toMatchObject({
      MARU_SOCKET: '/run/app.sock',
      MARU_PTY_ID: 'p-1',
      MARU_CLI: '/build/bin/maru',
      MARU_CLAUDE_PLUGIN: '/res/claude-plugin',
      COLORTERM: 'truecolor',
      CLAUDE_CODE_FORCE_STRIKETHROUGH: '1'
    })
  })

  it('물려받은 ZDOTDIR 대신 앱의 zsh 디렉토리를 넣는다', () => {
    expect(shellEnv({ ZDOTDIR: '/outer' }, 'p-1', setup).ZDOTDIR).toBe('/res/zsh')
  })

  it('PATH 가 없으면 CLI 의 디렉토리만 둔다', () => {
    expect(shellEnv({}, 'p-1', setup).PATH).toBe('/build/bin')
  })

  it('띄운 쪽 pty 의 값은 여기서도 뺀다', () => {
    expect(shellEnv({ PATH: '/bin', ANTHROPIC_BASE_URL: 'u' }, 'p-1', setup)).not.toHaveProperty(
      'ANTHROPIC_BASE_URL'
    )
  })
})

describe('startDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maru-start-'))
  const file = join(dir, 'f')
  writeFileSync(file, '')

  it('있는 디렉토리면 그곳이다', async () => {
    expect(await startDir(dir, '/home')).toBe(dir)
  })

  it('없거나 파일이거나 상대경로면 홈이다', async () => {
    expect(await startDir(join(dir, 'gone'), '/home')).toBe('/home')
    expect(await startDir(file, '/home')).toBe('/home')
    expect(await startDir('.', '/home')).toBe('/home')
  })

  it('응답하지 않는 디렉토리를 검사하는 동안에도 다른 일이 돈다', async () => {
    hang.path = join(dir, 'stuck')
    let settled = false
    void startDir(hang.path, '/home').then(() => (settled = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
    hang.path = undefined
  })

  it('주지 않으면 홈이다', async () => {
    expect(await startDir(undefined, '/home')).toBe('/home')
  })

  it('들어갈 권한이 없으면 홈이다', async () => {
    const locked = join(dir, 'locked')
    mkdirSync(join(locked, 'inner'), { recursive: true })
    chmodSync(locked, 0o000)
    try {
      expect(await startDir(join(locked, 'inner'), '/home')).toBe('/home')
      expect(await startDir(locked, '/home')).toBe('/home')
    } finally {
      chmodSync(locked, 0o755)
    }
  })
})

describe('killPtys', () => {
  it('답하지 않는 pty 를 기다리다 멈추지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-kill-'))
    const server = createServer(() => {})
    await new Promise<void>((r) => server.listen(socketPath(dir, 'p-mute'), r))
    writeFileSync(
      join(dir, 'p-mute.json'),
      JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        id: 'p-mute',
        pid: process.pid,
        created_at_ms: 0
      })
    )
    try {
      const started = Date.now()
      await killPtys(dir, 200)
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      server.close()
    }
  })

  async function fakePty(dir: string, id: string, protocol = PROTOCOL_VERSION) {
    const killed = { value: false }
    const server = createServer((sock) =>
      sock.on('data', () => {
        killed.value = true
        sock.end()
      })
    )
    await new Promise<void>((r) => server.listen(socketPath(dir, id), r))
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({ protocol_version: protocol, id, pid: process.pid, created_at_ms: 0 })
    )
    return { killed, close: () => server.close() }
  }

  it('남길 pty 는 끄지 않고 나머지는 끈다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-keep-'))
    const kept = await fakePty(dir, 'p-0000000a')
    const other = await fakePty(dir, 'p-0000000b')
    try {
      await killPtys(dir, 200, new Set(['p-0000000a']))
      expect(kept.killed.value).toBe(false)
      expect(other.killed.value).toBe(true)
    } finally {
      kept.close()
      other.close()
    }
  })

  it('남길 pty 여도 프로세스까지 없는 레코드는 지운다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-keep-'))
    const dead = spawnSync('true').pid!
    writeFileSync(
      join(dir, 'p-0000000a.json'),
      JSON.stringify({ protocol_version: PROTOCOL_VERSION, id: 'p-0000000a', pid: dead })
    )
    await killPtys(dir, 200, new Set(['p-0000000a']))
    expect(existsSync(join(dir, 'p-0000000a.json'))).toBe(false)
  })

  it('프로토콜 버전이 다른 pty 는 남길 pty 여도 끈다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-keep-'))
    const old = await fakePty(dir, 'p-0000000a', PROTOCOL_VERSION + 1)
    try {
      await killPtys(dir, 200, new Set(['p-0000000a']))
      expect(old.killed.value).toBe(true)
    } finally {
      old.close()
    }
  })
})

async function framePty(answer: (req: Record<string, unknown>, sock: Socket) => void): Promise<{
  dir: string
  id: string
  requests: Record<string, unknown>[]
  closed: Promise<void>
  close: () => void
}> {
  const dir = mkdtempSync(join(tmpdir(), 'maru-ask-'))
  const id = 'p-0000000a'
  const requests: Record<string, unknown>[] = []
  let markClosed = (): void => {}
  const closed = new Promise<void>((r) => (markClosed = r))
  const server = createServer((sock) => {
    const decoder = new FrameDecoder()
    sock.on('data', (chunk) => {
      for (const f of decoder.push(chunk)) {
        if (f.tag !== TAG_TEXT) continue
        const req = JSON.parse(f.payload.toString())
        requests.push(req)
        answer(req, sock)
      }
    })
    sock.on('close', markClosed)
    sock.on('error', () => {})
  })
  await new Promise<void>((r) => server.listen(socketPath(dir, id), r))
  return { dir, id, requests, closed, close: () => server.close() }
}

const send = (sock: Socket, v: object): void =>
  void sock.write(encodeFrame(TAG_TEXT, Buffer.from(JSON.stringify(v))))

describe('waitPtyExit', () => {
  it('답의 종료 상태로 끝나고, 기다리는 status 를 보낸다', async () => {
    const s = await framePty((_req, sock) =>
      send(sock, { type: 'status', exit: { code: 1, signal: null } })
    )
    try {
      expect(await waitPtyExit(s.dir, s.id).exit).toEqual({ code: 1, signal: null })
      expect(s.requests).toEqual([
        { type: 'status', wait: true, protocol_version: PROTOCOL_VERSION }
      ])
    } finally {
      s.close()
    }
  })

  it('답 없이 닫히면 null 이다', async () => {
    const s = await framePty((_req, sock) => sock.end())
    try {
      expect(await waitPtyExit(s.dir, s.id).exit).toBeNull()
    } finally {
      s.close()
    }
  })

  it('cancel 하면 null 로 끝나고 연결을 닫는다', async () => {
    const s = await framePty(() => {})
    try {
      const wait = waitPtyExit(s.dir, s.id)
      await vi.waitFor(() => expect(s.requests).toHaveLength(1))
      wait.cancel()
      expect(await wait.exit).toBeNull()
      await s.closed
    } finally {
      s.close()
    }
  })

  it('pty 가 없으면 null 이다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-ask-'))
    expect(await waitPtyExit(dir, 'p-0000000a').exit).toBeNull()
  })
})

describe('foregroundCwd', () => {
  it('foreground 프로세스의 cwd 를 청해 돌려준다', async () => {
    const s = await framePty((_req, sock) => send(sock, { type: 'foreground', pid: 7, cwd: '/w' }))
    try {
      expect(await foregroundCwd(s.dir, s.id, 1000)).toBe('/w')
      expect(s.requests[0]).toMatchObject({ type: 'foreground' })
    } finally {
      s.close()
    }
  })

  it.each([{ cwd: null }, {}])('pty 가 cwd 를 모르면(%j) null 이다', async (rest) => {
    const s = await framePty((_req, sock) => send(sock, { type: 'foreground', pid: 7, ...rest }))
    try {
      expect(await foregroundCwd(s.dir, s.id, 1000)).toBeNull()
    } finally {
      s.close()
    }
  })

  it('오류 답이나 시간 초과는 실패다', async () => {
    const failing = await framePty((_req, sock) =>
      send(sock, { type: 'error', code: 'unknown_request', message: 'unknown type' })
    )
    const mute = await framePty(() => {})
    try {
      await expect(foregroundCwd(failing.dir, failing.id, 1000)).rejects.toThrow('older maru-pty')
      await expect(foregroundCwd(mute.dir, mute.id, 50)).rejects.toThrow('did not answer')
    } finally {
      failing.close()
      mute.close()
    }
  })
})

describe('sameDirAs', () => {
  it('같은 디렉토리를 가리키면 넘긴 cwd 의 경로를, 다르거나 없는 디렉토리면 foreground 의 경로를 돌려준다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maru-samedir-'))
    mkdirSync(join(root, 'real'))
    mkdirSync(join(root, 'other'))
    symlinkSync(join(root, 'real'), join(root, 'link'))
    try {
      expect(await sameDirAs(join(root, 'real'), join(root, 'link'))).toBe(join(root, 'link'))
      expect(await sameDirAs(join(root, 'other'), join(root, 'link'))).toBe(join(root, 'other'))
      expect(await sameDirAs(join(root, 'gone'), join(root, 'gone'))).toBe(join(root, 'gone'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('capturePty', () => {
  it('접힌 줄을 이어 붙인 글자를 청해 돌려준다', async () => {
    const s = await framePty((_req, sock) => send(sock, { type: 'capture', text: 'out' }))
    try {
      expect(await capturePty(s.dir, s.id, 1000)).toBe('out')
      expect(s.requests[0]).toMatchObject({ type: 'capture', unwrap: true })
    } finally {
      s.close()
    }
  })

  it('오류 답이나 시간 초과는 실패다', async () => {
    const failing = await framePty((_req, sock) =>
      send(sock, { type: 'error', code: 'capture_failed', message: 'boom' })
    )
    const mute = await framePty(() => {})
    try {
      await expect(capturePty(failing.dir, failing.id, 1000)).rejects.toThrow('boom')
      await expect(capturePty(mute.dir, mute.id, 50)).rejects.toThrow('did not answer')
    } finally {
      failing.close()
      mute.close()
    }
  })

  it('pty 가 없으면 시간을 기다리지 않고 없다고 실패한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-ask-'))
    const started = Date.now()
    await expect(capturePty(dir, 'p-0000000a', 5000)).rejects.toThrow(
      'pty p-0000000a is not running'
    )
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('writePtyInput', () => {
  it('받은 글자를 그대로 보내고, 쓴 답과 끝난 답을 가린다', async () => {
    let exited = false
    const s = await framePty((_req, sock) =>
      send(sock, exited ? { type: 'error', code: 'exited' } : { type: 'input' })
    )
    try {
      expect(await writePtyInput(s.dir, s.id, 'r\r', 1000)).toBe('written')
      expect(s.requests[0]).toMatchObject({ type: 'input', text: 'r\r' })
      exited = true
      expect(await writePtyInput(s.dir, s.id, 'x', 1000)).toBe('exited')
    } finally {
      s.close()
    }
  })

  it('답하지 않으면 시간 안에, 다시 보내지 말라는 말과 함께 실패한다', async () => {
    const s = await framePty(() => {})
    try {
      await expect(writePtyInput(s.dir, s.id, 'x', 50)).rejects.toThrow('do not send it again')
    } finally {
      s.close()
    }
  })
})

describe('spawnPty', () => {
  it('keep 이면 명령 앞에 --keep 을 넘긴다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-spawn-'))
    const bin = join(dir, 'fake-pty')
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(dir, 'args')}"\n`)
    chmodSync(bin, 0o755)
    const setup = { cli: { socket: '/s', bin: '/b/maru' }, zdotdir: '/z', claudePlugin: '/p' }
    const id = 'p-0000000a'
    expect(await spawnPty(bin, dir, setup, id, '/', ['sh'], { keep: true })).toBe('ended')
    const args = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n')
    expect(args.slice(-3)).toEqual(['--keep', '--', 'sh'])
  })
})

describe('readRecord', () => {
  it('pty 레코드를 읽고, 없거나 깨졌으면 null 이다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-rec-'))
    const rec = {
      protocol_version: 1,
      id: 'p-0000000a',
      pid: 1,
      shell_pid: 42,
      created_at_ms: 0
    }
    writeFileSync(join(dir, 'p-0000000a.json'), JSON.stringify(rec))
    writeFileSync(join(dir, 'p-0000000b.json'), '{')
    try {
      expect((await readRecord(dir, 'p-0000000a'))?.shell_pid).toBe(42)
      expect(await readRecord(dir, 'p-0000000b')).toBeNull()
      expect(await readRecord(dir, 'p-0000000c')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})
