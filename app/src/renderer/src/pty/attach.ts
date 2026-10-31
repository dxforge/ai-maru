import type { Terminal } from '@xterm/xterm'
import { parseProgramStatus, type ProgramStatusRecord } from '../../../shared/program-status'
import { PROTOCOL_VERSION } from '../../../shared/protocol'
import type { PtyExit } from '../../../shared/pty'
import type { PtyConnection } from './connection'

export type AttachHandlers = {
  onExit(exit: PtyExit): void
  /** 되살린 pane 의 pty 가 없었다. host 가 이어서 같은 연결로 새 셸을 띄운다(`onSpawned`). */
  onGone(): void
  /** 되살린 pane 이 붙으면 `cwd` 가 없다. */
  onSpawned(id: string, cwd: string | undefined): void
  onOpenFailed(message: string): void
  /**
   * pty 의 OSC 7501 레코드 전체. 상태 구독을 모르는 이전 maru-pty 만 attach 스트림으로 보낸다 — 붙을 때와 바뀔 때마다
   * 온다. 지금의 maru-pty 는 상태를 main 의 구독으로만 보낸다.
   */
  onProgramStatus(records: ProgramStatusRecord[]): void
}

export type Attachment = {
  readonly primary: boolean
  /** 터미널의 지금 크기로 pty 에 붙는다. 그 전의 입력은 모아 두었다가 붙은 뒤에 보낸다. */
  start(): void
  /** xterm 은 직접 지우지 않는다. maru-pty 가 지우는 바이트를 출력과 같은 순서로 보내 준다. */
  clearScrollback(): void
}

// 새 셸이 그 자리에 뜨므로, 앞의 프로그램이 이어지지 않는다는 것을 보인다.
export const GONE_MESSAGE = '\r\n[the pty had ended; trying to start a new shell]\r\n'

/**
 * 새 셸의 첫 재생 뒤에 써서 `GONE_MESSAGE` 를 화면 맨 위에 끼우는 바이트. 첫 재생은 maru-pty 가 빈 화면에 그린다고 보고
 * 화면을 처음부터 그리므로, 그 전에 쓴 문구는 덮인다. 끼운 만큼 커서를 내려 셸이 아는 커서 자리와 화면을 맞춘다.
 * 커서 아래 빈 줄이 모자라면 먼저 그만큼 위 줄을 스크롤백으로 올린다 — 끼우기(IL)는 맨 아래 줄을 버리기 때문이다.
 * `cursorY` 는 재생이 끝난 뒤의 커서 행(0부터)이다.
 */
export function goneAbove(cols: number, rows: number, cursorY: number): string {
  const text = GONE_MESSAGE.trim().length
  const lines = Math.min(1 + Math.ceil(text / cols), rows - 1)
  const scroll = Math.max(0, lines - (rows - 1 - cursorY))
  const up = scroll > 0 ? `\x1b[${rows};1H${'\n'.repeat(scroll)}` : ''
  // xterm 은 저장한 커서를 버퍼의 줄로 기억해, 스크롤로 올린 만큼 같이 올라간 자리로 되돌린다.
  return `\x1b7${up}\x1b[H\x1b[${lines}L${GONE_MESSAGE}\x1b8\x1b[${lines}B`
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
  let gone: 'no' | 'awaiting attach' | { cols: number; rows: number; cursorY: number } = 'no'
  // 새 셸에 붙지 못하고 끝나면 재생이 오지 않는다 — 그때는 끝났다는 알림 앞에 그대로 쓴다.
  const showGone = (): void => {
    if (gone === 'no') return
    gone = 'no'
    term.write(GONE_MESSAGE)
  }
  const openFailed = (message: string): void => {
    if (failed) return
    failed = true
    handlers.onOpenFailed(message)
  }

  conn.onMessage((msg) => {
    if (typeof msg !== 'string') {
      term.write(msg)
      if (typeof gone === 'object') {
        const { cols, rows, cursorY } = gone
        gone = 'no'
        term.write(goneAbove(cols, rows, cursorY))
      }
      return
    }
    const m = JSON.parse(msg)
    switch (m.type) {
      case 'attached':
        if (gone === 'awaiting attach') gone = { cols: m.cols, rows: m.rows, cursorY: m.cursor_y }
        if (!primary) term.resize(m.cols, m.rows)
        break
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
      case 'program_status': {
        const records = parseProgramStatus(m)
        if (records) handlers.onProgramStatus(records)
        break
      }
      case 'exit':
        showGone()
        ended = true
        handlers.onExit({ code: m.code ?? null, signal: m.signal ?? null })
        break
      case 'gone':
        gone = 'awaiting attach'
        handlers.onGone()
        break
      case 'error':
        showGone()
        term.write(`\r\n[maru-pty: ${m.code}] ${m.message ?? ''}\r\n`)
        if (m.code === 'open_failed') openFailed(m.message ?? '')
        break
    }
  })
  conn.onClose(() => {
    showGone()
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
