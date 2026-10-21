import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeState } from '../shared/claude'
import { createClaudeStatus, HOOK_STATES, parseClaudeFile, type ClaudeFile } from './claude-status'
import { InvalidParams } from './cli-server'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function configDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'maru-claude-'))
  dirs.push(d)
  mkdirSync(join(d, 'sessions'))
  return d
}

function statusFile(dir: string, pid: number, body: object | string): void {
  writeFileSync(
    join(dir, 'sessions', `${pid}.json`),
    typeof body === 'string' ? body : JSON.stringify(body)
  )
}

function setup() {
  let t = 1000
  const sent: [string, ClaudeState | null][] = []
  const s = createClaudeStatus({
    notify: (id, st) => sent.push([id, st]),
    now: () => t,
    intervalMs: 60_000
  })
  const hook = (event: string, claude = 'c-1', dir = '/cfg') =>
    s.handlers['claude.hook']({ event, claude_session: claude, config_dir: dir }, 's-1')
  return { s, sent, hook, tick: (ms: number) => (t += ms), now: () => t }
}

describe('claude-status 의 hook', () => {
  it.each([
    ['SessionStart', 'idle'],
    ['UserPromptSubmit', 'working'],
    ['PermissionRequest', 'waiting'],
    ['Elicitation', 'waiting'],
    ['Stop', 'idle'],
    ['StopFailure', 'idle']
  ])('%s 는 %s', async (event, state) => {
    const { s, hook } = setup()
    await hook(event)
    expect(s.snapshot()).toEqual({ 's-1': state })
    s.close()
  })

  it('바뀔 때만 알리고, 모르는 이벤트는 무시한다', async () => {
    const { s, sent, hook } = setup()
    await hook('UserPromptSubmit')
    await hook('UserPromptSubmit')
    await hook('PostToolUse')
    expect(sent).toEqual([['s-1', 'working']])
    s.close()
  })

  it.each(['startup', 'resume', 'clear'])('SessionStart 의 %s 는 idle', async (source) => {
    const { s, hook } = setup()
    await hook('UserPromptSubmit')
    await s.handlers['claude.hook'](
      { event: 'SessionStart', source, claude_session: 'c-1', config_dir: '/cfg' },
      's-1'
    )
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('모르는 이벤트로는 항목을 만들지 않는다', async () => {
    const { s, sent, hook } = setup()
    await hook('PostToolUse')
    expect(s.snapshot()).toEqual({})
    expect(sent).toEqual([])
    s.close()
  })

  it('터미널마다 따로 든다', async () => {
    const { s } = setup()
    const params = { event: 'Stop', claude_session: 'c-2', config_dir: '/cfg' }
    await s.handlers['claude.hook']({ ...params, event: 'UserPromptSubmit' }, 's-1')
    await s.handlers['claude.hook'](params, 's-2')
    expect(s.snapshot()).toEqual({ 's-1': 'working', 's-2': 'idle' })
    s.close()
  })

  it('claude.exit 는 항목을 지우고 null 을 알린다', async () => {
    const { s, sent, hook } = setup()
    await hook('SessionStart')
    await s.handlers['claude.exit']({}, 's-1')
    expect(s.snapshot()).toEqual({})
    expect(sent.at(-1)).toEqual(['s-1', null])
    s.close()
  })

  it('없는 항목의 claude.exit 는 알리지 않는다', async () => {
    const { s, sent } = setup()
    await s.handlers['claude.exit']({}, 's-1')
    expect(sent).toEqual([])
    s.close()
  })

  it.each([
    [{ claude_session: 'c', config_dir: '/c' }],
    [{ event: 'Stop', config_dir: '/c' }],
    [{ event: 'Stop', claude_session: '', config_dir: '/c' }],
    [{ event: 'Stop', claude_session: 'c', config_dir: 'rel' }],
    [{ event: 'Stop', claude_session: 'c' }]
  ])('맞지 않는 params 는 InvalidParams: %j', (params) => {
    const { s } = setup()
    expect(() => s.handlers['claude.hook'](params, 's-1')).toThrow(InvalidParams)
    s.close()
  })
})

describe('claude-status 의 상태 파일 폴링', () => {
  it('working 중 파일이 hook 뒤에 idle 이 되면 idle', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(500)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('hook 보다 오래된 idle 은 무시한다', async () => {
    const { s, hook, now } = setup()
    const dir = configDir()
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() - 1 })
    await hook('UserPromptSubmit', 'c-1', dir)
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'working' })
    s.close()
  })

  it.each([
    ['busy', 'working'],
    ['waiting', 'waiting'],
    ['shell', 'idle'],
    ['idle', 'idle']
  ])('waiting 중 파일 %s → %s', async (status, state) => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('PermissionRequest', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status, statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': state })
    s.close()
  })

  it.each(['napping', 'constructor', 1])('모르는 status 값 %j 는 무시한다', async (status) => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status, statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'working' })
    s.close()
  })

  it('다른 claude 의 파일·깨진 JSON 은 넘기고 맞는 sessionId 만 본다', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    statusFile(dir, 9, '{"sessionId":')
    statusFile(dir, 11, { sessionId: 'other', status: 'idle', statusUpdatedAt: now() })
    statusFile(dir, 12, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('찾아 둔 파일이 쓰는 도중이라 깨져 있으면 이번만 넘긴다', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'busy', statusUpdatedAt: now() })
    await s.poll()
    statusFile(dir, 10, '{"sessionId":"c-1","sta')
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'working' })
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('맞는 파일이 없으면 상태는 두고 폴링에서 뺀다', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    await s.poll()
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'working' })
    s.close()
  })

  it('찾아 둔 파일이 지워지면 다시 찾는다', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'busy', statusUpdatedAt: now() })
    await s.poll()
    rmSync(join(dir, 'sessions', '10.json'))
    statusFile(dir, 11, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('찾아 둔 파일이 다른 claude 의 것이 되면 다시 찾는다', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'busy', statusUpdatedAt: now() })
    await s.poll()
    statusFile(dir, 10, { sessionId: 'other', status: 'busy', statusUpdatedAt: now() })
    statusFile(dir, 11, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('설정 디렉토리가 없어도 실패하지 않는다', async () => {
    const { s, hook } = setup()
    await hook('UserPromptSubmit', 'c-1', '/nonexistent/claude')
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'working' })
    s.close()
  })

  it('/clear 뒤 새 session id 로 오면 새 파일을 찾는다', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'busy', statusUpdatedAt: now() })
    await s.poll()
    await hook('SessionStart', 'c-2', dir)
    await hook('UserPromptSubmit', 'c-2', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-2', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('턴 도중 compact 의 SessionStart 는 상태와 폴링을 그대로 둔다', async () => {
    const { s, sent, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    const compact = { event: 'SessionStart', source: 'compact', claude_session: 'c-1' }
    await s.handlers['claude.hook']({ ...compact, config_dir: dir }, 's-1')
    expect(s.snapshot()).toEqual({ 's-1': 'working' })
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    expect(sent).toEqual([
      ['s-1', 'working'],
      ['s-1', 'idle']
    ])
    s.close()
  })

  it('idle 이 된 항목은 더 읽지 않는다', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('Stop', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'busy', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('읽는 동안 claude.exit 가 오면 읽은 결과를 버린다', async () => {
    const { s, sent, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    const polled = s.poll()
    await s.handlers['claude.exit']({}, 's-1')
    await polled
    expect(s.snapshot()).toEqual({})
    expect(sent.at(-1)).toEqual(['s-1', null])
    s.close()
  })

  it('읽는 동안 Stop 이 오면 읽은 busy 를 버린다', async () => {
    const { s, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'busy', statusUpdatedAt: now() + 10 })
    const polled = s.poll()
    await hook('Stop', 'c-1', dir)
    await polled
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it('claude.exit 뒤에는 읽지 않는다', async () => {
    const { s, sent, hook, tick, now } = setup()
    const dir = configDir()
    await hook('UserPromptSubmit', 'c-1', dir)
    await s.handlers['claude.exit']({}, 's-1')
    tick(1)
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: now() })
    await s.poll()
    expect(s.snapshot()).toEqual({})
    expect(sent.at(-1)).toEqual(['s-1', null])
    s.close()
  })
})

