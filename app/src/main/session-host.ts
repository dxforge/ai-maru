import type { MessagePortMain } from 'electron'
import { bridge } from './bridge'
import {
  connect,
  killSession,
  socketPath,
  spawnSession,
  startDir,
  type ShellSetup
} from './session'

export type OpenRequest = {
  type: 'open'
  key: string
  cwd?: string
  dir: string
  bin: string
  setup: ShellSetup
}
export type KillRequest = { type: 'kill'; key: string; dir: string }
type HostRequest = OpenRequest | KillRequest

const opened = new Map<string, Promise<string | null>>()

async function open(req: OpenRequest, port: MessagePortMain): Promise<void> {
  // 세션이 뜨는 동안 칸을 닫아도 kill 이 기다렸다 끝낼 수 있게, await 하기 전에 opened 에 넣는다.
  const spawning = startDir(req.cwd).then(async (cwd) => ({
    id: await spawnSession(req.bin, req.dir, req.setup, cwd),
    cwd
  }))
  opened.set(
    req.key,
    spawning.then(
      ({ id }) => id,
      () => null
    )
  )
  try {
    const { id, cwd } = await spawning
    const sock = await connect(socketPath(req.dir, id))
    sock.on('close', () => opened.delete(req.key))
    port.postMessage(JSON.stringify({ type: 'spawned', id, cwd }))
    bridge(sock, port)
  } catch (err) {
    opened.delete(req.key)
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
  void opened.get(req.key)?.then((id) => (id === null ? undefined : killSession(req.dir, id)))
}

process.parentPort.on('message', (e) => {
  const req = e.data as HostRequest
  if (req.type === 'open') void open(req, e.ports[0])
  else if (req.type === 'kill') kill(req)
})
