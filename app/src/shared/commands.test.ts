import { describe, expect, it } from 'vitest'
import { commands, filterCommands, menuSections, paletteItems } from './commands'

const titles = (query: string): string[] => filterCommands(query).map((c) => c.title)
const shape = (query: string): string[] =>
  paletteItems(filterCommands(query)).map((it) =>
    it.kind === 'head' ? `# ${it.title}` : `${it.i} ${it.command.title}`
  )

describe('filterCommands', () => {
  it('빈 입력이면 팔레트에 보일 명령을 묶음 순서대로 모두 준다', () => {
    const all = [
      'New Workspace',
      'Rename Workspace…',
      'Keep Workspace',
      'Toggle Favorite',
      'Close Workspace',
      'New Cell',
      'Next Cell',
      'Previous Cell',
      'Widen Cell',
      'Narrow Cell',
      'Reset Cell Width',
      'Split Right',
      'Split Down',
      'Next Pane',
      'Previous Pane',
      'Focus Pane Left',
      'Focus Pane Right',
      'Focus Pane Up',
      'Focus Pane Down',
      'Close Pane',
      'Resize Pane Left',
      'Resize Pane Right',
      'Resize Pane Up',
      'Resize Pane Down',
      'Equalize Panes',
      'Open Launcher',
      'Launch in New Workspace…',
      'Launch in New Cell…',
      'Launch Split Right…',
      'Launch Split Down…',
      'Go to Pane or Favorite…',
      'Toggle Sidebar',
      'Toggle Canvas',
      'Toggle View Mode',
      'Increase Font Size',
      'Decrease Font Size',
      'Reset Font Size',
      'Clear Scrollback',
      'Restart'
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
    expect(titles('space new')).toEqual(['New Workspace', 'Launch in New Workspace…'])
    expect(titles('new canvas')).toEqual([])
  })
})

describe('paletteItems', () => {
  it('묶음마다 제목 줄을 앞에 두고, 제목 줄은 고를 번호를 받지 않는다', () => {
    const items = shape('')
    expect(items.filter((s) => s.startsWith('#'))).toEqual([
      '# Workspace',
      '# Cell',
      '# Pane',
      '# Pane Size',
      '# Launch',
      '# Go to',
      '# View',
      '# Terminal',
      '# App'
    ])
    expect(items.slice(0, 3)).toEqual(['# Workspace', '0 New Workspace', '1 Rename Workspace…'])
    expect(items.slice(6, 8)).toEqual(['# Cell', '5 New Cell'])
  })

  it('검색어가 있으면 걸린 명령이 있는 묶음의 제목만 둔다', () => {
    expect(shape('space new')).toEqual([
      '# Workspace',
      '0 New Workspace',
      '# Launch',
      '1 Launch in New Workspace…'
    ])
    expect(shape('font')).toEqual([
      '# Terminal',
      '0 Increase Font Size',
      '1 Decrease Font Size',
      '2 Reset Font Size'
    ])
    expect(shape('new canvas')).toEqual([])
  })
})

describe('menuSections', () => {
  const ids = (menu: 'app' | 'file' | 'view', canRestart = true) =>
    menuSections(menu, { canRestart }).map((s) => s.map((c) => c.id))

  it('메뉴마다 그 메뉴의 명령을 팔레트와 같은 순서로 묶음마다 나눈다', () => {
    expect(ids('file')).toEqual([
      [
        'new-workspace',
        'rename-workspace',
        'toggle-keep-workspace',
        'toggle-favorite-cell',
        'close-workspace'
      ],
      ['new-cell'],
      ['split-right', 'split-down', 'close-pane'],
      ['launcher', 'launch-workspace', 'launch-cell', 'launch-split-right', 'launch-split-down']
    ])
    expect(ids('view')).toEqual([
      ['next-cell', 'previous-cell', 'widen-cell', 'narrow-cell', 'reset-cell-width'],
      [
        'next-pane',
        'previous-pane',
        'focus-pane-left',
        'focus-pane-right',
        'focus-pane-up',
        'focus-pane-down'
      ],
      [
        'resize-pane-left',
        'resize-pane-right',
        'resize-pane-up',
        'resize-pane-down',
        'equalize-panes'
      ],
      ['command-palette', 'go-to-pane'],
      ['toggle-sidebar', 'toggle-canvas', 'toggle-view-mode'],
      ['increase-font-size', 'decrease-font-size', 'reset-font-size', 'clear-scrollback']
    ])
    expect(ids('app')).toEqual([['restart']])
  })

  it('쓸 수 없는 명령만 있던 묶음은 남기지 않는다', () => {
    expect(ids('app', false)).toEqual([])
  })
})

describe('commands', () => {
  it('id 가 겹치지 않는다', () => {
    const ids = commands.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('같은 묶음의 명령은 배열에서 붙어 있다', () => {
    const runs = commands.map((c) => c.group).filter((g, i, a) => g !== a[i - 1])
    expect(new Set(runs).size).toBe(runs.length)
  })
})
