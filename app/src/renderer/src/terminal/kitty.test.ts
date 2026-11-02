// @vitest-environment jsdom
import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { baseLayoutKeySequence, kittyFlags, type KittyKeyEvent } from './kitty'

const ctrlR: KittyKeyEvent = {
  type: 'keydown',
  key: 'ㄱ',
  code: 'KeyR',
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  repeat: false
}
const press = (over: Partial<KittyKeyEvent>, flags = 5): string | undefined =>
  baseLayoutKeySequence({ ...ctrlR, ...over }, flags)

describe('baseLayoutKeySequence', () => {
  it('플래그 4 에서 한글 배열의 ⌃R 은 자모 뒤에 물리 키의 글자를 base layout key 로 붙인다', () => {
    expect(press({})).toBe('\x1b[12593::114;5u')
  })

  it('숫자 키도 물리 키의 숫자를 붙인다', () => {
    expect(press({ key: 'й', code: 'Digit1' })).toBe('\x1b[1081::49;5u')
  })

  it('플래그 4 가 없으면 xterm 에 맡긴다', () => {
    expect(press({}, 1)).toBeUndefined()
    expect(press({}, 3)).toBeUndefined()
    expect(press({}, 0)).toBeUndefined()
  })

  it('⌃ 를 쥐지 않았거나 ⇧·⌥·⌘ 를 함께 쥐면 xterm 에 맡긴다', () => {
    expect(press({ ctrlKey: false })).toBeUndefined()
    expect(press({ shiftKey: true })).toBeUndefined()
    expect(press({ altKey: true })).toBeUndefined()
    expect(press({ metaKey: true })).toBeUndefined()
  })

  it('ASCII 글자를 내는 키, 한 글자가 아닌 key, 글자·숫자 키가 아닌 키는 xterm 에 맡긴다', () => {
    expect(press({ key: 'r' })).toBeUndefined()
    expect(press({ key: 'Process' })).toBeUndefined()
    expect(press({ code: 'BracketLeft' })).toBeUndefined()
    expect(press({ code: 'Numpad1' })).toBeUndefined()
  })

  it('플래그 2 가 켜졌으면 반복에 :2, 뗌에 :3 을 붙이고 뗌에도 base layout key 를 붙인다', () => {
    expect(press({ repeat: true }, 7)).toBe('\x1b[12593::114;5:2u')
    expect(press({ type: 'keyup' }, 7)).toBe('\x1b[12593::114;5:3u')
    expect(press({}, 7)).toBe('\x1b[12593::114;5u')
  })

  it('플래그 2 가 없으면 반복은 누름과 같고, 뗌은 보내지 않는다', () => {
    expect(press({ repeat: true })).toBe('\x1b[12593::114;5u')
    expect(press({ type: 'keyup' })).toBeUndefined()
  })

  it('keypress 는 보내지 않는다', () => {
    expect(press({ type: 'keypress' })).toBeUndefined()
  })
})

describe('kittyFlags', () => {
  it('프로그램이 push 한 kitty 플래그를 xterm 의 내부 상태에서 읽는다', async () => {
    const term = new Terminal({ vtExtensions: { kittyKeyboard: true }, allowProposedApi: true })
    expect(kittyFlags(term)).toBe(0)
    await new Promise<void>((done) => term.write('\x1b[>5u', done))
    expect(kittyFlags(term)).toBe(5)
    term.dispose()
  })
})
