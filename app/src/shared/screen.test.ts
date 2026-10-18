import { describe, expect, it } from 'vitest'
import { parseScreen, SCREEN_VERSION, type ScreenState } from './screen'

const screen: ScreenState = {
  version: SCREEN_VERSION,
  workspaces: [
    {
      key: 1,
      id: 'w-00000001',
      panes: [
        { key: 0, sessionId: 's-0000000a', startDir: '/a', cwd: '/b', title: 't' },
        { key: 2, sessionId: 's-0000000b', command: ['sh', '-c', 'true'] }
      ],
      layout: { split: 'down', first: { pane: 0 }, second: { pane: 2 } },
      focused: 0
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
    ['버전이 다름', (s) => (s.version = SCREEN_VERSION + 1)],
    ['세션 id 모양이 아님', (s) => (s.workspaces[0].panes[0].sessionId = '../x')],
    ['pane 이 없는 workspace', (s) => (s.workspaces[0].panes = [])],
    ['배치의 나눔 방향이 틀림', (s) => (s.workspaces[0].layout.split = 'left')],
    ['명령이 문자열 배열이 아님', (s) => (s.workspaces[0].panes[1].command = [1])],
    ['선택이 정수가 아님', (s) => (s.selected = '1')],
    ['접은 목록이 없음', (s) => delete s.sidebar.folded],
    ['보기 모드가 틀림', (s) => (s.viewMode = 'grid')]
  ])('%s 이면 null', (_, spoil) => {
    const s = clone()
    spoil(s)
    expect(parseScreen(s)).toBeNull()
  })

  it('객체가 아니면 null', () => {
    expect(parseScreen(null)).toBeNull()
    expect(parseScreen([])).toBeNull()
  })
})
