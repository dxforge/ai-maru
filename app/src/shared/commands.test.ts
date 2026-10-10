import { describe, expect, it } from 'vitest'
import { commands, filterCommands } from './commands'

const titles = (query: string): string[] => filterCommands(query).map((c) => c.title)

describe('filterCommands', () => {
  it('빈 입력이면 팔레트에 보일 명령을 목록 순서대로 모두 준다', () => {
    const all = [
      'New Workspace',
      'Split Right',
      'Split Down',
      'Close Pane',
      'Next Workspace',
      'Previous Workspace',
      'Toggle Sidebar',
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

describe('commands', () => {
  it('id 가 겹치지 않는다', () => {
    const ids = commands.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
