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
  id: string
  cwd?: string
  command?: string[]
  dir: string
  bin: string
  setup: ShellSetup
}
export type KillRequest = { type: 'kill'; key: string; dir: string }
type HostRequest = OpenRequest | KillRequest

const opened = new Map<string, Promise<string | null>>()

async function open(req: OpenRequest, port: MessagePortMain): Promise<void> {
  // 세션이 뜨는 동안 칸을 닫아도 kill 이 기다렸다 끝낼 수 있게, await 하기 전에 opened 에 넣는다.
  const spawning = startDir(req.cwd).then(async (cwd) => {
    const state = await spawnSession(req.bin, req.dir, req.setup, req.id, cwd, req.command)
    return { id: req.id, cwd, state }
  })
  opened.set(
    req.key,
    spawning.then(
      ({ id }) => id,
      () => null
    )
  )
  try {
    const { id, cwd, state } = await spawning
    // 소켓을 본 뒤 붙기 전에 끝난 세션도, 띄운 명령이 그만큼 빨리 끝난 것으로 본다.
    const sock = state === 'live' ? await connect(socketPath(req.dir, id)).catch(() => null) : null
    if (!sock) {
      opened.delete(req.key)
      port.postMessage(JSON.stringify({ type: 'spawned', id, cwd }))
      port.postMessage(JSON.stringify({ type: 'exit', code: null, signal: null }))
      port.postMessage(null)
      port.close()
      return
    }
    // renderer 가 떠나 포트가 닫히면 `bridge` 가 소켓을 닫지만 세션은 살아 있으므로, main 이 끌 수 있게
    // key 를 남긴다(docs/architecture.md 의 "문서가 바뀌면 이전 문서의 세션을 끈다").
    let detached = false
    port.on('close', () => (detached = true))
    sock.on('close', () => detached || opened.delete(req.key))
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
  const id = opened.get(req.key)
  opened.delete(req.key)
  void id?.then((id) => (id === null ? undefined : killSession(req.dir, id)))
}

process.parentPort.on('message', (e) => {
  const req = e.data as HostRequest
  if (req.type === 'open') void open(req, e.ports[0])
  else if (req.type === 'kill') kill(req)
})
