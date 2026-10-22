import { spawn } from 'node:child_process'
import { closeSync, constants, existsSync, mkdirSync, openSync } from 'node:fs'
import { access, readdir, readFile, rm, stat } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { PROTOCOL_VERSION, TAG_TEXT } from '../shared/protocol'
import { isSessionId } from '../shared/session'
import { encodeFrame, FrameDecoder } from './frame'

const SPAWN_TIMEOUT_MS = 5000
// 앱을 끌 때 main 이 host 와 띄우던 job 을 기다리는 상한이다. `spawnSession` 은 시간 제한 안에 소켓이 열리지
// 않으면 그 세션에 SIGTERM 을 보내므로, 상한은 spawn 시간 제한보다 길어야 한다. host 의 시간 제한은 open 을
// 받고 시작 폴더를 확인한 뒤에 시작하므로 2초를 더 둔다.
export const QUIT_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 2000
const SPAWN_POLL_MS = 50
// maru-session 은 셸에 2초를 주고 연결을 1초 더 비운 뒤 끝난다.
const KILL_TIMEOUT_MS = 5000

type SessionRecord = {
  protocol_version: number
  id: string
  pid: number
  shell_pid: number
  created_at_ms: number
}

export function socketPath(dir: string, id: string): string {
  return join(dir, `${id}.sock`)
}

/** 세션 id 는 `s-` 로 시작하므로 세션 소켓과 겹치지 않는다. */
export function appSocketPath(dir: string): string {
  return join(dir, 'app.sock')
}

export function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path)
    sock.once('connect', () => {
      sock.off('error', reject)
      resolve(sock)
    })
    sock.once('error', reject)
  })
}

async function isLive(path: string): Promise<boolean> {
  try {
    ;(await connect(path)).destroy()
    return true
  } catch {
    return false
  }
}

export function sessionLive(dir: string, id: string): Promise<boolean> {
  return isLive(socketPath(dir, id))
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function readRecord(dir: string, id: string): Promise<SessionRecord | null> {
  try {
    return JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')) as SessionRecord
  } catch {
    return null
  }
}

async function readRecords(dir: string): Promise<SessionRecord[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const parsed = await Promise.all(
    names.filter((name) => name.endsWith('.json')).map((name) => readRecord(dir, name.slice(0, -5)))
  )
  return parsed.filter((r): r is SessionRecord => r !== null)
}

export async function liveSessions(dir: string): Promise<string[]> {
  const records = await readRecords(dir)
  const live = await Promise.all(records.map((rec) => sessionLive(dir, rec.id)))
  return records.filter((_, i) => live[i]).map((rec) => rec.id)
}

/**
 * 셸을 정리하고 소켓·레코드를 지운 뒤에 연결을 닫으므로 닫힐 때까지 기다린다. 멈춘 프로세스도
 * 커널이 connect 를 받아 주므로, 답이 없으면 기다리기를 그만둔다.
 */
function requestKill(path: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const sock = createConnection(path, () => {
      const body = JSON.stringify({ type: 'kill', protocol_version: PROTOCOL_VERSION })
      sock.write(encodeFrame(TAG_TEXT, Buffer.from(body)))
    })
    const timer = setTimeout(() => sock.destroy(), timeoutMs)
    sock.on('data', () => sock.end())
    sock.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
    sock.on('error', () => {})
  })
}

export function killSession(dir: string, id: string, timeoutMs = KILL_TIMEOUT_MS): Promise<void> {
  return requestKill(socketPath(dir, id), timeoutMs)
}

type Reply = Record<string, unknown>

function ask(
  dir: string,
  id: string,
  body: object
): { reply: Promise<Reply | null>; cancel: () => void; reached: () => boolean } {
  let sock: Socket | null = null
  let connected = false
  let settle: (r: Reply | null) => void = () => {}
  const reply = new Promise<Reply | null>((resolve) => {
    let done = false
    settle = (r) => {
      if (done) return
      done = true
      sock?.destroy()
      resolve(r)
    }
    const decoder = new FrameDecoder()
    sock = createConnection(socketPath(dir, id), () => {
      connected = true
      const req = JSON.stringify({ ...body, protocol_version: PROTOCOL_VERSION })
      sock!.write(encodeFrame(TAG_TEXT, Buffer.from(req)))
    })
    sock.on('data', (chunk) => {
      let frames
      try {
        frames = decoder.push(chunk)
      } catch {
        return settle(null)
      }
      const text = frames.find((f) => f.tag === TAG_TEXT)
      if (!text) return
      try {
        settle(JSON.parse(text.payload.toString()) as Reply)
      } catch {
        settle(null)
      }
    })
    sock.on('close', () => settle(null))
    sock.on('error', () => {})
  })
  return { reply, cancel: () => settle(null), reached: () => connected }
}

