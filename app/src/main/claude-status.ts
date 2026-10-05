import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { ClaudeState } from '../shared/claude'
import { InvalidParams, type Handlers } from './cli-server'

export const HOOK_STATES = new Map<string, ClaudeState>([
  ['SessionStart', 'idle'],
  ['UserPromptSubmit', 'working'],
  ['PermissionRequest', 'waiting'],
  ['Elicitation', 'waiting'],
  ['Stop', 'idle'],
  ['StopFailure', 'idle']
])

/**
 * claude 가 `<config_dir>/sessions/<pid>.json` 에 쓰는 `status`. 문서에 없는 값이다. Esc 로 중단하거나
 * 권한 요청을 거절하거나 허락할 때는 hook 이 오지 않아 이 파일로 따라간다.
 */
const FILE_STATES = new Map<unknown, ClaudeState>([
  ['idle', 'idle'],
  ['shell', 'idle'],
  ['busy', 'working'],
  ['waiting', 'waiting']
])

type Entry = {
  state: ClaudeState
  claudeSession: string
  configDir: string
  /** 마지막 hook 을 받은 시각. 이보다 앞서 쓴 파일 상태는 그 hook 이 이미 지난 것이다. */
  since: number
  file?: string
  polling: boolean
}

type FileStatus = { sessionId?: unknown; status?: unknown; statusUpdatedAt?: unknown }

export type ClaudeStatus = {
  handlers: Handlers
  snapshot(): Record<string, ClaudeState>
  poll(): Promise<void>
  close(): void
}

async function readStatus(path: string): Promise<FileStatus | 'missing' | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : null
  }
  try {
    return JSON.parse(text) as FileStatus
  } catch {
    return null
  }
}

async function find(e: Entry): Promise<FileStatus | 'gone' | null> {
  const dir = join(e.configDir, 'sessions')
  if (e.file) {
    const known = await readStatus(join(dir, e.file))
    if (known === null) return null
    if (known !== 'missing' && known.sessionId === e.claudeSession) return known
  }
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
  } catch {
    return 'gone'
  }
  const read = await Promise.all(names.map((n) => readStatus(join(dir, n))))
  const i = read.findIndex((s) => s !== null && s !== 'missing' && s.sessionId === e.claudeSession)
  if (i === -1) return 'gone'
  e.file = names[i]
  return read[i] as FileStatus
}

export function createClaudeStatus({
  notify,
  now = Date.now,
  intervalMs = 1000
}: {
  notify: (session: string, state: ClaudeState | null) => void
  now?: () => number
  intervalMs?: number
}): ClaudeStatus {
  const entries = new Map<string, Entry>()
  let timer: NodeJS.Timeout | null = null
  let inFlight = false

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  function schedule(): void {
    const active = [...entries.values()].some((e) => e.polling)
    if (!active) stop()
    else if (!timer) timer = setInterval(() => void poll(), intervalMs)
  }

  function set(session: string, e: Entry, state: ClaudeState): void {
    const changed = entries.get(session)?.state !== state
    e.state = state
    e.polling = state !== 'idle'
    entries.set(session, e)
    if (changed) notify(session, state)
    schedule()
  }

  async function pollOne(session: string, e: Entry): Promise<void> {
    const s = await find(e)
    if (entries.get(session) !== e || !e.polling || s === null) return
    if (s === 'gone') {
      e.polling = false
      return
    }
    const state = FILE_STATES.get(s.status)
    if (state && typeof s.statusUpdatedAt === 'number' && s.statusUpdatedAt > e.since) {
      set(session, e, state)
    }
  }

  async function poll(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      await Promise.all(
        [...entries].filter(([, e]) => e.polling).map(([session, e]) => pollOne(session, e))
      )
    } finally {
      inFlight = false
      schedule()
    }
  }

  const handlers: Handlers = {
    'claude.hook': (params, session) => {
      const { event, claude_session: claudeSession, config_dir: configDir } = params
      if (typeof event !== 'string') throw new InvalidParams('params.event must be a string')
      if (typeof claudeSession !== 'string' || claudeSession === '') {
        throw new InvalidParams('params.claude_session must be a non-empty string')
      }
      if (typeof configDir !== 'string' || !isAbsolute(configDir)) {
        throw new InvalidParams('params.config_dir must be an absolute path')
      }
      const state = HOOK_STATES.get(event)
      // 자동 compact 는 턴 도중에도 SessionStart 를 보낸다. 상태는 폴링이 따라간다.
      if (!state || (event === 'SessionStart' && params.source === 'compact')) return null
      const e = entries.get(session) ?? {
        state,
        claudeSession,
        configDir,
        since: 0,
        polling: false
      }
      if (e.claudeSession !== claudeSession || e.configDir !== configDir) e.file = undefined
      e.claudeSession = claudeSession
      e.configDir = configDir
      e.since = now()
      set(session, e, state)
      return null
    },
    'claude.exit': (_params, session) => {
      if (entries.delete(session)) notify(session, null)
      schedule()
      return null
    }
  }

  return {
    handlers,
    snapshot: () => Object.fromEntries([...entries].map(([id, e]) => [id, e.state])),
    poll,
    close: stop
  }
}
