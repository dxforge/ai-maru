import type { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { attach } from './attach'
import type { SessionConnection, SessionMessage } from './connection'

function fakeTerminal(cols: number, rows: number) {
  const term = {
    cols,
    rows,
    written: [] as unknown[],
    write(data: unknown) {
      term.written.push(data)
    },
    resize(c: number, r: number) {
      term.cols = c
      term.rows = r
    },
    onData: () => {},
    onBinary: () => {},
    onResize: () => {}
  }
  return term
}

function fakeConnection() {
  let deliver: (msg: SessionMessage) => void = () => {}
  const conn: SessionConnection = {
    send: () => {},
    onMessage: (cb) => (deliver = cb),
    onClose: () => {}
  }
  return { conn, deliver: (msg: SessionMessage) => deliver(msg) }
}

describe('attach', () => {
  it('자리를 내준 뒤 밀려 resync 를 받으면 그 크기를 따른다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver } = fakeConnection()
    attach(term as unknown as Terminal, conn, { onExit: () => {} })
    deliver(JSON.stringify({ type: 'role', role: 'observer' }))
    deliver(
      JSON.stringify({
        type: 'resync',
        cols: 100,
        rows: 30,
        cursor_x: 0,
        cursor_y: 0
      })
    )
    expect([term.cols, term.rows]).toEqual([100, 30])
  })

  // 출력이 이어지는 세션에서는 재생과 그 뒤 출력이 한 메시지로 올 수 있다.
  it('재생이 든 메시지 뒤에 자기 시퀀스를 덧쓰지 않는다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver } = fakeConnection()
    attach(term as unknown as Terminal, conn, { onExit: () => {} })
    deliver(
      JSON.stringify({
        type: 'attached',
        cols: 80,
        rows: 24,
        cursor_x: 0,
        cursor_y: 0
      })
    )
    const replayAndOutput = new TextEncoder().encode('replay\r\nmore output')
    deliver(replayAndOutput)
    expect(term.written).toEqual([replayAndOutput])
  })
})
