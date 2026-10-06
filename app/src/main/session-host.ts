import type { Socket } from 'node:net'
import type { MessagePortMain } from 'electron'
import { bridge } from './bridge'
import {
  connect,
  killSession,
  liveSessions,
  socketPath,
  spawnSession,
  startDir,
  type ShellSetup
} from './session'

type Target = { dir: string; bin: string; setup: ShellSetup }

export type OpenRequest = Target & {
  type: 'open'
  owner: number
  key: string
  id?: string
  cwd?: string
}
export type RestoreRequest = { type: 'restore'; owner: number; dir: string }
export type KillRequest = { type: 'kill'; key: string; dir: string }
type HostRequest = OpenRequest | RestoreRequest | KillRequest

type Spawned = { id: string; cwd: string }

/** 새로 고친 창이 띄우는 중이던 세션을 잃지도, 하나 더 띄우지도 않게 restore 가 기다린다. */
const spawning = new Set<Promise<Spawned>>()
/** 닫은 칸의 세션이 restore 목록에 남지 않게 restore 가 기다린다. */
const killing = new Set<Promise<void>>()

const opened = new Map<string, Promise<string | null>>()

function spawnTracked({ dir, bin, setup }: Target, requested?: string): Promise<Spawned> {
  const p = startDir(requested).then(async (cwd) => ({
    id: await spawnSession(bin, dir, setup, cwd),
    cwd
  }))
  spawning.add(p)
  p.finally(() => spawning.delete(p)).catch(() => {})
  return p
}

/**
 * 새로 고친 창의 옛 포트에 남은 attach 가 늦게 닿으면 새 연결의 primary 를 빼앗고 곧 끊기는데,
 * 세션은 다른 연결을 primary 로 올리지 않는다.
 */
const owned = new Map<number, Set<() => void>>()

function dropOwned(owner: number): void {
  for (const drop of owned.get(owner) ?? []) drop()
  owned.delete(owner)
}

async function open(req: OpenRequest, port: MessagePortMain): Promise<void> {
  // restore 가 기다릴 수 있게 await 전에 띄운다.
  const resolving: Promise<{ id: string; cwd?: string }> = req.id
    ? Promise.resolve({ id: req.id })
    : spawnTracked(req, req.cwd)
  let superseded = false
  let sock: Socket | undefined
  const drop = (): void => {
    superseded = true
    sock?.destroy()
    port.close()
  }
  const mine = owned.get(req.owner) ?? new Set()
  owned.set(req.owner, mine.add(drop))
  opened.set(
    req.key,
    resolving.then(
      ({ id }) => id,
      () => null
    )
  )
  try {
    const { id, cwd } = await resolving
    if (superseded) {
      opened.delete(req.key)
      return
    }
    sock = await connect(socketPath(req.dir, id))
    if (superseded) {
      sock.destroy()
      opened.delete(req.key)
      return
    }
    sock.on('close', () => {
      mine.delete(drop)
      opened.delete(req.key)
    })
    if (cwd !== undefined) port.postMessage(JSON.stringify({ type: 'spawned', id, cwd }))
    bridge(sock, port)
  } catch (err) {
    mine.delete(drop)
    opened.delete(req.key)
    if (superseded) return
    port.postMessage(
      JSON.stringify({
        type: 'error',
        code: 'open_failed',
        message: err instanceof Error ? err.message : String(err)
      })
    )
    port.postMessage(null)
    port.close()
  }
}

function kill(req: KillRequest): void {
  const id = opened.get(req.key)
  if (!id) return
  const p = id.then((id) => (id === null ? undefined : killSession(req.dir, id)))
  killing.add(p)
  void p.finally(() => killing.delete(p))
}

async function restore(req: RestoreRequest, reply: MessagePortMain): Promise<void> {
  dropOwned(req.owner)
  await Promise.allSettled([...spawning, ...killing])
  reply.postMessage(await liveSessions(req.dir))
  reply.close()
}

process.parentPort.on('message', (e) => {
  const req = e.data as HostRequest
  if (req.type === 'open') void open(req, e.ports[0])
  else if (req.type === 'restore') void restore(req, e.ports[0])
  else if (req.type === 'kill') kill(req)
})
