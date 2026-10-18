import { execFile } from 'node:child_process'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { parseScreen, type ScreenState } from '../shared/screen'
import { liveSessions } from './session'

export function restartFile(userData: string): string {
  return join(userData, 'restart.json')
}

/** 제자리 truncate 로 쓰면 그 사이 앱이 죽을 때 깨진 파일이 남는다. */
export async function writeScreen(path: string, screen: ScreenState): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(screen), { mode: 0o600 })
  await rename(tmp, path)
}

/** 읽자마자 지운다 — 남으면 다음 시작이 재시작이 아닌데도 그 세션을 남긴다. */
export async function takeScreen(path: string): Promise<ScreenState | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  try {
    await rm(path, { force: true })
    return parseScreen(JSON.parse(text))
  } catch {
    return null
  }
}

export function screenSessions(screen: ScreenState | null): Set<string> {
  return new Set(screen?.workspaces.flatMap((w) => w.panes.map((p) => p.sessionId)))
}

const run = promisify(execFile)

export async function sessionProtocol(bin: string): Promise<number | null> {
  try {
    const { stdout } = await run(bin, ['--protocol-version'])
    const v = stdout.trim()
    return /^\d+$/.test(v) ? Number(v) : null
  } catch {
    return null
  }
}

export type RestartCheck =
  | { ok: true }
  | { ok: false; reason: 'dev_server' | 'no_screen' }
  | { ok: false; reason: 'incompatible'; sessions: number; protocol: number | null }

/**
 * `bin` 은 다음에 뜰 앱의 `maru-session` 이다 — `scripts/install-app.sh` 는 같은 경로의 번들을 갈아
 * 끼운다. 버전이 다르면 다시 뜬 앱은 지금 세션에 붙지 못하고 끈다.
 */
export async function checkRestart(o: {
  devServer: boolean
  screen: ScreenState | null
  bin: string
  dir: string
}): Promise<RestartCheck> {
  if (o.devServer) return { ok: false, reason: 'dev_server' }
  if (!o.screen) return { ok: false, reason: 'no_screen' }
  const protocol = await sessionProtocol(o.bin)
  if (protocol === PROTOCOL_VERSION) return { ok: true }
  const sessions = (await liveSessions(o.dir)).length
  return sessions ? { ok: false, reason: 'incompatible', sessions, protocol } : { ok: true }
}
