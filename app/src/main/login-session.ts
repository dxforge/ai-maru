import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'

const PS_TIMEOUT_MS = 2000
const run = promisify(execFile)

export function etimeSeconds(etime: string): number | null {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime)
  if (!m) return null
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0))
  return ((d * 24 + h) * 60 + min) * 60 + s
}

/**
 * 로그아웃하면 loginwindow 가 새로 떠 로그인 화면을 띄우고, 앱을 다시 띄워도 loginwindow 는 그대로다. 그래서 이 시각을
 * 지금 GUI 로그인 세션이 시작된 시각으로 쓴다. 다시 로그인한 시각보다 앞서지만, 그 사이에는 pty 가 뜨지 않는다.
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

/**
 * `lstart` 는 로캘을 따라 찍혀 파싱이 로캘에 묶이므로 로캘과 상관없는 `etime` 을 읽는다. `ps -U <uid>` 에는
 * loginwindow 가 나오지 않으므로 `-A` 로 모두 받아 uid 로 거른다.
 */
export async function readLoginStartedMs(bin: string, uid: number): Promise<number | null> {
  try {
    const { stdout } = await run(bin, ['-A', '-o', 'uid=,etime=,comm='], {
      encoding: 'utf8',
      timeout: PS_TIMEOUT_MS
    })
    return loginStartedMs(stdout, uid, Date.now())
  } catch {
    return null
  }
}
