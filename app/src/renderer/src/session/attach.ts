import type { Terminal } from '@xterm/xterm'
import type { SessionConnection } from './connection'

export const PROTOCOL_VERSION = 1

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

/** `pendingInput` 은 연결이 열리기 전에 들어온 입력이다. attach 요청 뒤에 보낸다. */
export function attach(
  term: Terminal,
  conn: SessionConnection,
  handlers: AttachHandlers,
  pendingInput: string[] = []
): void {
  const encoder = new TextEncoder()
  let replay: ReplayState | null = null

  conn.onMessage((msg) => {
    if (typeof msg !== 'string') {
      if (replay) {
        const state = replay
        replay = null
        term.write(msg, () => term.write(replayAlignment(state, term.rows)))
      } else {
        term.write(msg)
      }
      return
    }
    const m = JSON.parse(msg)
    switch (m.type) {
      case 'attached':
      case 'resync':
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
      case 'exit':
        handlers.onExit()
        break
      case 'error':
        term.write(`\r\n[maru-session: ${m.code}] ${m.message ?? ''}\r\n`)
        break
    }
  })
  conn.onClose(() => term.write('\r\n[세션 연결이 끊겼다]\r\n'))

  term.onData((data) => conn.send(encoder.encode(data)))
  // 일부 마우스 보고는 UTF-8 이 아닌 바이트 문자열로 나온다.
  term.onBinary((data) => conn.send(Uint8Array.from(data, (c) => c.charCodeAt(0))))
  term.onResize(({ cols, rows }) => conn.send(JSON.stringify({ type: 'resize', cols, rows })))

  conn.send(
    JSON.stringify({
      type: 'attach',
      protocol_version: PROTOCOL_VERSION,
      role: 'primary',
      cols: term.cols,
      rows: term.rows
    })
  )
  for (const data of pendingInput) conn.send(encoder.encode(data))
}
