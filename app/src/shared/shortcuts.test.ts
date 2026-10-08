import { describe, expect, it } from 'vitest'
import {
  formatKeys,
  isCommandKey,
  keyCode,
  matchesKeys,
  shortcuts,
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

  it('명령의 키는 모두 자판 위치로 맞출 수 있다', () => {
    for (const s of shortcuts.filter((s) => s.target === 'command'))
      expect(keyCode(s.key), s.action).toBeDefined()
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

describe('isCommandKey', () => {
  it('명령에 걸린 키만 참이다', () => {
    expect(isCommandKey(press('Enter', { ctrlKey: true, metaKey: true }))).toBe(true)
    expect(isCommandKey(press('KeyD', { metaKey: true }))).toBe(true)
    expect(isCommandKey(press('Enter'))).toBe(false)
    expect(isCommandKey(press('Enter', { metaKey: true }))).toBe(false)
  })

  it('메뉴 role 의 키는 터미널이 받는다', () => {
    expect(isCommandKey(press('KeyA', { metaKey: true }))).toBe(false)
    expect(isCommandKey(press('KeyC', { metaKey: true }))).toBe(false)
  })
})
