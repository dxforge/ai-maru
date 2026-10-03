import type { Socket } from 'node:net'
import type { MessagePortMain } from 'electron'
import { encodeFrame, FrameDecoder, TAG_BINARY, TAG_TEXT } from './frame'

/**
 * 세션 소켓의 프레임을 MessagePort 메시지로 하나씩 옮긴다. Text 프레임은 문자열, Binary
 * 프레임은 Uint8Array 다 — WebSocket 의 메시지 타입과 같은 모양이라 renderer 는 둘 중
 * 어느 쪽에 붙었는지 모른다. 소켓이 닫히면 `null` 을 보낸다.
 */
export function bridge(sock: Socket, port: MessagePortMain): void {
  const decoder = new FrameDecoder()
  const text = new TextDecoder()

  sock.on('data', (chunk) => {
    let frames
    try {
      frames = decoder.push(chunk)
    } catch {
      sock.destroy()
      return
    }
    for (const { tag, payload } of frames) {
      if (tag === TAG_TEXT) port.postMessage(text.decode(payload))
      // 소켓 버퍼의 view 를 그대로 넘기면 structured clone 이 뒤의 ArrayBuffer 전체를 복사한다.
      else if (tag === TAG_BINARY) port.postMessage(new Uint8Array(payload))
    }
  })
  sock.on('close', () => {
    port.postMessage(null)
    port.close()
  })
  sock.on('error', () => {})

  port.on('message', ({ data }) => {
    if (typeof data === 'string') sock.write(encodeFrame(TAG_TEXT, Buffer.from(data)))
    else if (data instanceof Uint8Array) sock.write(encodeFrame(TAG_BINARY, data))
  })
  port.on('close', () => sock.destroy())
  port.start()
}
