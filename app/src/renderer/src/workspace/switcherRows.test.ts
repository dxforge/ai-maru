import { describe, expect, it } from 'vitest'
import type { RowSource } from './sidebarRows'
import type { Cell, Pane, Workspace } from './store'
import { filterSwitcher, switcherItems, switcherRows } from './switcherRows'

const src: RowSource = {
  shown: () => undefined,
  command: () => undefined,
  notification: () => undefined,
  tasks: () => [],
  home: '/h'
}

function pane(key: number, cwd: string, o: Partial<Pane> = {}): Pane {
  return { key, id: `n-${key}`, ptyId: `p-${key}`, cwd, ...o }
}

/**
 * `panes` 의 마지막 pane 을 맨 왼쪽에 두고 거꾸로 나눈 cell 이다. 사이드바 순서는 layout 순서라 `panes` 배열 순서와
 * 다르게 둔다. 자동 workspace 이름은 layout 의 첫 pane 이 아니라 `panes` 배열의 첫 pane 에서 나온다.
 */
function cell(key: number, panes: Pane[], focused = panes[0].key): Cell {
  const [last, ...rest] = [...panes].reverse()
  const layout = rest.reduce<Cell['layout']>(
    (first, p) => ({ split: 'right', first, second: { pane: p.key } }),
    { pane: last.key }
  )
  return { key, id: `c-${key}`, panes, layout, focused }
}

function workspace(key: number, cells: Cell[], o: Partial<Workspace> = {}): Workspace {
  return { key, id: `w-${key}`, cells, ...o }
}

describe('switcherRows', () => {
  const ws = [
    workspace(1, [
      cell(10, [pane(100, '/h/app'), pane(101, '/h/app/lib')]),
      cell(11, [pane(110, '/h/notes')])
    ]),
    workspace(2, [cell(20, [pane(200, '/opt/srv')])], { name: '서버' })
  ]

  it('pane 줄은 사이드바 순서(workspace → cell → layout)로 모든 pane 을 두고, workspace 이름을 붙인다', () => {
    const { panes } = switcherRows(ws, src, 10)
    expect(panes.map((r) => [r.pane, r.cell, r.workspace, r.workspaceName])).toEqual([
      [101, 10, 1, 'app'],
      [100, 10, 1, 'app'],
      [110, 11, 1, 'app'],
      [200, 20, 2, '서버']
    ])
  })

  it('고른 cell 의 포커스된 pane 만 focused 로 표시하고 목록에서 빼지 않는다', () => {
    const at = (selected: number | null) =>
      switcherRows(ws, src, selected)
        .panes.filter((r) => r.focused)
        .map((r) => r.pane)
    expect(at(10)).toEqual([100])
    expect(at(20)).toEqual([200])
    expect(at(null)).toEqual([])
    expect(switcherRows(ws, src, 10).panes).toHaveLength(4)
  })

  it('셸만 도는 pane 도 줄로 둔다', () => {
    const { panes } = switcherRows(ws, src, 10)
    expect(panes.every((r) => !r.state)).toBe(true)
    expect(panes).toHaveLength(4)
  })

  it('favorite 줄은 workspace 마다 workspace 디렉토리를 맨 위에, 즐겨찾기를 이름순으로 그 아래에 두고 경로는 홈에서 본 경로로 보인다', () => {
    const fav = [
      workspace(1, [cell(10, [pane(100, '/h/app')])], {
        favorites: ['/h/app/web', '/opt/data', '/h/app/api']
      }),
      workspace(2, [cell(20, [pane(200, '/h/srv')])])
    ]
    const { dirs } = switcherRows(fav, src, 10)
    expect(dirs.map((r) => [r.workspace, r.dir, r.name, r.path, r.root, r.workspaceName])).toEqual([
      [1, '/h/app', 'app', '~/app', true, 'app'],
      [1, '/h/app/api', 'api', '~/app/api', false, 'app'],
      [1, '/opt/data', 'data', '/opt/data', false, 'app'],
      [1, '/h/app/web', 'web', '~/app/web', false, 'app'],
      [2, '/h/srv', 'srv', '~/srv', true, 'srv']
    ])
  })

  it('cell 이 없는 workspace 는 pane 줄 없이 디렉토리 줄만 둔다', () => {
    const empty = [workspace(3, [], { kept: true, dir: '/h/kept', favorites: ['/h/kept/a'] })]
    const rows = switcherRows(empty, src, null)
    expect(rows.panes).toEqual([])
    expect(rows.dirs.map((r) => [r.dir, r.root])).toEqual([
      ['/h/kept', true],
      ['/h/kept/a', false]
    ])
  })

  it('디렉토리를 모르는 workspace 는 디렉토리 줄을 두지 않는다', () => {
    const unknown = [
      workspace(4, [
        cell(
          40,
          [pane(400, '')].map((p) => ({ ...p, cwd: undefined }))
        )
      ])
    ]
    expect(switcherRows(unknown, src, 40).dirs).toEqual([])
  })

  it('디렉토리를 모르는 workspace 도 즐겨찾기 줄은 둔다', () => {
    const unknown = [
      workspace(4, [cell(40, [{ ...pane(400, ''), cwd: undefined }])], {
        favorites: ['/h/b', '/h/a']
      })
    ]
    expect(switcherRows(unknown, src, 40).dirs.map((r) => [r.dir, r.root])).toEqual([
      ['/h/a', false],
      ['/h/b', false]
    ])
  })
})

