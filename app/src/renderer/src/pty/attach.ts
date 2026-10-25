import type { Terminal } from '@xterm/xterm'
import { parseProgramStatus, type ProgramStatusRecord } from '../../../shared/program-status'
import { PROTOCOL_VERSION } from '../../../shared/protocol'
import type { PtyConnection } from './connection'

export type AttachHandlers = {
  onExit(): void
  /** 되살린 pane 이 붙으면 `cwd` 가 없다. */
  onSpawned(id: string, cwd: string | undefined): void
  onOpenFailed(message: string): void
  /** pty 의 OSC 7501 레코드 전체. 붙을 때와 바뀔 때마다 온다. */
  onProgramStatus(records: ProgramStatusRecord[]): void
  /** 레코드가 있는 동안 foreground 의 cwd 가 바뀌었다. resync 뒤에도 온다 — 밀린 동안 버려진 알림이 있을 수 있기 때문이다. */
  onForeground(): void
}

export type Attachment = {
  readonly primary: boolean
  /** 터미널의 지금 크기로 pty 에 붙는다. 그 전의 입력은 모아 두었다가 붙은 뒤에 보낸다. */
  start(): void
  /** xterm 은 직접 지우지 않는다. maru-pty 가 지우는 바이트를 출력과 같은 순서로 보내 준다. */
  clearScrollback(): void
}

export function attach(term: Terminal, conn: PtyConnection, handlers: AttachHandlers): Attachment {
  const encoder = new TextEncoder()
  let primary = true
  // maru-pty 는 첫 프레임이 JSON 요청이 아니면 bad_request 로 연결을 끊는다.
  let queued: Uint8Array[] | undefined = []
  const input = (bytes: Uint8Array): void => {
    if (queued) queued.push(bytes)
    else if (primary) conn.send(bytes)
  }
  // 셸이 끝났거나 되살린 pty 가 없다 — 그 뒤 연결이 닫히는 것은 끊김이 아니다.
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
        if (!primary) term.resize(m.cols, m.rows)
        break
      case 'resync':
        if (!primary) term.resize(m.cols, m.rows)
        // 밀린 동안 버려진 `foreground` 는 다시 오지 않으므로 한 번 다시 읽게 한다.
        handlers.onForeground()
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
      case 'program_status': {
        const records = parseProgramStatus(m)
        if (records) handlers.onProgramStatus(records)
        break
      }
      case 'foreground':
        handlers.onForeground()
        break
      case 'exit':
        ended = true
        handlers.onExit()
        break
      // 되살린 pane 은 지우지 않고 이유를 보인다 — 말없이 사라지면 재시작 전 배치와 달라 헷갈린다.
      case 'gone':
        ended = true
        term.write('\r\n[the pty ended while the app was restarting]\r\n')
        break
      case 'error':
        term.write(`\r\n[maru-pty: ${m.code}] ${m.message ?? ''}\r\n`)
        if (m.code === 'open_failed') openFailed(m.message ?? '')
        break
    }
  })
  conn.onClose(() => {
    if (ended) return
    term.write('\r\n[disconnected from the pty]\r\n')
    // pty host 가 죽으면 open_failed 없이 닫힌다.
    if (!spawned) openFailed('disconnected before the pty started')
  })

  term.onData((data) => input(encoder.encode(data)))
  // 일부 마우스 보고는 UTF-8 이 아닌 바이트 문자열로 나온다.
  term.onBinary((data) => input(Uint8Array.from(data, (c) => c.charCodeAt(0))))
  term.onResize(({ cols, rows }) => {
    if (!queued && primary) conn.send(JSON.stringify({ type: 'resize', cols, rows }))
  })

  return {
    get primary() {
      return primary
    },
    start() {
      if (!queued) return
      conn.send(
        JSON.stringify({
          type: 'attach',
          protocol_version: PROTOCOL_VERSION,
          role: 'primary',
          cols: term.cols,
          rows: term.rows
        })
      )
      for (const bytes of queued) conn.send(bytes)
      queued = undefined
    },
    clearScrollback() {
      if (!queued && primary) conn.send(JSON.stringify({ type: 'clear_scrollback' }))
    }
  }
}