async function askWithin(
  dir: string,
  id: string,
  body: object,
  timeoutMs: number,
  late = `session ${id} did not answer within ${timeoutMs / 1000}s`
): Promise<Reply> {
  const { reply, cancel, reached } = ask(dir, id, body)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    cancel()
  }, timeoutMs)
  const r = await reply.finally(() => clearTimeout(timer))
  if (r) return r
  if (!reached()) throw new Error(`session ${id} is not running`)
  throw new Error(timedOut ? late : `session ${id} closed the connection without answering`)
}

export type SessionExit = { code: number | null; signal: number | null }

/** 셸이 스스로 끝나면 그 종료 상태로 끝난다. 세션이 셸을 끝냈거나 닿지 못하면 null 이다. */
export function waitSessionExit(
  dir: string,
  id: string
): { exit: Promise<SessionExit | null>; cancel: () => void } {
  const { reply, cancel } = ask(dir, id, { type: 'status', wait: true })
  const exit = reply.then((r) => (r?.type === 'status' && r.exit ? (r.exit as SessionExit) : null))
  return { exit, cancel }
}

function cannotRead(id: string, r: Reply): Error {
  return new Error(`cannot read session ${id}: ${String(r.message ?? r.code)}`)
}

export async function captureSession(dir: string, id: string, timeoutMs: number): Promise<string> {
  const r = await askWithin(dir, id, { type: 'capture', unwrap: true }, timeoutMs)
  if (r.type !== 'capture' || typeof r.text !== 'string') throw cannotRead(id, r)
  return r.text
}

/** foreground 프로세스(프롬프트에서는 셸, 명령이 돌면 그 명령)의 cwd. 세션이 모르면 null 이다. */
export async function foregroundCwd(
  dir: string,
  id: string,
  timeoutMs: number
): Promise<string | null> {
  const r = await askWithin(dir, id, { type: 'foreground' }, timeoutMs)
  // `foreground` 를 더하며 `PROTOCOL_VERSION` 을 올리지 않았으므로, 앱을 새로 깔아도 이 요청을 모르는 이전 maru-session 의 세션이 남아 있을 수 있다.
  if (r.code === 'unknown_request') {
    throw new Error(`session ${id} runs an older maru-session; restart it to open relative paths`)
  }
  if (r.type !== 'foreground') throw cannotRead(id, r)
  return typeof r.cwd === 'string' ? r.cwd : null
}

export async function writeSessionInput(
  dir: string,
  id: string,
  text: string,
  timeoutMs: number
): Promise<'written' | 'exited'> {
  // 시간이 지나도 입력은 들어가므로 다시 보내지 말라고 알린다(maru-session 의 `lib.rs`).
  const late =
    `session ${id} has not taken the input within ${timeoutMs / 1000}s. ` +
    'It gets the input once the program reads it, so do not send it again.'
  const r = await askWithin(dir, id, { type: 'input', text }, timeoutMs, late)
  if (r.type === 'input') return 'written'
  if (r.code === 'exited') return 'exited'
  throw new Error(`cannot write to session ${id}: ${String(r.message ?? r.code)}`)
}

/**
 * 프로세스까지 없는 레코드는 지운다 — 띄우는 중인 세션은 소켓이 아직 안 열렸어도 프로세스는
 * 있다.
 */
export async function killSessions(
  dir: string,
  timeoutMs = KILL_TIMEOUT_MS,
  keep: ReadonlySet<string> = new Set()
): Promise<void> {
  await Promise.all(
    (await readRecords(dir)).map(async (rec) => {
      const sock = socketPath(dir, rec.id)
      if (await isLive(sock)) {
        if (keep.has(rec.id) && rec.protocol_version === PROTOCOL_VERSION) return
        await requestKill(sock, timeoutMs)
      } else if (!processExists(rec.pid)) {
        await rm(join(dir, `${rec.id}.json`), { force: true })
        await rm(sock, { force: true })
      }
    })
  )
}

/**
 * 앱을 띄운 쪽의 세션에 속한 값들. 새 셸은 띄운 쪽의 Claude Code 세션이나 tmux 안에 있지 않다. claude 의
 * 설정을 물려주면 터미널에서 띄운 claude 가 띄운 쪽의 설정 디렉토리·API 주소를 쓴다. 앱·Electron 의 설정을
 * 물려주면 터미널에서 띄운 AI Maru 가 띄운 쪽 앱의 `MARU_SESSION_BIN`·`ELECTRON_RENDERER_URL` 같은 값을 읽는다.
 * 터미널은 로그인 셸이라 사용자가 rc 에서 export 한 값은 셸이 다시 설정한다.
 */
