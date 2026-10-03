import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const PROTOCOL_VERSION = 1

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

/** 레코드는 프로세스가 죽어도 남을 수 있어서, 살아 있는지는 connect 로 가린다. */
export async function findLiveSession(dir: string): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const records: SessionRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      records.push(JSON.parse(await readFile(join(dir, name), 'utf8')))
    } catch {
      continue
    }
  }
  records.sort((a, b) => b.created_at_ms - a.created_at_ms)
  for (const rec of records) {
    if (rec.protocol_version !== PROTOCOL_VERSION) continue
    if (await isLive(socketPath(dir, rec.id))) return rec.id
  }
  return null
}

export async function spawnSession(bin: string, dir: string): Promise<string> {
  const id = `s-${randomBytes(4).toString('hex')}`
  // detached 는 자식을 setsid 로 띄워 앱이 끝날 때 같이 시그널을 받지 않게 한다.
  const child = spawn(bin, ['--dir', dir, '--id', id, '--cwd', homedir()], {
    detached: true,
    stdio: 'ignore'
  })
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
  } finally {
    child.off('error', onError)
    child.off('exit', onExit)
  }
}
