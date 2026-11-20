import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import type { PtyRecord } from './pty'

const PS_TIMEOUT_MS = 2000

/** `ps -o etime` 의 `[[dd-]hh:]mm:ss` 를 초로 바꾼다. 형식이 다르면 null 이다. */
export function etimeSeconds(etime: string): number | null {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime)
  if (!m) return null
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0))
  return ((d * 24 + h) * 60 + min) * 60 + s
}

/**
 * `ps -A -o uid=,etime=,comm=` 의 출력에서 `uid` 의 loginwindow 가 뜬 시각(epoch ms)이다. 여럿이면 가장 늦게 뜬
 * 것이고, 없으면 null 이다. 로그아웃하면 loginwindow 가 새로 뜨고 앱을 다시 띄워서는 그대로이므로, 이 시각이 지금
 * GUI 로그인 세션이 시작된 때다.
 */
export function loginStartedMs(ps: string, uid: number, nowMs: number): number | null {
  let started: number | null = null
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line)
    if (!m || Number(m[1]) !== uid || basename(m[3].trim()) !== 'loginwindow') continue
    const s = etimeSeconds(m[2])
    if (s === null) continue
    const t = nowMs - s * 1000
    started = started === null ? t : Math.max(started, t)
  }
  return started
}

/** `ps` 를 돌리지 못하거나 loginwindow 를 찾지 못하면 null 이다. */
export async function readLoginStartedMs(bin: string, uid: number): Promise<number | null> {
  try {
    const { stdout } = await promisify(execFile)(bin, ['-A', '-o', 'uid=,etime=,comm='], {
      encoding: 'utf8',
      timeout: PS_TIMEOUT_MS
    })
    return loginStartedMs(stdout, uid, Date.now())
  } catch {
    return null
  }
}

/**
 * `keep` 의 pty 가운데 지금 GUI 로그인 세션보다 먼저 뜬 것이 있는지다. 그런 pty 의 셸은 끝난 로그인 세션의 bootstrap
 * port 를 물려받아 키체인·네트워크·클립보드를 쓰지 못한다. `loginStarted` 가 null 이면 판정하지 않는다.
 */
export function fromEarlierLogin(
  live: Pick<PtyRecord, 'id' | 'created_at_ms'>[],
  keep: string[],
  loginStarted: number | null
): boolean {
  if (loginStarted === null) return false
  const kept = new Set(keep)
  return live.some((r) => kept.has(r.id) && r.created_at_ms < loginStarted)
}
