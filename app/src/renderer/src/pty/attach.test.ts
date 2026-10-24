import type { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { attach } from './attach'
import type { PtyConnection, PtyMessage } from './connection'

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
    type: (() => {}) as (data: string) => void,
    onData(cb: (data: string) => void) {
      term.type = cb
    },
    binary: (() => {}) as (data: string) => void,
    onBinary(cb: (data: string) => void) {
      term.binary = cb
    },
    resized: (() => {}) as (size: { cols: number; rows: number }) => void,
    onResize(cb: (size: { cols: number; rows: number }) => void) {
      term.resized = cb
    }
  }
  return term
}

function fakeConnection() {
  let deliver: (msg: PtyMessage) => void = () => {}
  let close: () => void = () => {}
  const conn: PtyConnection = {
    send: () => {},
    onMessage: (cb) => (deliver = cb),
    onClose: (cb) => (close = cb),
    kill: () => {}
  }
  return { conn, deliver: (msg: PtyMessage) => deliver(msg), close: () => close() }
}

const handlers = {
  onExit: () => {},
  onSpawned: () => {},
  onOpenFailed: () => {},
  onProgramStatus: () => {},
  onForeground: () => {}
}

describe('attach', () => {
  it('붙기 전의 입력은 attach 요청 뒤에 보내고, 붙기 전의 resize 는 보내지 않는다', () => {
    const term = fakeTerminal(80, 24)
    const sent: PtyMessage[] = []
    const conn: PtyConnection = { ...fakeConnection().conn, send: (msg) => sent.push(msg) }
    const pty = attach(term as unknown as Terminal, conn, handlers)
    term.type('a')
    term.binary('m')
    term.resize(100, 24)
    term.resized({ cols: 100, rows: 24 })
    expect(sent).toEqual([])
    pty.start()
    pty.start()
    term.type('b')
    expect(
      sent.map((m) => (typeof m === 'string' ? JSON.parse(m) : new TextDecoder().decode(m)))
    ).toEqual([expect.objectContaining({ type: 'attach', cols: 100, rows: 24 }), 'a', 'm', 'b'])
  })

  it('자리를 내준 뒤 밀려 resync 를 받으면 그 크기를 따른다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver } = fakeConnection()
    attach(term as unknown as Terminal, conn, handlers)
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

  // 출력이 이어지는 pty 에서는 재생과 그 뒤 출력이 한 메시지로 올 수 있다.
  it('재생이 든 메시지 뒤에 자기 시퀀스를 덧쓰지 않는다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver } = fakeConnection()
    attach(term as unknown as Terminal, conn, handlers)
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

  it('되살린 pty 가 없으면 이유만 보이고 pane 을 닫거나 실패로 알리지 않는다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver, close } = fakeConnection()
    const calls: string[] = []
    attach(term as unknown as Terminal, conn, {
      ...handlers,
      onExit: () => calls.push('exit'),
      onSpawned: () => calls.push('spawned'),
      onOpenFailed: () => calls.push('failed')
    })
    deliver(JSON.stringify({ type: 'gone' }))
    close()
    expect(calls).toEqual([])
    expect(term.written).toEqual(['\r\n[the pty ended while the app was restarting]\r\n'])
  })

  it('셸이 끝난 뒤 연결이 닫히면 끊김을 보이지 않는다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver, close } = fakeConnection()
    let exits = 0
    attach(term as unknown as Terminal, conn, { ...handlers, onExit: () => exits++ })
    deliver(JSON.stringify({ type: 'exit' }))
    close()
    expect(exits).toBe(1)
    expect(term.written).toEqual([])
  })

  it('셸이 끝나지 않았는데 연결이 닫히면 끊김을 보인다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, close } = fakeConnection()
    attach(term as unknown as Terminal, conn, handlers)
    close()
    expect(String(term.written)).toContain('disconnected from the pty')
  })

  it('새로 띄운 pty 의 디렉토리를 알리고 터미널에는 쓰지 않는다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver } = fakeConnection()
    const spawned: string[] = []
    attach(term as unknown as Terminal, conn, {
      ...handlers,
      onSpawned: (id, cwd) => spawned.push(`${id} ${cwd}`)
    })
    deliver(JSON.stringify({ type: 'spawned', id: 'p-1', cwd: '/a b' }))
    expect(spawned).toEqual(['p-1 /a b'])
    expect(term.written).toEqual([])
  })

  it('pty 를 띄우지 못했다는 오류만 알리고, 오류는 어느 것이든 터미널에 쓴다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver } = fakeConnection()
    const failed: string[] = []
    attach(term as unknown as Terminal, conn, {
      ...handlers,
      onOpenFailed: (message) => failed.push(message)
    })
    deliver(JSON.stringify({ type: 'error', code: 'bad_request', message: 'x' }))
    deliver(JSON.stringify({ type: 'error', code: 'open_failed', message: 'no shell' }))
    expect(failed).toEqual(['no shell'])
    expect(term.written).toHaveLength(2)
  })

  it('pty 가 뜨기 전에 exit 없이 닫히면 띄우지 못한 것으로 알리고, 뜬 뒤에 닫히면 알리지 않는다', () => {
    for (const [spawnFirst, expected] of [
      [false, ['disconnected before the pty started']],
      [true, []]
    ] as const) {
      const term = fakeTerminal(80, 24)
      const { conn, deliver, close } = fakeConnection()
      const failed: string[] = []
      attach(term as unknown as Terminal, conn, {
        ...handlers,
        onOpenFailed: (message) => failed.push(message)
      })
      if (spawnFirst) deliver(JSON.stringify({ type: 'spawned', id: 'p-1', cwd: '/' }))
      close()
      expect(failed).toEqual(expected)
    }
  })

  it('open_failed 뒤에 연결이 닫혀도 한 번만 알린다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver, close } = fakeConnection()
    const failed: string[] = []
    attach(term as unknown as Terminal, conn, {
      ...handlers,
      onOpenFailed: (message) => failed.push(message)
    })
    deliver(JSON.stringify({ type: 'error', code: 'open_failed', message: 'no shell' }))
    close()
    expect(failed).toEqual(['no shell'])
  })

  it('program_status 는 레코드를 넘기고, 모양이 틀리면 무시한다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver } = fakeConnection()
    const got: unknown[] = []
    attach(term as unknown as Terminal, conn, {
      ...handlers,
      onProgramStatus: (records) => got.push(records)
    })
    const record = {
      id: '',
      state: 'working',
      kind: null,
      progress: null,
      app: 'claude-code',
      title: '',
      message: 'hi'
    }
    deliver(JSON.stringify({ type: 'program_status', records: [record] }))
    deliver(JSON.stringify({ type: 'program_status', records: [] }))
    deliver(JSON.stringify({ type: 'program_status' }))
    expect(got).toEqual([[record], []])
    expect(term.written).toEqual([])
  })

  it('foreground 와 resync 는 디렉토리를 다시 읽게만 한다', () => {
    const term = fakeTerminal(80, 24)
    const { conn, deliver } = fakeConnection()
    let moved = 0
    attach(term as unknown as Terminal, conn, { ...handlers, onForeground: () => moved++ })
    deliver(JSON.stringify({ type: 'foreground', pid: 7, cwd: '/x' }))
    expect(moved).toBe(1)
    deliver(JSON.stringify({ type: 'resync', cols: 80, rows: 24, cursor_x: 0, cursor_y: 0 }))
    expect(moved).toBe(2)
    deliver(JSON.stringify({ type: 'attached', cols: 80, rows: 24, cursor_x: 0, cursor_y: 0 }))
    expect(moved).toBe(2)
    expect(term.written).toEqual([])
  })
})