describe('claude-status 의 재시작', () => {
  function saved(dir: string, state: ClaudeState, since = 1000): ClaudeFile {
    return {
      version: 1,
      sessions: { 's-00000001': { state, claudeSession: 'c-1', configDir: dir, since } }
    }
  }

  it('저장한 항목을 다시 뜬 쪽이 알리지 않고 되살린다', async () => {
    const before = setup()
    const dir = configDir()
    statusFile(dir, 10, { sessionId: 'c-1', status: 'busy', statusUpdatedAt: 0 })
    await before.s.handlers['claude.hook'](
      { event: 'UserPromptSubmit', claude_session: 'c-1', config_dir: dir },
      's-00000001'
    )
    await before.s.poll()
    const file = before.s.save()
    expect(file).toEqual({
      version: 1,
      sessions: {
        's-00000001': {
          state: 'working',
          claudeSession: 'c-1',
          configDir: dir,
          since: 1000,
          file: '10.json'
        }
      }
    })
    before.s.close()
    const after = setup()
    await after.s.restore(JSON.parse(JSON.stringify(file)))
    expect(after.s.snapshot()).toEqual({ 's-00000001': 'working' })
    expect(after.sent).toEqual([])
    after.s.close()
  })

  it('되살리기 전에 hook 이 만든 항목은 덮지 않는다', async () => {
    const { s, hook } = setup()
    const dir = configDir()
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: 0 })
    await hook('Stop', 'c-1', dir)
    await s.restore({
      version: 1,
      sessions: { 's-1': { state: 'working', claudeSession: 'c-1', configDir: dir, since: 0 } }
    })
    expect(s.snapshot()).toEqual({ 's-1': 'idle' })
    s.close()
  })

  it.each([
    ['idle', 'busy', 'working'],
    ['working', 'idle', 'idle'],
    ['waiting', 'busy', 'working']
  ] as const)(
    '%s 로 저장한 뒤 파일이 %s 가 되었으면 %s 로 맞추고 알린다',
    async (state, status, want) => {
      const { s, sent } = setup()
      const dir = configDir()
      statusFile(dir, 10, { sessionId: 'c-1', status, statusUpdatedAt: 1001 })
      await s.restore(saved(dir, state))
      expect(s.snapshot()).toEqual({ 's-00000001': want })
      expect(sent).toEqual([['s-00000001', want]])
      s.close()
    }
  )

  it('저장한 hook 시각보다 오래된 파일 상태는 무시한다', async () => {
    const { s, sent } = setup()
    const dir = configDir()
    statusFile(dir, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: 999 })
    await s.restore(saved(dir, 'working'))
    expect(s.snapshot()).toEqual({ 's-00000001': 'working' })
    expect(sent).toEqual([])
    s.close()
  })

  it.each(['idle', 'working'] as const)(
    '%s 로 저장한 claude 의 파일이 없으면 항목을 지우고 null 을 알린다',
    async (state) => {
      const { s, sent } = setup()
      await s.restore(saved(configDir(), state))
      expect(s.snapshot()).toEqual({})
      expect(sent).toEqual([['s-00000001', null]])
      s.close()
    }
  )

  it('되살리는 동안 hook 이 오면 파일이 없어도 지우지 않는다', async () => {
    const { s, tick } = setup()
    const dir = configDir()
    const restored = s.restore(saved(dir, 'working'))
    tick(1)
    await s.handlers['claude.hook'](
      { event: 'Stop', claude_session: 'c-1', config_dir: dir },
      's-00000001'
    )
    await restored
    expect(s.snapshot()).toEqual({ 's-00000001': 'idle' })
    s.close()
  })

  it('되살리는 동안 claude.exit 가 오면 한 번만 알리고 다시 만들지 않는다', async () => {
    const { s, sent } = setup()
    const restored = s.restore(saved(configDir(), 'working'))
    await s.handlers['claude.exit']({}, 's-00000001')
    await restored
    expect(s.snapshot()).toEqual({})
    expect(sent).toEqual([['s-00000001', null]])
    s.close()
  })

  it('찾아 둔 파일이나 디렉토리의 파일이 깨져 못 읽으면 지우지 않고 저장한 상태를 둔다', async () => {
    const { s, sent } = setup()
    const known = configDir()
    const scanned = configDir()
    statusFile(known, 10, '{"sessionId":"c-1","sta')
    statusFile(scanned, 11, '{"sessionId":"c-2","sta')
    await s.restore({
      version: 1,
      sessions: {
        's-00000001': {
          state: 'working',
          claudeSession: 'c-1',
          configDir: known,
          since: 1000,
          file: '10.json'
        },
        's-00000002': { state: 'idle', claudeSession: 'c-2', configDir: scanned, since: 1000 }
      }
    })
    expect(s.snapshot()).toEqual({ 's-00000001': 'working', 's-00000002': 'idle' })
    expect(sent).toEqual([])
    s.close()
  })

  it('되살린 working 항목은 계속 폴링하고, idle 항목은 첫 폴링 뒤 읽지 않는다', async () => {
    const { s } = setup()
    const working = configDir()
    const idle = configDir()
    statusFile(working, 10, { sessionId: 'c-1', status: 'busy', statusUpdatedAt: 999 })
    statusFile(idle, 10, { sessionId: 'c-2', status: 'idle', statusUpdatedAt: 999 })
    await s.restore({
      version: 1,
      sessions: {
        's-00000001': { state: 'working', claudeSession: 'c-1', configDir: working, since: 1000 },
        's-00000002': { state: 'idle', claudeSession: 'c-2', configDir: idle, since: 1000 }
      }
    })
    statusFile(working, 10, { sessionId: 'c-1', status: 'idle', statusUpdatedAt: 1001 })
    statusFile(idle, 10, { sessionId: 'c-2', status: 'busy', statusUpdatedAt: 1001 })
    await s.poll()
    expect(s.snapshot()).toEqual({ 's-00000001': 'idle', 's-00000002': 'idle' })
    s.close()
  })
})

