import type { Socket } from 'node:net'
import type { MessagePortMain } from 'electron'
import { encodeFrame, FrameDecoder, TAG_BINARY, TAG_TEXT } from './frame'

/**
 * renderer 가 처리했다고 알리지 않은 출력이 `HIGH` 바이트를 넘으면 소켓을 읽지 않고, `LOW` 아래로 내려가면 다시 읽는다.
 * 읽지 않는 동안 이 연결이 primary 면 `maru-pty` 는 셸의 출력을 더 읽지 않고, observer 면 4 MiB 넘게 밀린 뒤 resync 를 보낸다. 출력이 쏟아질 때 renderer 앞에 쌓이는 양을
 * 이만큼으로 묶어, Ctrl-C 뒤에 그리고 남은 출력이 곧 끝나게 하려는 것이다. 값은 xterm.js 의 flow control 안내를 따른다.
 */
export const HIGH = 100_000
export const LOW = 10_000

/**
 * port 에서 온 첫 text 메시지(attach 요청)에 `protocol` 을 `protocol_version` 으로 넣는다. renderer 는 pty 의 버전을
 * 모르고, pty 가 받는 버전은 레코드에 있기 때문이다.
 */
export function bridge(sock: Socket, port: MessagePortMain, protocol: number): void {
  const decoder = new FrameDecoder()
  let attached = false
  const text = new TextDecoder()
  let unacked = 0
  const post = (bytes: Uint8Array): void => {
    port.postMessage(bytes)
    unacked += bytes.length
    if (unacked > HIGH && !sock.isPaused()) sock.pause()
  }

  sock.on('data', (chunk) => {
    let frames
    try {
      frames = decoder.push(chunk)
    } catch {
      sock.destroy()
      return
    }
    // 소켓 버퍼의 view 를 그대로 넘기면 structured clone 이 뒤의 ArrayBuffer 전체를 복사하므로
    // 새 버퍼에 담아 넘긴다.
    let run: Buffer[] = []
    const flush = (): void => {
      if (run.length > 0) post(new Uint8Array(Buffer.concat(run)))
      run = []
    }
    for (const { tag, payload } of frames) {
      if (tag === TAG_BINARY) {
        run.push(payload)
      } else if (tag === TAG_TEXT) {
        flush()
        port.postMessage(text.decode(payload))
      }
    }
    flush()
  })
  sock.on('close', () => {
    port.postMessage(null)
    port.close()
  })
  sock.on('error', () => {})

  port.on('message', ({ data }) => {
    if (typeof data === 'number') {
      unacked -= data
      if (unacked < LOW && sock.isPaused()) sock.resume()
    } else if (typeof data === 'string') {
      const text = attached ? data : withProtocol(data, protocol)
      attached = true
      sock.write(encodeFrame(TAG_TEXT, Buffer.from(text)))
    } else if (data instanceof Uint8Array) sock.write(encodeFrame(TAG_BINARY, data))
  })
  port.on('close', () => sock.destroy())
  port.start()
}

function withProtocol(data: string, protocol: number): string {
  try {
    return JSON.stringify({ ...JSON.parse(data), protocol_version: protocol })
  } catch {
    return data
  }
}
