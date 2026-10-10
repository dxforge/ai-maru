import { describe, expect, it } from 'vitest'
import {
  formatKeys,
  isAppKey,
  keyCode,
  matchesKeys,
  shortcuts,
  terminalInput,
  toAccelerator,
  type KeyEventLike
} from './shortcuts'

function press(code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }
}

describe('shortcuts', () => {
  it('한 키 조합은 한 곳에서만 받는다', () => {
    const combos = shortcuts.map((s) => toAccelerator(s))
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('표의 키는 모두 자판 위치로 맞출 수 있다', () => {
    for (const s of shortcuts) expect(keyCode(s.key), s.key).toBeDefined()
  })
})

describe('toAccelerator', () => {
  it('modifier 를 Control·Alt·Shift·Command 순서로 잇는다', () => {
    expect(toAccelerator({ key: 'N', meta: true })).toBe('Command+N')
    expect(toAccelerator({ key: 'D', shift: true, meta: true })).toBe('Shift+Command+D')
    expect(toAccelerator({ key: 'K', ctrl: true, alt: true, shift: true, meta: true })).toBe(
      'Control+Alt+Shift+Command+K'
    )
  })
})

describe('formatKeys', () => {
  it('modifier 를 ⌃⌥⇧⌘ 순서의 기호로 적는다', () => {
    expect(formatKeys({ key: 'P', shift: true, meta: true })).toBe('⇧⌘P')
    expect(formatKeys({ key: 'K', ctrl: true, alt: true, shift: true, meta: true })).toBe('⌃⌥⇧⌘K')
  })

  it('방향키·Enter·Plus 는 메뉴처럼 기호로 적는다', () => {
    expect(formatKeys({ key: 'Left', alt: true, meta: true })).toBe('⌥⌘←')
    expect(formatKeys({ key: 'Right', meta: true })).toBe('⌘→')
    expect(formatKeys({ key: 'Up', meta: true })).toBe('⌘↑')
    expect(formatKeys({ key: 'Down', meta: true })).toBe('⌘↓')
    expect(formatKeys({ key: 'Enter', ctrl: true, meta: true })).toBe('⌃⌘↩')
    expect(formatKeys({ key: 'Plus', meta: true })).toBe('⌘+')
  })
})

describe('matchesKeys', () => {
  it('글자·숫자·방향키·Enter 를 자판 위치로 맞춘다', () => {
    expect(matchesKeys(press('KeyB', { metaKey: true }), { key: 'B', meta: true })).toBe(true)
    expect(matchesKeys(press('Digit1', { metaKey: true }), { key: '1', meta: true })).toBe(true)
    expect(matchesKeys(press('ArrowLeft', { metaKey: true }), { key: 'Left', meta: true })).toBe(
      true
    )
    expect(matchesKeys(press('Enter', { metaKey: true }), { key: 'Enter', meta: true })).toBe(true)
  })

  it('modifier 가 하나라도 다르면 맞지 않는다', () => {
    const keys = { key: 'D', meta: true } as const
    expect(matchesKeys(press('KeyD', { metaKey: true, shiftKey: true }), keys)).toBe(false)
    expect(matchesKeys(press('KeyD'), keys)).toBe(false)
    expect(matchesKeys(press('KeyD', { metaKey: true, altKey: true }), keys)).toBe(false)
    expect(matchesKeys(press('KeyD', { metaKey: true, ctrlKey: true }), keys)).toBe(false)
  })
})

describe('isAppKey', () => {
  it('명령이나 메뉴에 걸린 키만 참이다', () => {
    expect(isAppKey(press('Enter', { ctrlKey: true, metaKey: true }))).toBe(true)
    expect(isAppKey(press('KeyD', { metaKey: true }))).toBe(true)
    expect(isAppKey(press('BracketRight', { shiftKey: true, metaKey: true }))).toBe(true)
    expect(isAppKey(press('KeyC', { metaKey: true }))).toBe(true)
    expect(isAppKey(press('KeyA', { metaKey: true }))).toBe(true)
    expect(isAppKey(press('Enter'))).toBe(false)
    expect(isAppKey(press('Enter', { metaKey: true }))).toBe(false)
  })

  it('⌘+ 는 ⇧ 를 누르든 안 누르든 앱의 키다', () => {
    expect(isAppKey(press('Equal', { metaKey: true }))).toBe(true)
    expect(isAppKey(press('Equal', { shiftKey: true, metaKey: true }))).toBe(true)
  })

  it('터미널이 바꿔 보내는 키는 앱의 키가 아니다', () => {
    expect(isAppKey(press('Backspace', { metaKey: true }))).toBe(false)
    expect(isAppKey(press('ArrowLeft', { metaKey: true }))).toBe(false)
  })
})

describe('terminalInput', () => {
  it('⌘← / ⌘→ 는 ⌃A / ⌃E 로 보낸다', () => {
    expect(terminalInput(press('ArrowLeft', { metaKey: true }))).toBe('\x01')
    expect(terminalInput(press('ArrowRight', { metaKey: true }))).toBe('\x05')
    expect(terminalInput(press('ArrowLeft', { metaKey: true, altKey: true }))).toBeUndefined()
  })

  it('⌘⌫ 은 ⌃U 로 보낸다', () => {
    expect(terminalInput(press('Backspace', { metaKey: true }))).toBe('\x15')
    expect(terminalInput(press('Backspace'))).toBeUndefined()
  })

  it('표에 없는 키는 xterm 에 맡긴다', () => {
    expect(terminalInput(press('Enter', { shiftKey: true }))).toBeUndefined()
    expect(terminalInput(press('Backspace'))).toBeUndefined()
  })
})
