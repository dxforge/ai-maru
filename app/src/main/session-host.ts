import type { Socket } from 'node:net'
import type { MessagePortMain } from 'electron'
import { bridge } from './bridge'
import { connect, findLiveSession, socketPath, spawnSession, type CliAccess } from './session'

export type OpenRequest = { type: 'open'; owner: number; dir: string; bin: string; cli: CliAccess }

/** 찾기와 띄우기 사이에 다른 요청이 끼면 둘 다 세션이 없다고 보고 하나씩 띄운다. */
const resolving = new Map<string, Promise<string>>()

function resolveSession(dir: string, bin: string, cli: CliAccess): Promise<string> {
  let p = resolving.get(dir)
  if (!p) {
    p = (async () => (await findLiveSession(dir)) ?? (await spawnSession(bin, dir, cli)))()
    resolving.set(dir, p)
    p.finally(() => resolving.delete(dir)).catch(() => {})
  }
  return p
}

/**
 * 창마다 연결을 하나만 둔다. 새로 고친 창의 옛 포트에 남은 attach 가 늦게 닿으면 새 연결의
 * primary 를 빼앗고 곧 끊기는데, 세션은 다른 연결을 primary 로 올리지 않는다.
 */
const owned = new Map<number, () => void>()

async function open(req: OpenRequest, port: MessagePortMain): Promise<void> {
  owned.get(req.owner)?.()
  let superseded = false
  let sock: Socket | undefined
  const drop = (): void => {
    superseded = true
    sock?.destroy()
    port.close()
  }
  owned.set(req.owner, drop)
  try {
    const id = await resolveSession(req.dir, req.bin, req.cli)
    if (superseded) return
    sock = await connect(socketPath(req.dir, id))
    if (superseded) {
      sock.destroy()
      return
    }
    sock.on('close', () => {
      if (owned.get(req.owner) === drop) owned.delete(req.owner)
    })
    bridge(sock, port)
  } catch (err) {
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

process.parentPort.on('message', (e) => {
  const req = e.data as OpenRequest
  if (req.type === 'open') void open(req, e.ports[0])
})
