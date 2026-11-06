import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import type { MessagePortMain } from 'electron'
import { describe, expect, it } from 'vitest'
import { bridge, HIGH, LOW } from './bridge'
import { encodeFrame, TAG_BINARY, TAG_TEXT } from './frame'

function fakeSocket() {
  const sock = Object.assign(new EventEmitter(), {
    paused: false,
    written: [] as Buffer[],
    pause() {
      sock.paused = true
    },
    resume() {
      sock.paused = false
    },
    isPaused() {
      return sock.paused
    },
    write(b: Buffer) {
      sock.written.push(b)
    },
    destroy() {}
  })
  return sock
}

function fakePort() {
  const port = Object.assign(new EventEmitter(), {
    posted: [] as unknown[],
    postMessage(m: unknown) {
      port.posted.push(m)
    },
    start() {},
    close() {}
  })
  return port
}

function connect() {
  const sock = fakeSocket()
  const port = fakePort()
  bridge(sock as unknown as Socket, port as unknown as MessagePortMain)
  const output = (bytes: number): boolean =>
    sock.emit('data', encodeFrame(TAG_BINARY, Buffer.alloc(bytes)))
  const ack = (bytes: number): boolean => port.emit('message', { data: bytes })
  return { sock, port, output, ack }
}

describe('bridge', () => {
  it('처리했다고 알리지 않은 출력이 HIGH 를 넘으면 소켓을 읽지 않고, LOW 아래로 내려가면 다시 읽는다', () => {
    const { sock, output, ack } = connect()
    output(HIGH)
    expect(sock.paused).toBe(false)
    output(1)
    expect(sock.paused).toBe(true)
    ack(HIGH + 1 - LOW)
    expect(sock.paused).toBe(true)
    ack(1)
    expect(sock.paused).toBe(false)
  })

  it('JSON 메시지는 알리지 않을 양에 세지 않는다', () => {
    const { sock } = connect()
    sock.emit('data', encodeFrame(TAG_TEXT, Buffer.from(JSON.stringify({ x: 'y'.repeat(HIGH) }))))
    expect(sock.paused).toBe(false)
  })

  it('알림은 소켓에 보내지 않고, 문자열과 바이트는 프레임으로 보낸다', () => {
    const { sock, port, ack } = connect()
    ack(10)
    port.emit('message', { data: '{"type":"resize"}' })
    port.emit('message', { data: new Uint8Array([3]) })
    expect(sock.written).toEqual([
      encodeFrame(TAG_TEXT, Buffer.from('{"type":"resize"}')),
      encodeFrame(TAG_BINARY, new Uint8Array([3]))
    ])
  })
})
