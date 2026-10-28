import type { Socket } from 'node:net'
import type { MessagePortMain } from 'electron'
import { bridge } from './bridge'
import { connect, killPty, socketPath, spawnPty, startDir, type ShellSetup } from './pty'

export type OpenRequest = {
  type: 'open'
  id: string
  cwd?: string
  command?: string[]
  attach?: boolean
  keep?: boolean
  dir: string
  bin: string
  setup: ShellSetup
}
export type KillRequest = { type: 'kill'; id: string; dir: string }
/** host 가 main 에 보내는 것. `live` 는 띄운 pty 에 붙었다는 뜻이다 — main 은 그 pty 의 상태 구독을 연다. */
export type HostEvent = { type: 'live'; id: string }
/** `quit` 을 받은 host 는 띄우는 중인 pty 가 다 뜬 뒤에 끝난다. main 은 host 가 끝난 뒤에 레코드를 읽어야 그 pty 까지 끈다(docs/architecture.md 의 "앱을 끄면 띄우던 pty 도 뜬 뒤에 끈다"). */
export type QuitRequest = { type: 'quit' }
type HostRequest = OpenRequest | KillRequest | QuitRequest

const spawning = new Map<string, Promise<void>>()
let quitting = false

function end(port: MessagePortMain, ...messages: object[]): void {
  for (const msg of messages) port.postMessage(JSON.stringify(msg))
  port.postMessage(null)
  port.close()
}

function serve(id: string, port: MessagePortMain, sock: Socket, spawned: object): void {
  port.postMessage(JSON.stringify({ type: 'spawned', id, ...spawned }))
  bridge(sock, port)
}

/** renderer 가 cwd 를 이미 가지고 있으므로 `spawned` 에 cwd 를 싣지 않는다. */
async function reattach(req: OpenRequest, port: MessagePortMain): Promise<void> {
  const sock = await connect(socketPath(req.dir, req.id)).catch(() => null)
  if (sock) return serve(req.id, port, sock, {})
  end(port, { type: 'gone' })
}

async function open(req: OpenRequest, port: MessagePortMain): Promise<void> {
  if (quitting) return end(port)
  if (req.attach) return reattach(req, port)
  const spawned = startDir(req.cwd).then(async (cwd) => {
    const state = await spawnPty(req.bin, req.dir, req.setup, req.id, cwd, req.command, {
      keep: req.keep
    })
    return { cwd, state }
  })
  // pty 가 뜨는 동안 pane 을 닫아도 kill 이 기다렸다 끝낼 수 있게, await 하기 전에 `spawning` 에 넣는다.
  const done = (): void => void spawning.delete(req.id)
  spawning.set(req.id, spawned.then(done, done))
  try {
    const { cwd, state } = await spawned
    // 소켓을 본 뒤 붙기 전에 끝난 pty 도, 띄운 명령이 그만큼 빨리 끝난 것으로 본다.
    const sock =
      state === 'live' ? await connect(socketPath(req.dir, req.id)).catch(() => null) : null
    if (sock) {
      const live: HostEvent = { type: 'live', id: req.id }
      process.parentPort.postMessage(live)
      return serve(req.id, port, sock, { cwd })
    }
    if (state === 'live') void killPty(req.dir, req.id)
    end(port, { type: 'spawned', id: req.id, cwd }, { type: 'exit', code: null, signal: null })
  } catch (err) {
    end(port, {
      type: 'error',
      code: 'open_failed',
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

async function kill(req: KillRequest): Promise<void> {
  await spawning.get(req.id)
  await killPty(req.dir, req.id)
}

async function quit(): Promise<void> {
  quitting = true
  await Promise.all(spawning.values())
  process.exit(0)
}

process.parentPort.on('message', (e) => {
  const req = e.data as HostRequest
  if (req.type === 'open') void open(req, e.ports[0])
  else if (req.type === 'kill') void kill(req)
  else if (req.type === 'quit') void quit()
})
