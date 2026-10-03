import type { Terminal } from '@xterm/xterm'
import { PROTOCOL_VERSION } from '../../../shared/protocol'
import type { SessionConnection } from './connection'

export type ReplayState = {
  rows: number
  cursorX: number
  cursorY: number
  trailingBlankRows: number
}

/**
 * 재생을 쓴 뒤 그리드를 세션과 같게 맞추는 시퀀스. 재생은 꼬리의 빈 행을 잘라 보내므로,
 * 그만큼 개행으로 되살려야 뷰포트 원점이 세션과 같아진다. 커서 한 점만 맞추면 그 뒤 프로그램이
 * 자기 좌표로 그리는 것이 모두 어긋난다. 그리드 높이가 다르면 세 값이 다른 것을 가리키므로
 * 손대지 않는다.
 */
export function replayAlignment(state: ReplayState, rows: number): string {
  if (state.rows !== rows || state.cursorY >= rows) return ''
  const pad = Math.min(state.trailingBlankRows, rows)
  // 개행은 뷰포트 맨 아래에서 해야 스크롤되어 행이 는다.
  const grid = pad > 0 ? `\x1b[${rows};1H${'\n'.repeat(pad)}` : ''
  return `${grid}\x1b[${state.cursorY + 1};${state.cursorX + 1}H`
}

export type AttachHandlers = {
  onExit(): void
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
  let replay: ReplayState | null = null
  let primary = true

  conn.onMessage((msg) => {
    if (typeof msg !== 'string') {
      term.write(msg)
      if (replay) {
        // 콜백 안에서 쓰면 그 사이 큐에 들어온 출력 뒤로 밀려 정렬 전 그리드에 그려진다.
        term.write(replayAlignment(replay, term.rows))
        replay = null
      }
      return
    }
    const m = JSON.parse(msg)
    switch (m.type) {
      case 'attached':
      case 'resync':
        // 밀린 연결은 그 사이의 크기 변경을 이 헤더로만 받는다.
        if (!primary) term.resize(m.cols, m.rows)
        replay = {
          rows: m.rows,
          cursorX: m.cursor_x,
          cursorY: m.cursor_y,
          trailingBlankRows: m.trailing_blank_rows
        }
        break
      case 'size':
        term.resize(m.cols, m.rows)
        break
      case 'role':
        if (m.role === 'observer') {
          primary = false
          term.write('\r\n[다른 클라이언트가 이 세션의 입력과 크기를 가져갔다]\r\n')
        }
        break
      case 'exit':
        handlers.onExit()
        break
      case 'error':
        term.write(`\r\n[maru-session: ${m.code}] ${m.message ?? ''}\r\n`)
        break
    }
  })
  conn.onClose(() => term.write('\r\n[세션 연결이 끊겼다]\r\n'))

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
