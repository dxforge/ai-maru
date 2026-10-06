import { describe, expect, it } from 'vitest'
import { createWorkspaces, focusedPane } from './store'

function opened(n: number) {
  const ws = createWorkspaces()
  for (let i = 0; i < n; i++) ws.open(`s-${i}`)
  return ws
}

type Workspaces = ReturnType<typeof createWorkspaces>

const keys = (ws: Workspaces) => ws.list.value.map((w) => w.key)
const firstPanes = (ws: Workspaces) => ws.list.value.map((w) => w.panes[0])
const selected = (ws: Workspaces) => ws.selected()!

describe('workspaces', () => {
  it('새로 띄운 세션의 id 를 그 칸에 단다', () => {
    const ws = createWorkspaces()
    ws.open()
    ws.open()
    ws.setSessionId(firstPanes(ws)[0].key, 's-9')
    expect(firstPanes(ws).map((p) => p.sessionId)).toEqual(['s-9', undefined])
  })

  it('연 workspace 는 칸 하나로 목록 끝에 붙고 선택된다', () => {
    const ws = opened(2)
    ws.open()
    expect(firstPanes(ws).map((p) => p.sessionId)).toEqual(['s-0', 's-1', undefined])
    expect(ws.selectedKey.value).toBe(keys(ws)[2])
    expect(selected(ws).panes).toHaveLength(1)
    expect(selected(ws).focused).toBe(selected(ws).panes[0].key)
  })

  it('선택한 workspace 의 마지막 칸이 닫히면 workspace 도 닫고 바로 아래 것을 선택한다', () => {
    const ws = opened(3)
    const [, middle, last] = keys(ws)
    ws.select(middle)
    ws.closePane(firstPanes(ws)[1].key)
    expect(keys(ws)).not.toContain(middle)
    expect(ws.selectedKey.value).toBe(last)
  })

  it('맨 아래의 선택한 workspace 가 닫히면 바로 위 것을 선택한다', () => {
    const ws = opened(3)
    const [, middle] = keys(ws)
    ws.closePane(firstPanes(ws)[2].key)
    expect(ws.selectedKey.value).toBe(middle)
  })

  it('선택하지 않은 workspace 가 닫히면 선택은 그대로다', () => {
    const ws = opened(3)
    const [, , last] = keys(ws)
    ws.closePane(firstPanes(ws)[0].key)
    expect(ws.selectedKey.value).toBe(last)
  })

  it('마지막 workspace 가 닫히면 아무것도 선택하지 않는다', () => {
    const ws = opened(1)
    ws.closePane(firstPanes(ws)[0].key)
    expect(ws.list.value).toEqual([])
    expect(ws.selectedKey.value).toBeNull()
    expect(ws.selected()).toBeUndefined()
  })

  it('open 에 준 시작 디렉토리는 cwd 가 아니고, cwd 는 setCwd 로 정한다', () => {
    const ws = createWorkspaces()
    ws.open(undefined, '/a')
    const [pane] = firstPanes(ws)
    expect(pane.startDir).toBe('/a')
    expect(pane.cwd).toBeUndefined()
    ws.setCwd(pane.key, '/b')
    expect(firstPanes(ws)[0].cwd).toBe('/b')
  })
})

