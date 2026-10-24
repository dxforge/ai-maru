import { describe, expect, it } from 'vitest'
import {
  commandKeys,
  formatKeys,
  keyCode,
  matchesKeys,
  shortcuts,
  secondaryCommand,
  terminalInput,
  toAccelerator,
  type KeyEventLike
} from './shortcuts'

function press(code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }
}

describe('shortcuts', () => {
  it('한 키 조합은 한 곳에서만 받는다', () => {
    // accelerator 문자열이 달라도(Plus 와 Shift+=) 같은 키 조합일 수 있으므로 자판 위치와 modifier 로 견준다.
    const combos = shortcuts.map((s) =>
      [keyCode(s.key), !!s.ctrl, !!s.alt, !!s.shift || s.key === 'Plus', !!s.meta].join()
    )
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('표의 키는 모두 자판 위치로 맞출 수 있다', () => {
    for (const s of shortcuts) expect(keyCode(s.key), s.key).toBeDefined()
  })
})

describe('commandKeys', () => {
  it('pane 이동은 메뉴·팔레트에 ⌥⌘방향키를 보인다', () => {
    expect(formatKeys(commandKeys('focus-pane-left')!)).toBe('⌥⌘←')
    expect(formatKeys(commandKeys('focus-pane-right')!)).toBe('⌥⌘→')
    expect(formatKeys(commandKeys('focus-pane-up')!)).toBe('⌥⌘↑')
    expect(formatKeys(commandKeys('focus-pane-down')!)).toBe('⌥⌘↓')
  })

  it('보기 모드 전환은 ⌘\\ 다', () => {
    expect(formatKeys(commandKeys('toggle-view-mode')!)).toBe('⌘\\')
    expect(toAccelerator(commandKeys('toggle-view-mode')!)).toBe('Command+\\')
  })

  it('새 cell 은 ⌘T 다', () => {
    expect(formatKeys(commandKeys('new-cell')!)).toBe('⌘T')
    expect(toAccelerator(commandKeys('new-cell')!)).toBe('Command+T')
  })

  it('cell 폭은 ⇧⌘. 와 ⇧⌘, 다', () => {
    expect(toAccelerator(commandKeys('widen-cell')!)).toBe('Shift+Command+.')
    expect(toAccelerator(commandKeys('narrow-cell')!)).toBe('Shift+Command+,')
    expect(formatKeys(commandKeys('widen-cell')!)).toBe('⇧⌘.')
    expect(formatKeys(commandKeys('narrow-cell')!)).toBe('⇧⌘,')
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

  it('Plus 는 ⇧ 를 누른 = 이고, = 은 ⇧ 를 누르지 않은 = 이다', () => {
    const plus = { key: 'Plus', meta: true } as const
    const equal = { key: '=', meta: true } as const
    expect(matchesKeys(press('Equal', { metaKey: true, shiftKey: true }), plus)).toBe(true)
    expect(matchesKeys(press('Equal', { metaKey: true }), plus)).toBe(false)
    expect(matchesKeys(press('Equal', { metaKey: true }), equal)).toBe(true)
    expect(matchesKeys(press('Equal', { metaKey: true, shiftKey: true }), equal)).toBe(false)
  })
})

describe('secondaryCommand', () => {
  it('⇧⌘방향키는 pane 이동이다', () => {
    expect(secondaryCommand(press('ArrowLeft', { shiftKey: true, metaKey: true }))).toBe(
      'focus-pane-left'
    )
    expect(secondaryCommand(press('ArrowRight', { shiftKey: true, metaKey: true }))).toBe(
      'focus-pane-right'
    )
    expect(secondaryCommand(press('ArrowUp', { shiftKey: true, metaKey: true }))).toBe(
      'focus-pane-up'
    )
    expect(secondaryCommand(press('ArrowDown', { shiftKey: true, metaKey: true }))).toBe(
      'focus-pane-down'
    )
  })

  it('⌘= 과 ⇧ 를 쥔 채 누른 ⇧⌘- / ⇧⌘0 은 글꼴 크기 명령이다', () => {
    expect(secondaryCommand(press('Equal', { metaKey: true }))).toBe('increase-font-size')
    expect(secondaryCommand(press('Minus', { shiftKey: true, metaKey: true }))).toBe(
      'decrease-font-size'
    )
    expect(secondaryCommand(press('Digit0', { shiftKey: true, metaKey: true }))).toBe(
      'reset-font-size'
    )
  })

  it('메뉴에 건 키는 돌려주지 않는다', () => {
    expect(secondaryCommand(press('ArrowLeft', { altKey: true, metaKey: true }))).toBeUndefined()
    expect(
      secondaryCommand(press('BracketRight', { shiftKey: true, metaKey: true }))
    ).toBeUndefined()
    expect(secondaryCommand(press('ArrowLeft', { metaKey: true }))).toBeUndefined()
    expect(secondaryCommand(press('Equal', { shiftKey: true, metaKey: true }))).toBeUndefined()
    expect(secondaryCommand(press('Minus', { metaKey: true }))).toBeUndefined()
    expect(secondaryCommand(press('Digit0', { metaKey: true }))).toBeUndefined()
  })
})

describe('terminalInput', () => {
  it('⌘← / ⌘→ 는 ⌃A / ⌃E 로 보낸다', () => {
    expect(terminalInput(press('ArrowLeft', { metaKey: true }))).toBe('\x01')
    expect(terminalInput(press('ArrowRight', { metaKey: true }))).toBe('\x05')
    expect(terminalInput(press('ArrowLeft', { metaKey: true, altKey: true }))).toBeUndefined()
    expect(terminalInput(press('ArrowLeft', { metaKey: true, shiftKey: true }))).toBeUndefined()
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
