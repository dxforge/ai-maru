import type { Terminal } from '@xterm/xterm'
import { PROTOCOL_VERSION } from '../../../shared/protocol'
import type { SessionConnection } from './connection'

export type AttachHandlers = {
  onExit(): void
  onSpawned(id: string, cwd: string): void
}

export type Attachment = {
  readonly primary: boolean
}

export function attach(
  term: Terminal,
  conn: SessionConnection,
  handlers: AttachHandlers
): Attachment {
  const encoder = new TextEncoder()
  let primary = true
  let exited = false

  conn.onMessage((msg) => {
    if (typeof msg !== 'string') {
      term.write(msg)
      return
    }
    const m = JSON.parse(msg)
    switch (m.type) {
      case 'attached':
      case 'resync':
        if (!primary) term.resize(m.cols, m.rows)
        break
      case 'size':
        term.resize(m.cols, m.rows)
        break
      case 'role':
        if (m.role === 'observer') {
          primary = false
          term.write('\r\n[another client took over input and size]\r\n')
        }
        break
      case 'spawned':
        handlers.onSpawned(m.id, m.cwd)
        break
      case 'exit':
        exited = true
        handlers.onExit()
        break
      case 'error':
        term.write(`\r\n[maru-session: ${m.code}] ${m.message ?? ''}\r\n`)
        break
    }
  })
  // 셸이 끝나면 세션이 연결을 닫는다 — 그건 끊김이 아니다.
  conn.onClose(() => {
    if (!exited) term.write('\r\n[disconnected from the session]\r\n')
  })

  term.onData((data) => {
    if (primary) conn.send(encoder.encode(data))
  })
  // 일부 마우스 보고는 UTF-8 이 아닌 바이트 문자열로 나온다.
  term.onBinary((data) => {
    if (primary) conn.send(Uint8Array.from(data, (c) => c.charCodeAt(0)))
  })
  term.onResize(({ cols, rows }) => {
    if (primary) conn.send(JSON.stringify({ type: 'resize', cols, rows }))
  })

  conn.send(
    JSON.stringify({
      type: 'attach',
      protocol_version: PROTOCOL_VERSION,
      role: 'primary',
      cols: term.cols,
      rows: term.rows
    })
  )
  return {
    get primary() {
      return primary
    }
  }
}
