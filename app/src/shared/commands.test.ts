import { describe, expect, it } from 'vitest'
import { commands, filterCommands, formatAccelerator } from './commands'

const titles = (query: string): string[] => filterCommands(query).map((c) => c.title)

describe('filterCommands', () => {
  it('빈 입력이면 팔레트에 보일 명령을 목록 순서대로 모두 준다', () => {
    const all = [
      'New Workspace',
      'Split Right',
      'Split Down',
      'Close Pane',
      'Toggle Canvas',
      'Toggle View Mode',
      'Focus Pane Left',
      'Focus Pane Right',
      'Focus Pane Up',
      'Focus Pane Down'
    ]
    expect(titles('')).toEqual(all)
    expect(titles('   ')).toEqual(all)
  })

  it('팔레트를 여는 명령은 보이지 않는다', () => {
    expect(titles('palette')).toEqual([])
  })

  it('단어가 이름에 모두 들어 있는 명령만 남기고 대소문자를 가리지 않는다', () => {
    expect(titles('CANV')).toEqual(['Toggle Canvas'])
    expect(titles('view')).toEqual(['Toggle View Mode'])
    expect(titles('space new')).toEqual(['New Workspace'])
    expect(titles('new canvas')).toEqual([])
  })
})

describe('formatAccelerator', () => {
  it('modifier 를 ⌃⌥⇧⌘ 순서의 기호로 적는다', () => {
    expect(formatAccelerator('Command+N')).toBe('⌘N')
    expect(formatAccelerator('Shift+Command+P')).toBe('⇧⌘P')
    expect(formatAccelerator('Command+Shift+Alt+Control+K')).toBe('⌃⌥⇧⌘K')
  })

  it('Electron 이 받는 다른 이름의 modifier 도 같은 기호로 적는다', () => {
    expect(formatAccelerator('Cmd+K')).toBe('⌘K')
    expect(formatAccelerator('CmdOrCtrl+K')).toBe('⌘K')
    expect(formatAccelerator('CommandOrControl+K')).toBe('⌘K')
    expect(formatAccelerator('Ctrl+Option+K')).toBe('⌃⌥K')
  })

  it('방향키는 화살표로 적는다', () => {
    expect(formatAccelerator('Alt+Command+Left')).toBe('⌥⌘←')
    expect(formatAccelerator('Alt+Command+Right')).toBe('⌥⌘→')
    expect(formatAccelerator('Alt+Command+Up')).toBe('⌥⌘↑')
    expect(formatAccelerator('Alt+Command+Down')).toBe('⌥⌘↓')
  })

  it('Enter 는 메뉴처럼 ↩ 로 적는다', () => {
    expect(formatAccelerator('Control+Command+Enter')).toBe('⌃⌘↩')
  })
})

describe('commands', () => {
  it('id 와 단축키가 겹치지 않는다', () => {
    const ids = commands.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = commands.flatMap((c) => (c.accelerator ? [formatAccelerator(c.accelerator)] : []))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
