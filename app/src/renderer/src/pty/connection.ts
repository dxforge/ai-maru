import type { PtyOpen } from '../../../shared/pty'

/** 문자열은 JSON 메시지, 바이트는 셸 입출력이다. */
export type PtyMessage = string | Uint8Array

export interface PtyConnection {
  send(msg: PtyMessage): void
  onMessage(cb: (msg: PtyMessage) => void): void
  onClose(cb: () => void): void
  /** pty 가 아직 뜨는 중이면 뜬 뒤에 끝낸다. */
  kill(): void
}

/** pty 를 띄우는 데 실패하면 연결로 `{"type":"error"}` 가 오고 닫힌다. */
export function openPty(open: PtyOpen): PtyConnection {
  const key = crypto.randomUUID()
  let port: MessagePort | undefined
  const pending: PtyMessage[] = []
  let onMessage: (msg: PtyMessage) => void = () => {}
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
    if (e.source === window && e.data === 'pty:lost') close()
  }
  const onPort = (e: MessageEvent): void => {
    if (e.source !== window || e.data?.type !== 'pty:port' || e.data.key !== key) return
    window.removeEventListener('message', onPort)
    port = e.ports[0]
    // 포트보다 먼저 온 pty:lost 는 이 open 을 받기 전에 죽은 host 의 것이라 듣지 않는다.
    // main 이 포트를 host 보다 먼저 renderer 에 보내는 순서에 기댄다(main/index.ts 의 pty:open).
    window.addEventListener('message', onLost)
    port.onmessage = ({ data }) => (data === null ? close() : onMessage(data))
    for (const msg of pending.splice(0)) port.postMessage(msg)
  }
  window.addEventListener('message', onPort)
  window.maru.openPty(key, open)
  return {
    send: (msg) => {
      if (port) port.postMessage(msg)
      else pending.push(msg)
    },
    onMessage: (cb) => (onMessage = cb),
    onClose: (cb) => (onClose = cb),
    kill: () => window.maru.killPty(key)
  }
}