describe('switcherItems', () => {
  const ws = [
    workspace(1, [cell(10, [pane(100, '/h/app'), pane(101, '/h/app/web')])], {
      favorites: ['/h/app/docs']
    })
  ]
  const rows = switcherRows(ws, src, 10)
  const shape = (headLast: boolean, r = rows) =>
    switcherItems(r, headLast).map((it) => (it.kind === 'head' ? it.title : `${it.kind}${it.i}`))

  it('위 팔레트는 묶음 이름 줄을 묶음 앞에, 아래 팔레트는 묶음 뒤에 둔다', () => {
    expect(shape(false)).toEqual(['Panes', 'pane0', 'pane1', 'Favorites', 'dir2', 'dir3'])
    expect(shape(true)).toEqual(['pane0', 'pane1', 'Panes', 'dir2', 'dir3', 'Favorites'])
  })

  it('줄이 없는 묶음은 묶음 이름 줄도 두지 않고, 번호는 남은 줄부터 센다', () => {
    expect(shape(false, filterSwitcher(rows, 'docs'))).toEqual(['Favorites', 'dir0'])
    expect(shape(true, { panes: rows.panes, dirs: [] })).toEqual(['pane0', 'pane1', 'Panes'])
    expect(shape(false, { panes: [], dirs: [] })).toEqual([])
  })

  it('workspace 디렉토리를 즐겨찾기에도 넣어 같은 디렉토리 줄이 둘이어도 key 가 겹치지 않는다', () => {
    const dup = [workspace(1, [cell(10, [pane(100, '/h/app')])], { favorites: ['/h/app'] })]
    const keys = switcherItems(switcherRows(dup, src, 10), false).map((it) => it.key)
    expect(keys.filter((k) => k.startsWith('dir:'))).toHaveLength(2)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('filterSwitcher', () => {
  const git = { repo: 'ai-maru', branch: 'feat/x', sub: '' }
  const ws = [
    workspace(1, [cell(10, [pane(100, '/h/ai-maru', { git }), pane(101, '/h/notes')])], {
      favorites: ['/h/ai-maru/docs']
    }),
    workspace(2, [cell(20, [pane(200, '/opt/srv', { title: 'htop' })])], { name: '서버' })
  ]
  const rows = switcherRows(ws, src, 10)
  const panesOf = (q: string) => filterSwitcher(rows, q).panes.map((r) => r.pane)
  const dirsOf = (q: string) => filterSwitcher(rows, q).dirs.map((r) => r.dir)

  it('빈 입력이면 모든 줄을 그대로 둔다', () => {
    expect(filterSwitcher(rows, '')).toEqual(rows)
    expect(filterSwitcher(rows, '  ')).toEqual(rows)
  })

  it('pane 이름·branch·경로·workspace 이름에 맞추고 대소문자를 가리지 않는다', () => {
    expect(panesOf('HTOP')).toEqual([200])
    expect(panesOf('feat/x')).toEqual([100])
    expect(panesOf('~/notes')).toEqual([101])
    expect(panesOf('서버')).toEqual([200])
  })

  it('단어가 모두 들어 있는 줄만 남긴다', () => {
    expect(panesOf('ai-maru notes')).toEqual([101])
    expect(panesOf('서버 notes')).toEqual([])
  })

  it('favorite 줄은 디렉토리 이름·경로·workspace 이름에 맞춘다', () => {
    expect(dirsOf('docs')).toEqual(['/h/ai-maru/docs'])
    expect(dirsOf('~/ai-maru/docs')).toEqual(['/h/ai-maru/docs'])
    expect(dirsOf('서버')).toEqual(['/opt/srv'])
  })

  it('셸 pane 에서 명령이 도는 동안에도 repo·branch 를 줄에 두고 branch 로 거른다', () => {
    const running: RowSource = {
      ...src,
      command: (pty) => (pty === 'p-100' ? { running: true, text: 'claude' } : undefined)
    }
    const r = switcherRows(ws, running, 10)
    expect(r.panes.find((p) => p.pane === 100)?.place).toEqual({ branch: 'feat/x' })
    expect(filterSwitcher(r, 'feat/x').panes.map((p) => p.pane)).toEqual([100])
  })

  it('NFD 로 온 한글 경로도 NFC 로 친 입력에 맞춘다', () => {
    const nfd = '/h/문서'.normalize('NFD')
    const r = switcherRows([workspace(5, [cell(50, [pane(500, nfd)])])], src, null)
    expect(filterSwitcher(r, '문서').panes.map((p) => p.pane)).toEqual([500])
    expect(filterSwitcher(r, '문서').dirs.map((d) => d.dir)).toEqual([nfd])
  })
})
