import type { Socket } from 'node:net'
import type { MessagePortMain } from 'electron'
import { bridge } from './bridge'
import { connect, liveSessions, socketPath, spawnSession, type CliAccess } from './session'

type Target = { dir: string; bin: string; cli: CliAccess }

export type OpenRequest = Target & { type: 'open'; owner: number; id?: string }
export type RestoreRequest = { type: 'restore'; owner: number; dir: string }
type HostRequest = OpenRequest | RestoreRequest

/** 새로 고친 창이 띄우는 중이던 세션을 잃지도, 하나 더 띄우지도 않게 restore 가 기다린다. */
const spawning = new Set<Promise<string>>()

function spawnTracked({ dir, bin, cli }: Target): Promise<string> {
  const p = spawnSession(bin, dir, cli)
  spawning.add(p)
  p.finally(() => spawning.delete(p)).catch(() => {})
  return p
}

/**
 * 새로 고친 창의 옛 포트에 남은 attach 가 늦게 닿으면 새 연결의 primary 를 빼앗고 곧 끊기는데,
 * 세션은 다른 연결을 primary 로 올리지 않는다. 그래서 restore 는 그 창의 옛 연결을 모두 끊는다.
 */
const owned = new Map<number, Set<() => void>>()

function dropOwned(owner: number): void {
  for (const drop of owned.get(owner) ?? []) drop()
  owned.delete(owner)
}

async function open(req: OpenRequest, port: MessagePortMain): Promise<void> {
  // restore 가 기다릴 수 있게 await 전에 띄운다.
  const resolving = req.id ? Promise.resolve(req.id) : spawnTracked(req)
  let superseded = false
  let sock: Socket | undefined
  const drop = (): void => {
    superseded = true
    sock?.destroy()
    port.close()
  }
  const mine = owned.get(req.owner) ?? new Set()
  owned.set(req.owner, mine.add(drop))
  try {
    const id = await resolving
    if (superseded) return
    sock = await connect(socketPath(req.dir, id))
    if (superseded) {
      sock.destroy()
      return
    }
    sock.on('close', () => mine.delete(drop))
    bridge(sock, port)
  } catch (err) {
    mine.delete(drop)
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

async function restore(req: RestoreRequest, reply: MessagePortMain): Promise<void> {
  dropOwned(req.owner)
  await Promise.allSettled(spawning)
  reply.postMessage(await liveSessions(req.dir))
  reply.close()
}

process.parentPort.on('message', (e) => {
  const req = e.data as HostRequest
  if (req.type === 'open') void open(req, e.ports[0])
  else if (req.type === 'restore') void restore(req, e.ports[0])
})
