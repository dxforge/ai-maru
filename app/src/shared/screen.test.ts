import { describe, expect, it } from 'vitest'
import {
  joinTables,
  parseCellsTable,
  parsePanesTable,
  parseScreen,
  parseViewPrefs,
  parseWorkspacesTable,
  screenPanes,
  splitScreen,
  STATE_VERSIONS,
  type LayoutPane,
  type ScreenCell,
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
              id: 'n-0000000a',
              ptyId: 'p-0000000a',
              cwd: '/b',
              title: 't',
              git: { repo: 'r', branch: 'main', common: '/r/.git', sub: 'app' }
            },
            { key: 2, id: 'n-0000000b', ptyId: 'p-0000000b', command: ['sh', '-c', 'true'] }
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
const reread = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const reparse = (t: ReturnType<typeof splitScreen>) => ({
  workspaces: parseWorkspacesTable(reread(t.workspaces)),
  cells: parseCellsTable(reread(t.cells)),
  panes: parsePanesTable(reread(t.panes))
})

describe('parseScreen', () => {
  it('맞는 화면은 그대로 돌려준다', () => {
    expect(parseScreen(clone())).toEqual(screen)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 모양을 일부러 깨뜨린다.
  it.each<[string, (s: Record<string, any>) => void]>([
    ['pty id 모양이 아님', (s) => (s.workspaces[0].cells[0].panes[0].ptyId = '../x')],
    ['pane id 가 문자열이 아님', (s) => (s.workspaces[0].cells[0].panes[0].id = 1)],
    ['pane 이 없는 cell', (s) => (s.workspaces[0].cells[0].panes = [])],
    ['핀이 없는데 cell 이 없는 workspace', (s) => (s.workspaces[0].cells = [])],
    ['workspace 핀이 true 가 아님', (s) => (s.workspaces[0].pinned = 1)],
    ['workspace dir 이 문자열이 아님', (s) => (s.workspaces[0].dir = 1)],
    ['즐겨찾기 목록이 배열이 아님', (s) => (s.workspaces[0].favorites = '/a')],
    ['즐겨찾기 목록에 문자열이 아닌 것이 있음', (s) => (s.workspaces[0].favorites = ['/a', 1])],
    ['workspace id 가 문자열이 아님', (s) => (s.workspaces[0].id = 1)],
    ['workspace 이름이 문자열이 아님', (s) => (s.workspaces[0].name = 1)],
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
    ['cell 즐겨찾기가 문자열이 아님', (s) => (s.workspaces[0].cells[0].favorite = 1)],
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

  it('cell 의 즐겨찾기는 없어도 되고, 있으면 그대로 돌려준다', () => {
    const s = clone() as ScreenState
    s.workspaces[0].cells[0].favorite = '/work/app'
    expect(parseScreen(s)!.workspaces[0].cells[0].favorite).toBe('/work/app')
    expect(parseScreen(clone())!.workspaces[0].cells[0]).not.toHaveProperty('favorite')
  })

  it('예전 판이 쓴 cell 의 pin 과 workspace 의 favorite 은 버린다', () => {
    const s = clone()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 예전 판의 키를 넣는다.
    const w = (s as any).workspaces[0]
    w.favorite = 'f-1'
    w.cells[0].pin = '/work/app'
    expect(parseScreen(s)).toEqual(screen)
  })

  it('workspace 이름은 없어도 되고, 있으면 그대로 돌려준다', () => {
    const s = clone() as ScreenState
    s.workspaces[0].name = '리뷰'
    expect(parseScreen(s)!.workspaces[0].name).toBe('리뷰')
    expect(parseScreen(clone())!.workspaces[0]).not.toHaveProperty('name')
  })

  it.each(['', '   '])('workspace 이름이 %j 이면 이름이 없는 것으로 본다', (name) => {
    const s = clone() as ScreenState
    s.workspaces[0].name = name
    expect(parseScreen(s)!.workspaces[0]).not.toHaveProperty('name')
    const { workspaces } = splitScreen(s)
    expect(parseWorkspacesTable(reread(workspaces))!.rows[0]).not.toHaveProperty('name')
  })

  it('핀 workspace 는 cell 없이도 받고, 표로 나눴다가 이어도 그대로다', () => {
    const s = clone() as ScreenState
    Object.assign(s.workspaces[0], {
      key: 0,
      pinned: true,
      dir: '/work/app',
      favorites: ['/work/app', '/work/lib'],
      cells: []
    })
    const parsed = parseScreen(s)!.workspaces[0]
    expect(parsed).toEqual({
      key: 0,
      id: 'w-00000001',
      pinned: true,
      dir: '/work/app',
      favorites: ['/work/app', '/work/lib'],
      cells: []
    })
    const t = splitScreen(s)
    expect(t.workspaces.rows).toEqual([
      { id: 'w-00000001', pinned: true, dir: '/work/app', favorites: ['/work/app', '/work/lib'] }
    ])
    expect(t.cells.rows).toEqual([])
    expect(joinTables(reparse(t))!.workspaces).toEqual([parsed])
  })

  it('핀·dir·즐겨찾기는 없어도 되고, 빈 즐겨찾기 목록은 키를 없앤다', () => {
    const s = clone() as ScreenState
    s.workspaces[0].favorites = []
    const w = parseScreen(s)!.workspaces[0]
    for (const k of ['pinned', 'dir', 'favorites']) expect(w).not.toHaveProperty(k)
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

describe('splitScreen', () => {
  it('workspace·cell·pane 표와 pane id 마다의 pty 로 나누고, 표에는 key 와 pty 를 두지 않는다', () => {
    const t = splitScreen({ ...screen, selected: 3 })
    expect(t.ptys).toEqual([
      { pane: 'n-0000000a', pty: 'p-0000000a' },
      { pane: 'n-0000000b', pty: 'p-0000000b' }
    ])
    expect(t.selected).toBe('c-00000001')
    expect(t.workspaces).toEqual({
      version: STATE_VERSIONS.workspaces,
      rows: [{ id: 'w-00000001' }]
    })
    expect(t.cells).toEqual({
      version: STATE_VERSIONS.cells,
      rows: [
        {
          id: 'c-00000001',
          workspace: 'w-00000001',
          layout: { split: 'down', first: { pane: 'n-0000000a' }, second: { pane: 'n-0000000b' } },
          focused: 'n-0000000a'
        }
      ]
    })
    expect(t.panes.version).toBe(STATE_VERSIONS.panes)
    expect(t.panes.rows.map((p) => [p.id, p.cell])).toEqual([
      ['n-0000000a', 'c-00000001'],
      ['n-0000000b', 'c-00000001']
    ])
    const text = JSON.stringify([t.workspaces, t.cells, t.panes])
    expect(text).not.toContain('ptyId')
    expect(text).not.toContain('"key"')
    expect(reparse(t)).toEqual({ workspaces: t.workspaces, cells: t.cells, panes: t.panes })
  })

  it('선택한 cell 이 없으면 selected 를 두지 않는다', () => {
    expect(splitScreen(screen)).not.toHaveProperty('selected')
  })
})

describe('표 parse', () => {
  const t = splitScreen(screen)
  type Name = 'workspaces' | 'cells' | 'panes'

  it('빈 줄 목록도 받는다', () => {
    const empty = { version: STATE_VERSIONS.cells, rows: [] }
    expect(parseCellsTable(empty)).toEqual(empty)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 모양을 일부러 깨뜨린다.
  it.each<[string, Name, (v: any) => void]>([
    ['workspaces 의 버전이 다름', 'workspaces', (v) => (v.version += 1)],
    ['workspaces 의 줄에 id 가 없음', 'workspaces', (v) => delete v.rows[0].id],
    ['cells 의 버전이 다름', 'cells', (v) => (v.version += 1)],
    ['cells 의 줄에 workspace 가 없음', 'cells', (v) => delete v.rows[0].workspace],
    ['cells 배치의 잎이 문자열이 아님', 'cells', (v) => (v.rows[0].layout.first.pane = 0)],
    ['cells 의 focused 가 문자열이 아님', 'cells', (v) => (v.rows[0].focused = 0)],
    ['panes 의 버전이 다름', 'panes', (v) => (v.version += 1)],
    ['panes 의 줄에 cell 이 없음', 'panes', (v) => delete v.rows[1].cell],
    ['panes 의 줄이 목록이 아님', 'panes', (v) => (v.rows = {})]
  ])('%s 이면 그 표만 null', (_, name, spoil) => {
    const v = reread(t)
    spoil(v[name])
    expect(reparse(v)).toEqual({ ...reparse(t), [name]: null })
  })
})

describe('joinTables', () => {
  const pane = (key: number, cwd: string) => ({ key, id: `n-${key}`, ptyId: 'p-0000000c', cwd })
  const at = (key: number, cwd: string, favorite?: string): ScreenCell => ({
    key,
    id: `c-${key}`,
    panes: [pane(key + 1, cwd)],
    layout: { pane: key + 1 },
    focused: key + 1,
    ...(favorite && { favorite })
  })
  // key 는 joinTables 가 매기는 순서(workspace, 그 cell, 그 pane)로 둔다. 핀을 뺀 workspace 도 즐겨찾기를 남긴다(`setPinned`).
  const full: ScreenState = {
    ...screen,
    workspaces: [
      {
        key: 0,
        id: 'w-0000000a',
        name: 'atlas',
        pinned: true,
        dir: '/work',
        favorites: ['/work/app'],
        cells: [at(1, '/work/app', '/work/app'), at(3, '/work/lib')]
      },
      { key: 5, id: 'w-0000000b', pinned: true, dir: '/work/docs', cells: [] },
      { key: 6, id: 'w-0000000c', name: '리뷰', favorites: ['/r'], cells: [at(7, '/r', '/r')] }
    ],
    selected: 3
  }
  const stripCell = (c: ScreenCell) => ({
    ...c,
    panes: c.panes.map((p) => {
      const q: Partial<typeof p> = { ...p }
      delete q.ptyId
      return q as LayoutPane
    })
  })
  const strip = (w: ScreenState['workspaces'][number]) => ({ ...w, cells: w.cells.map(stripCell) })
  const tables = () => reparse(splitScreen(full))
  const join = (t = tables(), selected: string | undefined = 'c-3') =>
    joinTables(t, selected, () => 'n-new')

  it('세 표를 모두 읽으면 화면이 그대로 돌아온다', () => {
    expect(join()).toEqual({
      workspaces: full.workspaces.map(strip),
      selected: 3
    })
  })

  it('pane 의 순서는 배치의 순서가 아니라 panes 표의 줄 순서다', () => {
    const c: ScreenCell = {
      key: 1,
      id: 'c-1',
      panes: [pane(2, '/b'), pane(3, '/a')],
      layout: { split: 'right', first: { pane: 3 }, second: { pane: 2 } },
      focused: 3
    }
    const s = { ...screen, workspaces: [{ key: 0, id: 'w-1', cells: [c] }] }
    expect(joinTables(reparse(splitScreen(s)))!.workspaces[0].cells[0]).toEqual(stripCell(c))
  })

  it('workspaces 표가 없으면 cell 이 가리키는 id 로 이름·핀·즐겨찾기 없는 workspace 를 만들고, cell 이 없던 핀 workspace 는 버린다', () => {
    const out = join({ ...tables(), workspaces: null })!
    expect(out.workspaces.map((w) => [w.key, w.id, w.name, w.pinned, w.dir, w.favorites])).toEqual([
      [0, 'w-0000000a', undefined, undefined, undefined, undefined],
      [5, 'w-0000000c', undefined, undefined, undefined, undefined]
    ])
    expect(out.workspaces.flatMap((w) => w.cells.map((c) => [c.key, c.favorite]))).toEqual([
      [1, undefined],
      [3, undefined],
      [6, undefined]
    ])
    expect(out.selected).toBe(3)
  })

  it('workspaces 표에 없는 workspace 를 cell 이 가리키면 cell 이 처음 나온 순서로 뒤에 더한다', () => {
    const t = tables()
    const rows = t.workspaces!.rows.filter((w) => w.id !== 'w-0000000a')
    const out = join({ ...t, workspaces: { ...t.workspaces!, rows } })!
    expect(out.workspaces.map((w) => w.id)).toEqual(['w-0000000b', 'w-0000000c', 'w-0000000a'])
  })

  it('cells 표가 없으면 핀 workspace 만 cell 없이 이름·dir·즐겨찾기와 함께 돌아온다', () => {
    expect(join({ ...tables(), cells: null, panes: null })).toEqual({
      workspaces: [
        {
          key: 0,
          id: 'w-0000000a',
          name: 'atlas',
          pinned: true,
          dir: '/work',
          favorites: ['/work/app'],
          cells: []
        },
        { key: 1, id: 'w-0000000b', pinned: true, dir: '/work/docs', cells: [] }
      ],
      selected: null
    })
  })

  it('panes 표가 없으면 cell 마다 workspace 의 dir 에서 새 pane 하나로 연다', () => {
    let n = 0
    const out = joinTables({ ...tables(), panes: null }, 'c-3', () => `n-new${n++}`)!
    expect(
      out.workspaces.flatMap((w) => w.cells.map((c) => [c.id, c.panes, c.layout, c.focused]))
    ).toEqual([
      ['c-1', [{ key: 2, id: 'n-new0', cwd: '/work' }], { pane: 2 }, 2],
      ['c-3', [{ key: 4, id: 'n-new1', cwd: '/work' }], { pane: 4 }, 4],
      ['c-7', [{ key: 8, id: 'n-new2' }], { pane: 8 }, 8]
    ])
    expect(out.workspaces[0].cells[0].favorite).toBe('/work/app')
    expect(out.selected).toBe(3)
  })

  it('workspaces 표도 없으면 dir 를 모르므로 새 pane 에 cwd 를 두지 않는다', () => {
    let n = 0
    const out = joinTables(
      { ...tables(), workspaces: null, panes: null },
      'c-3',
      () => `n-new${n++}`
    )!
    expect(out.workspaces.flatMap((w) => w.cells.map((c) => c.panes))).toEqual([
      [{ key: 2, id: 'n-new0' }],
      [{ key: 4, id: 'n-new1' }],
      [{ key: 7, id: 'n-new2' }]
    ])
  })

  it('배치가 가리키는 pane 이 그 cell 의 줄에 없으면 그 cell 만 새 pane 하나로 연다', () => {
    const t = tables()
    const rows = t.panes!.rows.map((p) => (p.id === 'n-4' ? { ...p, cell: 'c-1' } : p))
    const cells = join({ ...t, panes: { ...t.panes!, rows } })!.workspaces[0].cells
    expect(cells[0].panes.map((p) => p.id)).toEqual(['n-2'])
    expect(cells[1].panes).toEqual([{ key: 4, id: 'n-new', cwd: '/work' }])
  })

  it('배치가 같은 pane 을 두 번 가리키면 그 cell 을 새 pane 하나로 연다', () => {
    const t = tables()
    const twice = { split: 'down' as const, first: { pane: 'n-2' }, second: { pane: 'n-2' } }
    const rows = t.cells!.rows.map((c) => (c.id === 'c-1' ? { ...c, layout: twice } : c))
    const out = join({ ...t, cells: { ...t.cells!, rows } })!
    expect(out.workspaces[0].cells[0].panes.map((p) => p.id)).toEqual(['n-new'])
  })

  it('focused 가 배치에 없으면 첫 pane 에 둔다', () => {
    const t = tables()
    const rows = t.cells!.rows.map((c) => ({ ...c, focused: 'n-x' }))
    const out = join({ ...t, cells: { ...t.cells!, rows } })!
    expect(out.workspaces[0].cells[0].focused).toBe(2)
  })

  it('같은 id 의 줄이 두 번 있으면 앞의 것만 쓴다', () => {
    const t = tables()
    const ws = t.workspaces!
    const cs = t.cells!
    const out = join({
      ...t,
      workspaces: { ...ws, rows: [...ws.rows, { id: 'w-0000000a', name: 'x' }] },
      cells: { ...cs, rows: [...cs.rows, { ...cs.rows[0], fontSize: 20 }] }
    })!
    expect(out.workspaces.filter((w) => w.id === 'w-0000000a').map((w) => w.name)).toEqual([
      'atlas'
    ])
    expect(out.workspaces[0].cells.map((c) => [c.id, c.fontSize])).toEqual([
      ['c-1', undefined],
      ['c-3', undefined]
    ])
  })

  it('cell 의 즐겨찾기 표시는 workspace 의 즐겨찾기에 없으면 지우고, 자리는 그대로다', () => {
    const w = {
      key: 0,
      id: 'w-0000000f',
      pinned: true as const,
      favorites: ['/work/b'],
      cells: [at(1, '/work/a', '/work/a'), at(3, '/work/b', '/work/b'), at(5, '/work/c')]
    }
    const out = joinTables(reparse(splitScreen({ ...screen, workspaces: [w] })))!
    expect(out.workspaces[0].cells.map((c) => [c.key, c.favorite])).toEqual([
      [1, undefined],
      [3, '/work/b'],
      [5, undefined]
    ])
  })

  it('선택한 cell id 가 없거나 모르는 id 면 선택은 null 이다', () => {
    expect(join(tables(), 'c-x')!.selected).toBeNull()
    expect(joinTables(tables())!.selected).toBeNull()
  })

  it('모두 없거나 남는 workspace 가 없으면 null', () => {
    expect(joinTables({ workspaces: null, cells: null, panes: null })).toBeNull()
    const t = tables()
    const rows = t.workspaces!.rows.map((w) => ({ ...w, pinned: undefined }))
    expect(
      join({ ...t, workspaces: { ...t.workspaces!, rows }, cells: null, panes: null })
    ).toBeNull()
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
    expect(parseViewPrefs({ folded: ['w-1', 'w-3'] })).toEqual({ folded: ['w-1', 'w-3'] })
    expect(parseViewPrefs({ folded: [1, 3] })).toEqual({})
    expect(parseViewPrefs([])).toEqual({})
    expect(parseViewPrefs('columns')).toEqual({})
  })
})
