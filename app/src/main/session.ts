import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, constants, existsSync, mkdirSync, openSync } from 'node:fs'
import { access, readdir, readFile, rm, stat } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { PROTOCOL_VERSION, TAG_TEXT } from '../shared/protocol'
import { encodeFrame } from './frame'

const SPAWN_TIMEOUT_MS = 5000
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
  records.sort((a, b) => a.created_at_ms - b.created_at_ms)
  const live = await Promise.all(records.map((rec) => isLive(socketPath(dir, rec.id))))
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

/**
 * 프로세스까지 없는 레코드는 지운다 — 띄우는 중인 세션은 소켓이 아직 안 열렸어도 프로세스는
 * 있다.
 */
export async function killSessions(dir: string, timeoutMs = KILL_TIMEOUT_MS): Promise<void> {
  await Promise.all(
    (await readRecords(dir)).map(async (rec) => {
      const sock = socketPath(dir, rec.id)
      if (await isLive(sock)) {
        await requestKill(sock, timeoutMs)
      } else if (!processExists(rec.pid)) {
        await rm(join(dir, `${rec.id}.json`), { force: true })
        await rm(sock, { force: true })
      }
    })
  )
}

/**
 * 앱을 띄운 쪽의 세션에 속한 값들. AI Maru 터미널의 것을 물려주면 거기서 띄운 claude 는 hook 을
 * 그 터미널의 앱으로 보낸다. 새 셸은 띄운 쪽의 Claude Code 세션이나 tmux 안에 있지 않다.
 */
const INHERITED = new Set(['CLAUDECODE', 'CLAUDE_PID', 'TMUX', 'TMUX_PANE'])
const INHERITED_PREFIXES = ['AI_MARU_', 'CLAUDE_CODE_']

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
    ZDOTDIR: setup.zdotdir
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

const SESSION_ID = /^s-[0-9a-f]{8}$/

/** `spawnSession` 이 만드는 세션 id 의 모양인지. 파일 경로를 만들기 전에 본다. */
export function isSessionId(v: unknown): v is string {
  return typeof v === 'string' && SESSION_ID.test(v)
}

export async function spawnSession(
  bin: string,
  dir: string,
  setup: ShellSetup,
  cwd: string
): Promise<string> {
  const id = `s-${randomBytes(4).toString('hex')}`
  // 준비 전에 끝나면 이유가 stderr 에만 있다. 파이프로 받으면 앱이 끝난 뒤 세션의 쓰기가 실패한다.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const logPath = join(dir, `${id}.log`)
  const log = openSync(logPath, 'w', 0o600)
  const child = spawn(bin, ['--dir', dir, '--id', id, '--cwd', cwd], {
    detached: true,
    env: shellEnv(process.env, id, setup),
    stdio: ['ignore', 'ignore', log]
  })
  closeSync(log)
  child.unref()
  let failure: Error | null = null
  const onError = (e: Error): void => {
    failure = e
  }
  const onExit = (code: number | null, signal: string | null): void => {
    failure = new Error(`maru-session exited before it was ready (code=${code}, signal=${signal})`)
  }
  child.once('error', onError)
  child.once('exit', onExit)
  try {
    const deadline = Date.now() + SPAWN_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (failure) throw failure
      if (await isLive(socketPath(dir, id))) return id
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
