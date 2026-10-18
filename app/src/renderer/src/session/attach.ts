import type { Terminal } from '@xterm/xterm'
import { PROTOCOL_VERSION } from '../../../shared/protocol'
import type { SessionConnection } from './connection'

export type AttachHandlers = {
  onExit(): void
  /** 되살린 pane 이 붙으면 `cwd` 가 없다. */
  onSpawned(id: string, cwd: string | undefined): void
  onOpenFailed(message: string): void
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
  // 셸이 끝났거나 되살린 세션이 없다 — 그 뒤 연결이 닫히는 것은 끊김이 아니다.
  let ended = false
  let spawned = false
  let failed = false
  const openFailed = (message: string): void => {
    if (failed) return
    failed = true
    handlers.onOpenFailed(message)
  }

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
        spawned = true
        handlers.onSpawned(m.id, m.cwd)
        break
      case 'exit':
        ended = true
        handlers.onExit()
        break
      // 되살린 pane 은 지우지 않고 이유를 보인다 — 말없이 사라지면 재시작 전 배치와 달라 헷갈린다.
      case 'gone':
        ended = true
        term.write('\r\n[the session ended while the app was restarting]\r\n')
        break
      case 'error':
        term.write(`\r\n[maru-session: ${m.code}] ${m.message ?? ''}\r\n`)
        if (m.code === 'open_failed') openFailed(m.message ?? '')
        break
    }
  })
  conn.onClose(() => {
    if (ended) return
    term.write('\r\n[disconnected from the session]\r\n')
    // session host 가 죽으면 open_failed 없이 닫힌다.
    if (!spawned) openFailed('disconnected before the session started')
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
