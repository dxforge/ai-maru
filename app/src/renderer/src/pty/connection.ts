import type { PtyOpen } from '../../../shared/pty'

/** 문자열은 JSON 메시지, 바이트는 셸 입출력이다. */
export type PtyMessage = string | Uint8Array

export interface PtyConnection {
  send(msg: PtyMessage): void
  /** 받은 출력 가운데 `bytes` 만큼을 다 처리했다고 알린다. pty host 는 알리지 않은 양이 쌓이면 출력을 더 읽지 않는다. */
  ack(bytes: number): void
  onMessage(cb: (msg: PtyMessage) => void): void
  onClose(cb: () => void): void
  /** pty 가 아직 뜨는 중이면 뜬 뒤에 끝낸다. */
  kill(): void
  /**
   * 포트를 닫는다. pty 는 끝내지 않고 `onClose` 도 부르지 않는다. 포트가 오기 전이면 온 포트를 바로 닫는다.
   * 닫지 않고 버리면 pty host 의 소켓이 남는다. pty host 는 포트가 닫혀야 소켓을 닫고, 읽기를 멈춘 소켓은 pty 가 끝나도
   * 스스로 닫히지 않기 때문이다.
   */
  close(): void
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
    if (closed) return e.ports[0].close()
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
    // 포트가 오기 전에는 받은 출력이 없다.
    ack: (bytes) => port?.postMessage(bytes),
    onMessage: (cb) => (onMessage = cb),
    onClose: (cb) => (onClose = cb),
    kill: () => window.maru.killPty(key),
    close: () => {
      if (closed) return
      closed = true
      window.removeEventListener('message', onLost)
      pending.length = 0
      port?.close()
    }
  }
}