describe('panes', () => {
  it('나누면 새 칸이 포커스가 있던 칸의 cwd 에서 시작하고 포커스를 받는다', () => {
    const ws = opened(1)
    const first = selected(ws).panes[0].key
    ws.setCwd(first, '/work')
    ws.split('right')
    const w = selected(ws)
    expect(w.panes).toHaveLength(2)
    const added = w.panes[1]
    expect(added.startDir).toBe('/work')
    expect(added.sessionId).toBeUndefined()
    expect(w.focused).toBe(added.key)
    expect(w.layout).toEqual({
      split: 'right',
      first: { pane: first },
      second: { pane: added.key }
    })
  })

  it('cwd 를 아직 모르는 칸을 나누면 그 칸의 시작 디렉토리에서 시작한다', () => {
    const ws = createWorkspaces()
    ws.open(undefined, '/start')
    ws.split('down')
    expect(selected(ws).panes[1].startDir).toBe('/start')
  })

  it('선택된 workspace 만 나눈다', () => {
    const ws = opened(2)
    ws.select(keys(ws)[0])
    ws.split('down')
    expect(ws.list.value.map((w) => w.panes.length)).toEqual([2, 1])
  })

  it('포커스가 있는 칸을 닫으면 형제 칸이 자리와 포커스를 받는다', () => {
    const ws = opened(1)
    const a = selected(ws).panes[0].key
    ws.split('right')
    const b = selected(ws).focused
    ws.split('down')
    const c = selected(ws).focused
    ws.closePane(c)
    expect(selected(ws).focused).toBe(b)
    expect(selected(ws).layout).toEqual({ split: 'right', first: { pane: a }, second: { pane: b } })
    expect(selected(ws).panes.map((p) => p.key)).toEqual([a, b])
  })

  it('포커스가 없는 칸이 닫히면 포커스는 그대로다', () => {
    const ws = opened(1)
    const a = selected(ws).panes[0].key
    ws.split('right')
    const b = selected(ws).focused
    ws.closePane(a)
    expect(selected(ws).focused).toBe(b)
    expect(selected(ws).layout).toEqual({ pane: b })
  })

  it('보이지 않는 workspace 의 칸이 닫혀도 선택은 그대로다', () => {
    const ws = opened(2)
    ws.select(keys(ws)[0])
    ws.split('right')
    const hidden = selected(ws).focused
    ws.select(keys(ws)[1])
    ws.closePane(hidden)
    expect(ws.selectedKey.value).toBe(keys(ws)[1])
    expect(ws.list.value[0].panes).toHaveLength(1)
  })

  it('없는 칸을 닫거나 그 칸에 값을 달아도 아무것도 바뀌지 않는다', () => {
    const ws = opened(1)
    const before = JSON.stringify(ws.list.value)
    ws.closePane(999)
    ws.setCwd(999, '/x')
    ws.setSessionId(999, 's-x')
    ws.focusPane(999)
    expect(JSON.stringify(ws.list.value)).toBe(before)
  })

  it('focusPane 은 그 칸의 workspace 에서 포커스를 옮긴다', () => {
    const ws = opened(1)
    const a = selected(ws).panes[0].key
    ws.split('right')
    ws.focusPane(a)
    expect(selected(ws).focused).toBe(a)
  })

  it('moveFocus 는 그 방향에 칸이 있으면 옮기고 없으면 그대로 둔다', () => {
    const ws = opened(1)
    const a = selected(ws).panes[0].key
    ws.split('right')
    const b = selected(ws).focused
    ws.moveFocus('right')
    expect(selected(ws).focused).toBe(b)
    ws.moveFocus('left')
    expect(selected(ws).focused).toBe(a)
    ws.moveFocus('up')
    expect(selected(ws).focused).toBe(a)
  })

  it('focusedPane 은 포커스가 있는 칸이다', () => {
    const ws = opened(1)
    ws.split('down')
    expect(focusedPane(selected(ws)).key).toBe(selected(ws).focused)
  })

  it('선택된 workspace 가 없으면 split·moveFocus 는 아무것도 바꾸지 않는다', () => {
    const ws = createWorkspaces()
    ws.split('right')
    ws.moveFocus('left')
    expect(ws.list.value).toEqual([])
  })

  it('보이지 않는 workspace 의 칸에 포커스를 주어도 선택은 그대로다', () => {
    const ws = opened(2)
    const [first, second] = keys(ws)
    const hidden = ws.list.value[0].panes[0].key
    ws.focusPane(hidden)
    expect(ws.selectedKey.value).toBe(second)
    expect(ws.list.value.find((w) => w.key === first)!.focused).toBe(hidden)
  })
})
