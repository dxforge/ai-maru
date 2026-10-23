import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { ClaudeState } from '../shared/claude'
import { isSessionId } from '../shared/session'
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

type Saved = {
  state: ClaudeState
  claudeSession: string
  configDir: string
  /** 마지막 hook 을 받은 시각. 이보다 앞서 쓴 파일 상태는 그 hook 이 이미 지난 것이다. */
  since: number
  file?: string
}

type Entry = Saved & { polling: boolean; cwd?: string }

/** 재시작 전 앱이 쓰고 다시 뜬 앱이 읽는다. 모양을 바꾸면 버전을 올린다. */
export type ClaudeFile = { version: 1; sessions: Record<string, Saved> }

type FileStatus = {
  sessionId?: unknown
  status?: unknown
  statusUpdatedAt?: unknown
  cwd?: unknown
}

export type ClaudeStatus = {
  handlers: Handlers
  snapshot(): Record<string, ClaudeState>
  save(): ClaudeFile
  /** 되살린 항목마다 상태 파일을 한 번 읽어, 재시작 사이에 바뀐 상태를 따른 뒤에 끝난다. */
  restore(file: ClaudeFile): Promise<void>
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
  // 쓰는 도중이라 못 읽은 파일이 그 claude 의 것일 수 있다.
  if (i === -1) return read.includes(null) ? null : 'gone'
  e.file = names[i]
  return read[i] as FileStatus
}

export function createClaudeStatus({
  notify,
  moved,
  now = Date.now,
  intervalMs = 1000
}: {
  notify: (session: string, state: ClaudeState | null) => void
  /** 상태 파일에서 읽은 claude 의 작업 디렉토리가 지난번 읽은 것과 다르면 부른다. 같은 읽기에서 상태도 바뀌었으면 `notify` 만 부른다. */
  moved: (session: string) => void
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

  function set(session: string, e: Entry, state: ClaudeState): boolean {
    const changed = entries.get(session)?.state !== state
    e.state = state
    e.polling = state !== 'idle'
    entries.set(session, e)
    if (changed) notify(session, state)
    schedule()
    return changed
  }

  /**
   * 파일의 `cwd` 도 `status` 처럼 문서에 없는 값이다. claude 는 한 상태에 머문 채 디렉토리를 옮길 수 있고(worktree 로
   * 들어가는 등) 그때는 hook 이 오지 않으므로, 읽은 `cwd` 가 지난번과 다르면 알린다. 상태와 달리 hook 시각과 견주지
   * 않는다. 처음 읽은 `cwd` 는 견줄 기준으로만 둔다 — 항목을 만든 hook 이 이미 알렸기 때문이다. 같은 읽기에서 상태도
   * 바뀌어 알렸으면 `notify` 를 받은 쪽이 그때 다시 읽으므로 따로 알리지 않는다.
   */
  function follow(session: string, e: Entry, s: FileStatus): void {
    const was = e.cwd
    if (typeof s.cwd === 'string') e.cwd = s.cwd
    const state = FILE_STATES.get(s.status)
    const notified =
      state !== undefined &&
      typeof s.statusUpdatedAt === 'number' &&
      s.statusUpdatedAt > e.since &&
      set(session, e, state)
    if (was !== undefined && e.cwd !== was && !notified) moved(session)
  }

  async function pollOne(session: string, e: Entry): Promise<void> {
    const s = await find(e)
    if (entries.get(session) !== e || !e.polling || s === null) return
    if (s === 'gone') e.polling = false
    else follow(session, e, s)
  }

  /**
   * 되살린 항목은 idle 이어도 한 번 읽는다. 앱이 떠 있는 동안 끝난 claude 는 zsh 의 `claude` 함수가
   * `claude.exit` 로 알리므로, 파일이 없어 항목을 지우는 것은 재시작 사이에 끝난 claude 뿐이다.
   */
  async function checkRestored(session: string, e: Entry): Promise<void> {
    const since = e.since
    const s = await find(e)
    if (entries.get(session) !== e || s === null) return
    if (s !== 'gone') follow(session, e, s)
    // 그 사이 hook 이 왔으면 claude 가 살아 있다.
    else if (e.since === since) {
      entries.delete(session)
      notify(session, null)
      schedule()
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
    save: () => ({
      version: 1,
      sessions: Object.fromEntries(
        [...entries].map(([id, { state, claudeSession, configDir, since, file }]) => [
          id,
          { state, claudeSession, configDir, since, file }
        ])
      )
    }),
    restore: async (file) => {
      // CLI 소켓은 되살리기 전에 열리므로, 그 사이 hook 이 만든 항목이 더 새롭다.
      const restored = Object.entries(file.sessions)
        .filter(([session]) => !entries.has(session))
        .map(([session, saved]): [string, Entry] => [
          session,
          { ...saved, polling: saved.state !== 'idle' }
        ])
      for (const [session, e] of restored) entries.set(session, e)
      schedule()
      await Promise.all(restored.map(([session, e]) => checkRestored(session, e)))
    },
    poll,
    close: stop
  }
}

const STATES = new Set<unknown>(HOOK_STATES.values())
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function isSaved(v: unknown): v is Saved {
  return (
    isObj(v) &&
    STATES.has(v.state) &&
    typeof v.claudeSession === 'string' &&
    v.claudeSession !== '' &&
    typeof v.configDir === 'string' &&
    isAbsolute(v.configDir) &&
    typeof v.since === 'number' &&
    (v.file === undefined || typeof v.file === 'string')
  )
}

export function parseClaudeFile(v: unknown): ClaudeFile | null {
  if (!isObj(v) || v.version !== 1 || !isObj(v.sessions)) return null
  if (!Object.entries(v.sessions).every(([id, s]) => isSessionId(id) && isSaved(s))) return null
  return v as ClaudeFile
}
