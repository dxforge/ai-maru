import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** `lsof -F pn` 의 출력에서 pid 마다 LISTEN 중인 TCP 포트. 같은 포트를 IPv4·IPv6 로 들으면 두 줄이 온다. */
export function parseLsof(out: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  let pid: number | undefined
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    const port = line.startsWith('n') ? Number(/:(\d+)$/.exec(line)?.[1]) : NaN
    if (pid === undefined || !Number.isInteger(port)) continue
    const list = ports.get(pid) ?? []
    if (!list.includes(port)) list.push(port)
    ports.set(pid, list)
  }
  return ports
}

export function parsePs(out: string): Map<number, number[]> {
  const children = new Map<number, number[]>()
  for (const line of out.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    const list = children.get(ppid)
    if (list) list.push(pid)
    else children.set(ppid, [pid])
  }
  return children
}

export function treePorts(
  root: number,
  children: ReadonlyMap<number, number[]>,
  listening: ReadonlyMap<number, number[]>
): number[] {
  const found = new Set<number>()
  const seen = new Set<number>()
  const queue = [root]
  while (queue.length) {
    const pid = queue.pop()!
    if (seen.has(pid)) continue
    seen.add(pid)
    for (const p of listening.get(pid) ?? []) found.add(p)
    queue.push(...(children.get(pid) ?? []))
  }
  return [...found].sort((a, b) => a - b)
}

/** 멈춘 `lsof`(응답하지 않는 마운트 등)를 기다리지 않기 위한 상한이다. `lsof` 를 한 번 돌리는 데 54ms 걸렸다. */
const READ_TIMEOUT_MS = 5_000

export async function readPorts(
  roots: ReadonlyMap<string, number>
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  if (!roots.size) return out
  try {
    const [ps, lsof] = await Promise.all([
      run('/bin/ps', ['-A', '-o', 'pid=,ppid='], { timeout: READ_TIMEOUT_MS }),
      // 듣는 포트가 하나도 없으면 lsof 는 1 로 끝난다.
      run('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'], {
        timeout: READ_TIMEOUT_MS
      }).catch((e: { code?: unknown; stdout?: string }) => {
        if (e.code === 1) return { stdout: e.stdout ?? '' }
        throw e
      })
    ])
    const children = parsePs(ps.stdout)
    const listening = parseLsof(lsof.stdout)
    for (const [pty, pid] of roots) out.set(pty, treePorts(pid, children, listening))
  } catch {
    // 포트는 보조 정보라 재지 못하면 비운다.
  }
  return out
}

export type PortWatchDeps = {
  active: () => boolean
  measure: () => Promise<Map<string, number[]>>
  changed: () => void
  intervalMs: number
}

/**
 * 포트가 바뀌어도 알려 주는 곳이 없어 도는 job 이 있는 동안 주기마다 다시 잰다. `update` 는 job 표가 바뀔 때 부른다.
 */
export function createPortWatch(deps: PortWatchDeps) {
  let ports = new Map<string, number[]>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let measuring = false
  let again = false
  let stopped = false

  async function tick(): Promise<void> {
    if (stopped) return
    clearTimeout(timer)
    timer = undefined
    if (measuring) {
      again = true
      return
    }
    if (!deps.active()) {
      if (ports.size) {
        ports = new Map()
        deps.changed()
      }
      return
    }
    measuring = true
    const next = await deps.measure()
    measuring = false
    if (stopped) return
    const same =
      next.size === ports.size && [...next].every(([k, v]) => ports.get(k)?.join() === v.join())
    ports = next
    if (!same) deps.changed()
    if (again) {
      again = false
      return tick()
    }
    timer = setTimeout(() => void tick(), deps.intervalMs)
  }

  return {
    update: (): void => void tick(),
    ports: (pty: string): number[] => ports.get(pty) ?? [],
    stop: (): void => {
      stopped = true
      clearTimeout(timer)
      timer = undefined
    }
  }
}
