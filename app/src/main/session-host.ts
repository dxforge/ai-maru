import type { MessagePortMain } from 'electron'
import { bridge } from './bridge'
import { connect, findLiveSession, socketPath, spawnSession } from './session'

export type OpenRequest = { type: 'open'; dir: string; bin: string }

async function open(req: OpenRequest, port: MessagePortMain): Promise<void> {
  try {
    const id = (await findLiveSession(req.dir)) ?? (await spawnSession(req.bin, req.dir))
    bridge(await connect(socketPath(req.dir, id)), port)
  } catch (err) {
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