describe('parseClaudeFile', () => {
  const entry = { state: 'idle', claudeSession: 'c-1', configDir: '/cfg', since: 1 }

  it('맞는 모양만 받는다', () => {
    const ok = { version: 1, sessions: { 's-00000001': { ...entry, file: '1.json' } } }
    expect(parseClaudeFile(ok)).toEqual(ok)
    expect(parseClaudeFile({ version: 1, sessions: {} })).toEqual({ version: 1, sessions: {} })
  })

  it.each([
    [undefined],
    [null],
    [{ version: 2, sessions: {} }],
    [{ version: 1, sessions: [] }],
    [{ version: 1, sessions: { 'not-a-session': entry } }],
    [{ version: 1, sessions: { 's-00000001': { ...entry, state: 'busy' } } }],
    [{ version: 1, sessions: { 's-00000001': { ...entry, claudeSession: '' } } }],
    [{ version: 1, sessions: { 's-00000001': { ...entry, configDir: 'rel' } } }],
    [{ version: 1, sessions: { 's-00000001': { ...entry, since: '1' } } }],
    [{ version: 1, sessions: { 's-00000001': { ...entry, file: 1 } } }]
  ])('맞지 않으면 null: %j', (v) => {
    expect(parseClaudeFile(v)).toBeNull()
  })
})

describe('앱 plugin 의 hooks.json', () => {
  it('거는 이벤트가 상태로 바꾸는 이벤트와 같다', () => {
    const path = join(__dirname, '../../resources/claude-plugin/hooks/hooks.json')
    const hooks = JSON.parse(readFileSync(path, 'utf8')).hooks as Record<string, unknown>
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_STATES.keys()].sort())
  })
})
