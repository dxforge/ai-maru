import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { killSessions, sessionEnv, shellEnv, socketPath, startDir, utf8Locale } from './session'

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

describe('sessionEnv', () => {
  it('띄운 쪽 세션의 값은 빼고 나머지는 넘긴다', () => {
    const env = sessionEnv({
      PATH: '/bin',
      CLAUDE_EFFORT: 'high',
      AI_MARU_TTY: 't',
      CLAUDECODE: '1',
      CLAUDE_PID: '1',
      CLAUDE_CODE_SESSION_ID: 's',
      TMUX: '/tmp/t,0,0',
      TMUX_PANE: '%0'
    })
    expect(env).toEqual({ PATH: '/bin', CLAUDE_EFFORT: 'high' })
  })
})

describe('shellEnv', () => {
  const cli = { socket: '/data/s/app.sock', bin: '/build/bin/maru' }
  const setup = { cli, zdotdir: '/res/zsh' }

  it('앱 소켓과 세션 id 를 넣고 CLI 의 디렉토리를 PATH 앞에 붙인다', () => {
    const env = shellEnv({ PATH: '/usr/bin:/bin', HOME: '/h' }, 's-1', setup)
    expect(env).toEqual({
      PATH: '/build/bin:/usr/bin:/bin',
      HOME: '/h',
      MARU_SOCKET: '/data/s/app.sock',
      MARU_SESSION_ID: 's-1',
      ZDOTDIR: '/res/zsh'
    })
  })

  it('앱을 띄운 터미널에서 물려받은 값을 덮는다', () => {
    const env = shellEnv(
      { PATH: '/bin', MARU_SOCKET: '/outer.sock', MARU_SESSION_ID: 's-outer' },
      's-1',
      setup
    )
    expect(env.MARU_SOCKET).toBe('/data/s/app.sock')
    expect(env.MARU_SESSION_ID).toBe('s-1')
  })

  it('물려받은 ZDOTDIR 대신 앱의 zsh 디렉토리를 넣는다', () => {
    expect(shellEnv({ ZDOTDIR: '/outer' }, 's-1', setup).ZDOTDIR).toBe('/res/zsh')
  })

  it('PATH 가 없으면 CLI 의 디렉토리만 둔다', () => {
    expect(shellEnv({}, 's-1', setup).PATH).toBe('/build/bin')
  })

  it('띄운 쪽 세션의 값은 여기서도 뺀다', () => {
    expect(shellEnv({ PATH: '/bin', AI_MARU_TTY: 't' }, 's-1', setup)).not.toHaveProperty(
      'AI_MARU_TTY'
    )
  })
})

describe('startDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maru-start-'))
  const file = join(dir, 'f')
  writeFileSync(file, '')

  it('있는 디렉토리면 그곳이다', () => {
    expect(startDir(dir, '/home')).toBe(dir)
  })

  it('없거나 파일이거나 상대경로면 홈이다', () => {
    expect(startDir(join(dir, 'gone'), '/home')).toBe('/home')
    expect(startDir(file, '/home')).toBe('/home')
    expect(startDir('.', '/home')).toBe('/home')
  })

  it('주지 않으면 홈이다', () => {
    expect(startDir(undefined, '/home')).toBe('/home')
  })

  it('들어갈 권한이 없으면 홈이다', () => {
    const locked = join(dir, 'locked')
    mkdirSync(join(locked, 'inner'), { recursive: true })
    chmodSync(locked, 0o000)
    try {
      expect(startDir(join(locked, 'inner'), '/home')).toBe('/home')
      expect(startDir(locked, '/home')).toBe('/home')
    } finally {
      chmodSync(locked, 0o755)
    }
  })
})

describe('killSessions', () => {
  it('답하지 않는 세션을 기다리다 멈추지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maru-kill-'))
    const server = createServer(() => {})
    await new Promise<void>((r) => server.listen(socketPath(dir, 's-mute'), r))
    writeFileSync(
      join(dir, 's-mute.json'),
      JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        id: 's-mute',
        pid: process.pid,
        created_at_ms: 0
      })
    )
    try {
      const started = Date.now()
      await killSessions(dir, 200)
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      server.close()
    }
  })
})
