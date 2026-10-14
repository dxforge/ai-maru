/** 문자열은 JSON 메시지, 바이트는 셸 입출력이다. */
export type SessionMessage = string | Uint8Array

export interface SessionConnection {
  send(msg: SessionMessage): void
  onMessage(cb: (msg: SessionMessage) => void): void
  onClose(cb: () => void): void
  /** 세션이 아직 뜨는 중이면 뜬 뒤에 끝낸다. */
  kill(): void
}

/** 세션을 띄우는 데 실패하면 연결로 `{"type":"error"}` 가 오고 닫힌다. */
export function openSession(cwd?: string): SessionConnection {
  const key = crypto.randomUUID()
  let port: MessagePort | undefined
  const pending: SessionMessage[] = []
  let onMessage: (msg: SessionMessage) => void = () => {}
  let onClose: () => void = () => {}
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    window.removeEventListener('message', onLost)
    port!.close()
    onClose()
  }
  const onLost = (e: MessageEvent): void => {
    if (e.source === window && e.data === 'session:lost') close()
  }
  const onPort = (e: MessageEvent): void => {
    if (e.source !== window || e.data?.type !== 'session:port' || e.data.key !== key) return
    window.removeEventListener('message', onPort)
    port = e.ports[0]
    window.addEventListener('message', onLost)
    port.onmessage = ({ data }) => (data === null ? close() : onMessage(data))
    for (const msg of pending.splice(0)) port.postMessage(msg)
  }
  window.addEventListener('message', onPort)
  window.maru.openSession(key, cwd)
  return {
    send: (msg) => {
      if (port) port.postMessage(msg)
      else pending.push(msg)
    },
    onMessage: (cb) => (onMessage = cb),
    onClose: (cb) => (onClose = cb),
    kill: () => window.maru.killSession(key)
  }
}
