import { execFile } from 'node:child_process'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PROTOCOL_VERSION } from '../shared/protocol'
import { parseScreen, type ScreenState } from '../shared/screen'
import { parseJobsFile, type JobsFile } from './job'
import { livePtys } from './pty'

export function restartFile(userData: string): string {
  return join(userData, 'restart.json')
}

/**
 * 재시작 전 앱이 쓰고 다시 뜬 앱이 읽는다. 두 앱의 빌드가 다를 수 있어 부분마다 따로 버전을 두고,
 * 읽을 때 맞지 않는 부분만 버린다. 화면을 못 읽으면 전부 버린다.
 */
export type RestartState = {
  screen: ScreenState
  jobs: JobsFile | null
}

/** 제자리 truncate 로 쓰면 그 사이 앱이 죽을 때 깨진 파일이 남는다. */
export async function writeRestart(path: string, state: RestartState): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(state), { mode: 0o600 })
  await rename(tmp, path)
}

function parseRestart(v: unknown): RestartState | null {
  if (typeof v !== 'object' || v === null) return null
  const { screen, jobs } = v as Record<string, unknown>
  const parsed = parseScreen(screen)
  if (!parsed) return null
  return { screen: parsed, jobs: parseJobsFile(jobs) }
}

/** 읽자마자 지운다 — 남으면 다음 시작이 재시작이 아닌데도 그 pty 를 남긴다. */
export async function takeRestart(path: string): Promise<RestartState | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  try {
    await rm(path, { force: true })
    return parseRestart(JSON.parse(text))
  } catch {
    return null
  }
}

export function screenPtys(screen: ScreenState | null): Set<string> {
  return new Set(
    screen?.workspaces.flatMap((w) => w.cells.flatMap((c) => c.panes.map((p) => p.ptyId)))
  )
}

const run = promisify(execFile)

export async function ptyProtocol(bin: string): Promise<number | null> {
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
  | { ok: false; reason: 'incompatible'; ptys: number; protocol: number | null }

/**
 * `bin` 은 다음에 뜰 앱의 `maru-pty` 다 — `scripts/install-app.sh` 는 같은 경로의 번들을 갈아
 * 끼운다. 버전이 다르면 다시 뜬 앱은 지금 pty 에 붙지 못하고 끈다.
 */
export async function checkRestart(o: {
  devServer: boolean
  screen: ScreenState | null
  bin: string
  dir: string
}): Promise<RestartCheck> {
  if (o.devServer) return { ok: false, reason: 'dev_server' }
  if (!o.screen) return { ok: false, reason: 'no_screen' }
  const protocol = await ptyProtocol(o.bin)
  if (protocol === PROTOCOL_VERSION) return { ok: true }
  const ptys = (await livePtys(o.dir)).length
  return ptys ? { ok: false, reason: 'incompatible', ptys, protocol } : { ok: true }
}
