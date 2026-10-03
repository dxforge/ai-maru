import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { PROTOCOL_VERSION, TAG_TEXT } from '../shared/protocol'
import { encodeFrame } from './frame'

const SPAWN_TIMEOUT_MS = 5000
const SPAWN_POLL_MS = 50

type SessionRecord = {
  protocol_version: number
  id: string
  pid: number
  created_at_ms: number
}

export function socketPath(dir: string, id: string): string {
  return join(dir, `${id}.sock`)
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

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
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
    names
      .filter((name) => name.endsWith('.json'))
      .map((name) =>
        readFile(join(dir, name), 'utf8')
          .then((body) => JSON.parse(body) as SessionRecord)
          .catch(() => null)
      )
  )
  return parsed.filter((r): r is SessionRecord => r !== null)
}

/** 레코드는 프로세스가 죽어도 남을 수 있어서, 살아 있는지는 connect 로 가린다. */
export async function findLiveSession(dir: string): Promise<string | null> {
  const records = await readRecords(dir)
  records.sort((a, b) => b.created_at_ms - a.created_at_ms)
  for (const rec of records) {
    if (await isLive(socketPath(dir, rec.id))) return rec.id
  }
  return null
}

/** 셸을 정리하고 소켓·레코드를 지운 뒤에 연결을 닫으므로 닫힐 때까지 기다린다. */
function requestKill(path: string): Promise<void> {
  return new Promise((resolve) => {
    const sock = createConnection(path, () => {
      const body = JSON.stringify({ type: 'kill', protocol_version: PROTOCOL_VERSION })
      sock.write(encodeFrame(TAG_TEXT, Buffer.from(body)))
    })
    sock.on('data', () => sock.end())
    sock.on('close', () => resolve())
    sock.on('error', () => resolve())
  })
}

/**
 * 디렉토리의 세션을 모두 끝낸다. 프로세스까지 없는 레코드는 지운다 — 띄우는 중인 세션은 소켓이
 * 아직 안 열렸어도 프로세스는 있다.
 */
export async function killSessions(dir: string): Promise<void> {
  await Promise.all(
    (await readRecords(dir)).map(async (rec) => {
      const sock = socketPath(dir, rec.id)
      if (await isLive(sock)) {
        await requestKill(sock)
      } else if (!processExists(rec.pid)) {
        await rm(join(dir, `${rec.id}.json`), { force: true })
        await rm(sock, { force: true })
      }
    })
  )
}

/**
 * AI Maru 터미널 안에서 띄운 앱이 그 터미널의 환경을 물려주면, 새 셸은 사용자의 dotfile 대신
 * 그 터미널의 ZDOTDIR 을 읽고 거기서 띄운 claude 는 hook 을 그 터미널의 앱으로 보낸다.
 */
export function sessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => k !== 'ZDOTDIR' && !k.startsWith('AI_MARU_'))
  )
}

export async function spawnSession(bin: string, dir: string): Promise<string> {
  const id = `s-${randomBytes(4).toString('hex')}`
  // 준비 전에 끝나면 이유가 stderr 에만 있다. 파이프로 받으면 앱이 끝난 뒤 세션의 쓰기가 실패한다.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const logPath = join(dir, `${id}.log`)
  const log = openSync(logPath, 'w', 0o600)
  // detached 는 자식을 setsid 로 띄워 앱이 끝날 때 같이 시그널을 받지 않게 한다.
  const child = spawn(bin, ['--dir', dir, '--id', id, '--cwd', homedir()], {
    detached: true,
    env: sessionEnv(process.env),
    stdio: ['ignore', 'ignore', log]
  })
  closeSync(log)
  child.unref()
  let failure: Error | null = null
  const onError = (e: Error): void => {
    failure = e
  }
  const onExit = (code: number | null, signal: string | null): void => {
    failure = new Error(`maru-session 이 준비 전에 끝났다 (code=${code}, signal=${signal})`)
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
    throw new Error(`maru-session 이 ${SPAWN_TIMEOUT_MS}ms 안에 소켓을 열지 않았다`)
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
