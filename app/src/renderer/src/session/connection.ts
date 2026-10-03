/** 문자열은 JSON 메시지, 바이트는 셸 입출력이다. */
export type SessionMessage = string | Uint8Array

export interface SessionConnection {
  send(msg: SessionMessage): void
  onMessage(cb: (msg: SessionMessage) => void): void
  onClose(cb: () => void): void
}

declare global {
  interface Window {
    maru: { openSession(): void }
  }
}

/** 세션을 찾거나 띄우는 데 실패하면 연결로 `{"type":"error"}` 가 오고 닫힌다. */
export function openSession(): Promise<SessionConnection> {
  return new Promise((resolve) => {
    const onPort = (e: MessageEvent): void => {
      if (e.source !== window || e.data !== 'session:port') return
      window.removeEventListener('message', onPort)
      resolve(portConnection(e.ports[0]))
    }
    window.addEventListener('message', onPort)
    window.maru.openSession()
  })
}

function portConnection(port: MessagePort): SessionConnection {
  let onMessage: (msg: SessionMessage) => void = () => {}
  let onClose: () => void = () => {}
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    window.removeEventListener('message', onLost)
    port.close()
    onClose()
  }
  const onLost = (e: MessageEvent): void => {
    if (e.source === window && e.data === 'session:lost') close()
  }
  window.addEventListener('message', onLost)
  port.onmessage = ({ data }) => (data === null ? close() : onMessage(data))
  return {
    send: (msg) => port.postMessage(msg),
    onMessage: (cb) => (onMessage = cb),
    onClose: (cb) => (onClose = cb)
  }
}
