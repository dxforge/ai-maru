import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { killSessions, sessionEnv, socketPath, utf8Locale } from './session'

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
      ZDOTDIR: '/z',
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
