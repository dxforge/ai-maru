import { describe, expect, it } from 'vitest'
import {
  parseLayoutPart,
  parseScreen,
  parseViewPrefs,
  screenPanes,
  splitScreen,
  STATE_VERSIONS,
  type ScreenState
} from './screen'

const screen: ScreenState = {
  workspaces: [
    {
      key: 1,
      id: 'w-00000001',
      cells: [
        {
          key: 3,
          id: 'c-00000001',
          panes: [
            {
              key: 0,
              ptyId: 'p-0000000a',
              startDir: '/a',
              cwd: '/b',
              title: 't',
              git: { repo: 'r', branch: 'main', common: '/r/.git', sub: 'app' }
            },
            { key: 2, ptyId: 'p-0000000b', command: ['sh', '-c', 'true'] }
          ],
          layout: { split: 'down', first: { pane: 0 }, second: { pane: 2 } },
          focused: 0
        }
      ]
    }
  ],
  selected: null,
  sidebar: { open: true, width: 282, folded: [] },
  viewMode: 'single'
}

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(screen))

describe('parseScreen', () => {
  it('맞는 화면은 그대로 돌려준다', () => {
    expect(parseScreen(clone())).toEqual(screen)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 모양을 일부러 깨뜨린다.
  it.each<[string, (s: Record<string, any>) => void]>([
    ['pty id 모양이 아님', (s) => (s.workspaces[0].cells[0].panes[0].ptyId = '../x')],
    ['pane 이 없는 cell', (s) => (s.workspaces[0].cells[0].panes = [])],
    ['cell 이 없는 workspace', (s) => (s.workspaces[0].cells = [])],
    ['workspace id 가 문자열이 아님', (s) => (s.workspaces[0].id = 1)],
    ['cell id 가 문자열이 아님', (s) => (s.workspaces[0].cells[0].id = 1)],
    ['배치의 나눔 방향이 틀림', (s) => (s.workspaces[0].cells[0].layout.split = 'left')],
    ['명령이 문자열 배열이 아님', (s) => (s.workspaces[0].cells[0].panes[1].command = [1])],
    ['git 의 저장소 이름이 없음', (s) => (s.workspaces[0].cells[0].panes[0].git = { branch: 'x' })],
    ['git 의 branch 가 문자열이 아님', (s) => (s.workspaces[0].cells[0].panes[0].git.branch = 1)],
    ['git 의 common 이 문자열이 아님', (s) => (s.workspaces[0].cells[0].panes[0].git.common = 1)],
    ['git 의 sub 가 문자열이 아님', (s) => (s.workspaces[0].cells[0].panes[0].git.sub = 1)],
    ['선택이 정수가 아님', (s) => (s.selected = '1')],
    ['접은 목록이 없음', (s) => delete s.sidebar.folded],
    ['보기 모드가 틀림', (s) => (s.viewMode = 'grid')],
    ['Canvas 폭이 숫자가 아님', (s) => (s.canvas = { width: '300' })],
    ['글꼴 크기가 숫자가 아님', (s) => (s.workspaces[0].cells[0].fontSize = '16')],
    ['글꼴 크기가 유한하지 않음', (s) => (s.workspaces[0].cells[0].fontSize = null)],
    ['pane 폭이 숫자가 아님', (s) => (s.workspaces[0].cells[0].paneCols = '110')],
    ['pane 폭이 정수가 아님', (s) => (s.workspaces[0].cells[0].paneCols = 110.5)],
    ['pane 폭이 0', (s) => (s.workspaces[0].cells[0].paneCols = 0)],
    ['pane 폭이 음수', (s) => (s.workspaces[0].cells[0].paneCols = -5)],
    ['keep 이 true 가 아님', (s) => (s.workspaces[0].cells[0].panes[1].keep = false)]
  ])('%s 이면 null', (_, spoil) => {
    const s = clone()
    spoil(s)
    expect(parseScreen(s)).toBeNull()
  })

  it('cell 의 글꼴 크기는 없어도 되고, 있으면 그대로 돌려준다', () => {
    const s = clone() as ScreenState
    s.workspaces[0].cells[0].fontSize = 16.5
    expect(parseScreen(s)!.workspaces[0].cells[0].fontSize).toBe(16.5)
  })

  it('pane 의 keep 은 없어도 되고, 있으면 그대로 돌려준다', () => {
    const s = clone() as ScreenState
    s.workspaces[0].cells[0].panes[1].keep = true
    expect(parseScreen(s)!.workspaces[0].cells[0].panes[1].keep).toBe(true)
    expect(parseScreen(clone())!.workspaces[0].cells[0].panes[1]).not.toHaveProperty('keep')
  })

  it('cell 의 pane 폭은 없어도 되고, 있으면 그대로 돌려준다', () => {
    const s = clone() as ScreenState
    s.workspaces[0].cells[0].paneCols = 110
    expect(parseScreen(s)!.workspaces[0].cells[0].paneCols).toBe(110)
  })

  it('Canvas 폭은 없어도 되고, 있으면 그대로 돌려준다', () => {
    expect(parseScreen({ ...clone(), canvas: { width: 300 } })).toEqual({
      ...screen,
      canvas: { width: 300 }
    })
  })

  it('모르는 필드는 어느 단계에 있든 버린다 — 옛 빌드가 cell 에 쓴 openedBy 도', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 모르는 필드를 일부러 더한다.
    const s: Record<string, any> = clone()
    s.extra = 1
    s.sidebar.extra = 1
    s.canvas = { width: 300, extra: 1 }
    const w = s.workspaces[0]
    w.extra = 1
    const c = w.cells[0]
    c.openedBy = 3
    c.layout.extra = 1
    c.layout.first.extra = 1
    c.panes[0].extra = 1
    c.panes[0].git.extra = 1
    expect(parseScreen(s)).toEqual({ ...screen, canvas: { width: 300 } })
  })

  it('객체가 아니면 null', () => {
    expect(parseScreen(null)).toBeNull()
    expect(parseScreen([])).toBeNull()
  })
})

describe('splitScreen · parseLayoutPart', () => {
  it('pty 를 뺀 레이아웃과 pane 마다의 pty 로 나누고, 나눈 레이아웃은 그대로 읽힌다', () => {
    const { layout, ptys } = splitScreen(screen)
    expect(ptys).toEqual([
      { pane: 0, pty: 'p-0000000a' },
      { pane: 2, pty: 'p-0000000b' }
    ])
    expect(JSON.stringify(layout)).not.toContain('ptyId')
    expect(layout.version).toBe(STATE_VERSIONS.layout)
    expect(parseLayoutPart(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })

  it('버전이 다르거나 모양이 틀리면 null', () => {
    const { layout } = splitScreen(screen)
    expect(parseLayoutPart({ ...layout, version: STATE_VERSIONS.layout + 1 })).toBeNull()
    expect(parseLayoutPart({ ...layout, selected: 'x' })).toBeNull()
    expect(parseLayoutPart({ ...layout, workspaces: [{ key: 1, id: 'w', cells: [] }] })).toBeNull()
    expect(parseLayoutPart(null)).toBeNull()
  })
})

describe('screenPanes', () => {
  it('모든 pane 과 cell id 를 주고, workspace 를 주면 그 workspace 의 것만 준다', () => {
    const two = clone() as unknown as ScreenState
    two.workspaces.push({ ...two.workspaces[0], key: 9, id: 'w-00000002', cells: [] })
    expect(screenPanes(two).panes.map((p) => p.ptyId)).toEqual(['p-0000000a', 'p-0000000b'])
    expect(screenPanes(two).cells).toEqual(['c-00000001'])
    expect(screenPanes(two, 'w-00000002')).toEqual({ panes: [], cells: [] })
    expect(screenPanes(two, 'w-00000001').panes[1].command).toEqual(['sh', '-c', 'true'])
    expect(screenPanes(null)).toEqual({ panes: [], cells: [] })
  })
})

describe('parseViewPrefs', () => {
  it('화면에서 보기 모드, 사이드바 열림·폭, Canvas 폭만 골라낸다', () => {
    expect(parseViewPrefs({ ...clone(), viewMode: 'columns' })).toEqual({
      viewMode: 'columns',
      sidebar: { open: true, width: 282 }
    })
    expect(parseViewPrefs({ ...clone(), canvas: { width: 300 } })).toEqual({
      viewMode: 'single',
      sidebar: { open: true, width: 282 },
      canvas: { width: 300 }
    })
  })

  it('필드마다 따로 읽어, 틀린 필드만 버린다', () => {
    expect(parseViewPrefs({ viewMode: 'single' })).toEqual({ viewMode: 'single' })
    expect(parseViewPrefs({ viewMode: 'grid', sidebar: { open: false, width: 300 } })).toEqual({
      sidebar: { open: false, width: 300 }
    })
    expect(parseViewPrefs({ viewMode: 'columns', sidebar: { open: 'no', width: 300 } })).toEqual({
      viewMode: 'columns'
    })
    expect(parseViewPrefs({ sidebar: { open: true } })).toEqual({})
  })

  it('사이드바 폭은 끌어서 정할 수 있는 범위로 자른다', () => {
    for (const [width, expected] of [
      [0, 200],
      [-50, 200],
      [100, 200],
      [300, 300],
      [5000, 480]
    ])
      expect(parseViewPrefs({ sidebar: { open: true, width } })).toEqual({
        sidebar: { open: true, width: expected }
      })
  })

  it('Canvas 폭은 240 아래로 자르고 위로는 자르지 않으며, 숫자가 아니면 버린다', () => {
    for (const [width, expected] of [
      [0, 240],
      [100, 240],
      [300, 300],
      [5000, 5000]
    ])
      expect(parseViewPrefs({ canvas: { width } })).toEqual({ canvas: { width: expected } })
    expect(parseViewPrefs({ canvas: { width: '300' } })).toEqual({})
    expect(parseViewPrefs({ canvas: 300 })).toEqual({})
  })

  it('객체가 아니면 빈 설정', () => {
    expect(parseViewPrefs(null)).toEqual({})
    expect(parseViewPrefs({ folded: [1, 3] })).toEqual({ folded: [1, 3] })
    expect(parseViewPrefs({ folded: [1, 'x'] })).toEqual({})
    expect(parseViewPrefs([])).toEqual({})
    expect(parseViewPrefs('columns')).toEqual({})
  })
})