const INHERITED = new Set(['CLAUDECODE', 'CLAUDE_PID', 'TMUX', 'TMUX_PANE'])
const INHERITED_PREFIXES = ['MARU_', 'CLAUDE_', 'ANTHROPIC_', 'ELECTRON_']

export function sessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([k]) => !INHERITED.has(k) && !INHERITED_PREFIXES.some((p) => k.startsWith(p))
    )
  )
}

export type CliAccess = { socket: string; bin: string }

export type ShellSetup = { cli: CliAccess; zdotdir: string; claudePlugin: string }

/** 계약은 core/crates/maru 의 모듈 doc 에 있다. */
export function shellEnv(env: NodeJS.ProcessEnv, id: string, setup: ShellSetup): NodeJS.ProcessEnv {
  const base = sessionEnv(env)
  return {
    ...base,
    MARU_SOCKET: setup.cli.socket,
    MARU_SESSION_ID: id,
    MARU_CLI: setup.cli.bin,
    MARU_CLAUDE_PLUGIN: setup.claudePlugin,
    PATH: [dirname(setup.cli.bin), base.PATH].filter(Boolean).join(delimiter),
    ZDOTDIR: setup.zdotdir,
    // truecolor 는 앱 터미널(xterm.js)이 지원하므로 띄운 쪽 터미널의 값을 덮어쓴다.
    COLORTERM: 'truecolor',
    // claude 는 TERM_PROGRAM 으로 알아보는 터미널이거나 이 값이 있을 때만 마크다운 취소선을 SGR 9 로 낸다. xterm.js 는
    // SGR 9 를 그린다(`e2e/strikethrough.spec.ts`). `sessionEnv` 가 CLAUDE_ 를 거르므로 거른 뒤에 넣는다.
    CLAUDE_CODE_FORCE_STRIKETHROUGH: '1'
  }
}

export async function startDir(cwd: string | undefined, home = homedir()): Promise<string> {
  if (!cwd || !isAbsolute(cwd)) return home
  try {
    await access(cwd, constants.X_OK)
    return (await stat(cwd)).isDirectory() ? cwd : home
  } catch {
    return home
  }
}

export function utf8Locale(
  tag: string,
  exists = (name: string) => existsSync(join('/usr/share/locale', name))
): string {
  const [lang, ...rest] = tag.split('-')
  const region = rest.find((p) => /^[A-Z]{2}$/.test(p))
  const name = `${lang}_${region}.UTF-8`
  return region && exists(name) ? name : 'C.UTF-8'
}

export async function spawnSession(
  bin: string,
  dir: string,
  setup: ShellSetup,
  id: string,
  cwd: string,
  command: string[] = [],
  { keep = false, env = process.env }: { keep?: boolean; env?: NodeJS.ProcessEnv } = {}
): Promise<'live' | 'ended'> {
  if (!isSessionId(id)) throw new Error(`not a session id: ${id}`)
  // 준비 전에 끝나면 이유가 stderr 에만 있다. 파이프로 받으면 앱이 끝난 뒤 세션의 쓰기가 실패한다.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const logPath = join(dir, `${id}.log`)
  const log = openSync(logPath, 'w', 0o600)
  const args = ['--dir', dir, '--id', id, '--cwd', cwd]
  if (keep) args.push('--keep')
  if (command.length) args.push('--', ...command)
  const child = spawn(bin, args, {
    detached: true,
    env: shellEnv(env, id, setup),
    stdio: ['ignore', 'ignore', log]
  })
  closeSync(log)
  child.unref()
  let failure: Error | null = null
  let ended = false
  const onError = (e: Error): void => {
    failure = e
  }
  // maru-session 은 소켓을 연 뒤에 셸이 끝나야 0 으로 끝난다. 바로 끝나는 명령은 앱이 소켓을 확인하기 전에
  // 끝날 수 있다.
  const onExit = (code: number | null, signal: string | null): void => {
    if (code === 0) ended = true
    else
      failure = new Error(
        `maru-session exited before it was ready (code=${code}, signal=${signal})`
      )
  }
  child.once('error', onError)
  child.once('exit', onExit)
  try {
    const deadline = Date.now() + SPAWN_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (failure) throw failure
      if (ended) return 'ended'
      if (await isLive(socketPath(dir, id))) return 'live'
      await sleep(SPAWN_POLL_MS)
    }
    child.kill('SIGTERM')
    throw new Error(`maru-session did not open its socket within ${SPAWN_TIMEOUT_MS}ms`)
  } catch (err) {
    const stderr = (await readFile(logPath, 'utf8').catch(() => '')).trim()
    if (stderr && err instanceof Error) err.message += `: ${stderr}`
    throw err
  } finally {
    child.off('error', onError)
    child.off('exit', onExit)
    await rm(logPath, { force: true })
  }
}
