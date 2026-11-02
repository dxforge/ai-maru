import type { Terminal } from '@xterm/xterm'

const REPORT_EVENT_TYPES = 0b10
const REPORT_ALTERNATE_KEYS = 0b100

/**
 * 프로그램이 push 한 kitty 키보드 플래그. xterm 에 이를 읽는 공개 API 가 없어 `_core.coreService.kittyKeyboard` 를 읽는다.
 * xterm 을 올리면서 이 필드 이름이 바뀌면 0 을 돌려줘 `baseLayoutKeySequence` 가 조용히 꺼지므로, `kitty.test.ts` 가 필드가
 * 있는지 확인한다.
 */
export function kittyFlags(term: Terminal): number {
  const core = (
    term as unknown as { _core?: { coreService?: { kittyKeyboard?: { flags?: number } } } }
  )._core
  return core?.coreService?.kittyKeyboard?.flags ?? 0
}

export type KittyKeyEvent = Pick<
  KeyboardEvent,
  'type' | 'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'repeat'
>

function physicalKey(code: string): number | undefined {
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code)
  return m ? (m[1] ?? m[2]).toLowerCase().codePointAt(0) : undefined
}

/**
 * 한글처럼 글자·숫자 키가 ASCII 밖의 글자를 내는 배열에서 ⌃ 만 쥐고 누른 그 키를, 플래그 4(report alternate keys)를 켠
 * 프로그램에 kitty 스펙대로 `CSI <글자>::<물리 키의 글자>;<modifier>u` 로 보낼 시퀀스. 개입하지 않을 키면 `undefined` 다.
 *
 * xterm 은 ⇧·⌥ 를 쥐지 않으면 `event.key` 로 key code 를 정한다. base layout key 는 어느 경우에도 붙이지 않는다. 그래서 한글
 * 배열의 ⌃R 은 `CSI 12593;5u`(ㄱ)로 가고, Claude Code 는 이를 ⌃R 로 읽지 못한다. xterm 이 base layout key 를 붙이게 되면 이
 * 함수를 지운다.
 */
export function baseLayoutKeySequence(e: KittyKeyEvent, flags: number): string | undefined {
  if (!(flags & REPORT_ALTERNATE_KEYS)) return undefined
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return undefined
  if (e.key.length !== 1) return undefined
  const key = e.key.codePointAt(0)!
  if (key < 0x80) return undefined
  const base = physicalKey(e.code)
  if (base === undefined) return undefined
  if (e.type !== 'keydown' && e.type !== 'keyup') return undefined
  const up = e.type === 'keyup'
  const reportEvents = !!(flags & REPORT_EVENT_TYPES)
  // 플래그 2 가 없으면 xterm 도 뗌을 보내지 않는다.
  if (up && !reportEvents) return undefined
  const event = !reportEvents ? '' : up ? ':3' : e.repeat ? ':2' : ''
  // ⌃ 만 쥐었으므로 modifier 는 1 + ctrl(4) 이다.
  return `\x1b[${key}::${base};5${event}u`
}
