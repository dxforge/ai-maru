import { describe, expect, it } from 'vitest'
import type { GitHead } from '../../../shared/git'
import { isSessionId } from '../../../shared/session'
import { createWorkspaces, focusedPane } from './store'

function opened(n: number) {
  const ws = createWorkspaces()
  for (let i = 0; i < n; i++) ws.open(`/d-${i}`)
  return ws
}

type Workspaces = ReturnType<typeof createWorkspaces>

const keys = (ws: Workspaces) => ws.list.value.map((w) => w.key)
const firstPanes = (ws: Workspaces) => ws.list.value.map((w) => w.panes[0])
const selected = (ws: Workspaces) => ws.selected()!

function restarted(from: Workspaces): Workspaces {
  const to = createWorkspaces()
  to.restore(from.snapshot())
  return to
}

describe('snapshot·restore', () => {
  function arranged(): Workspaces {
    const ws = opened(2)
    ws.split('down')
    const p = selected(ws).panes[1]
    ws.setCwd(p.key, '/moved')
    ws.setTitle(p.key, 'vim')
    ws.setFontSize(selected(ws).key, 18)
    ws.setPaneCols(selected(ws).key, 110)
    ws.select(ws.list.value[0].key)
    return ws
  }

  it('되살린 store 는 workspace·pane·배치·포커스·선택이 같다', () => {
    const from = arranged()
    const to = restarted(from)
    expect(to.snapshot()).toEqual(from.snapshot())
    expect(to.selected()!.key).toBe(from.selected()!.key)
    const pane = to.list.value[1].panes[1]
    expect([pane.cwd, pane.title]).toEqual(['/moved', 'vim'])
    expect(to.list.value.map((w) => w.fontSize)).toEqual([undefined, 18])
    expect(to.list.value.map((w) => w.paneCols)).toEqual([undefined, 110])
  })

  it('되살린 pane 은 세션에 붙고, 스냅샷에는 붙기·git 을 싣지 않는다', () => {
    const to = restarted(arranged())
    expect(to.list.value.flatMap((w) => w.panes.map((p) => p.attach))).toEqual([true, true, true])
    for (const w of to.snapshot().workspaces)
      for (const p of w.panes) expect(Object.keys(p)).not.toContain('attach')
  })

  it('되살린 뒤 새로 연 workspace·pane 의 key 가 겹치지 않고 새 pane 은 세션을 띄운다', () => {
    const to = restarted(arranged())
    to.open()
    to.split('right')
    const all = to.list.value.flatMap((w) => [w.key, ...w.panes.map((p) => p.key)])
    expect(new Set(all).size).toBe(all.length)
    expect(selected(to).panes.map((p) => p.attach)).toEqual([undefined, undefined])
  })
})

describe('workspaces', () => {
  it('pane 을 만들 때마다 그 세션의 id 를 새로 정한다', () => {
    let n = 0
    const ws = createWorkspaces(undefined, undefined, () => `s-${++n}`)
    ws.open()
    ws.split('right')
    ws.splitFrom(selected(ws).panes[0].key, 'down', {})
    ws.open()
    expect(ws.list.value.flatMap((w) => w.panes.map((p) => p.sessionId))).toEqual([
      's-1',
      's-2',
      's-3',
      's-4'
    ])
  })

  it('기본 세션 id 는 세션 id 모양이고 pane 마다 다르다', () => {
    const ws = opened(2)
    const [a, b] = firstPanes(ws).map((p) => p.sessionId)
    expect(isSessionId(a) && isSessionId(b)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('workspace 를 열 때마다 id 를 새로 정하고, 나눈 pane 은 workspace 의 id 를 바꾸지 않는다', () => {
    let n = 0
    const ws = createWorkspaces(undefined, undefined, undefined, () => `w-${++n}`)
    ws.open()
    ws.split('right')
    ws.open()
    expect(ws.list.value.map((w) => w.id)).toEqual(['w-1', 'w-2'])
  })

  it('기본 workspace id 는 w- 뒤에 16진 8자리이고 workspace 마다 다르다', () => {
    const [a, b] = opened(2).list.value.map((w) => w.id)
    expect(a).toMatch(/^w-[0-9a-f]{8}$/)
    expect(b).toMatch(/^w-[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
  })

  it('연 workspace 는 pane 하나로 목록 끝에 붙고 선택된다', () => {
    const ws = opened(2)
    ws.open()
    expect(firstPanes(ws).map((p) => p.startDir)).toEqual(['/d-0', '/d-1', undefined])
    expect(ws.selectedKey.value).toBe(keys(ws)[2])
    expect(selected(ws).panes).toHaveLength(1)
    expect(selected(ws).focused).toBe(selected(ws).panes[0].key)
  })

  it('선택한 workspace 의 마지막 pane 이 닫히면 workspace 도 닫고 바로 아래 것을 선택한다', () => {
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
    ws.open('/a')
    const [pane] = firstPanes(ws)
    expect(pane.startDir).toBe('/a')
    expect(pane.cwd).toBeUndefined()
    ws.setCwd(pane.key, '/b')
    expect(firstPanes(ws)[0].cwd).toBe('/b')
  })

  it('setFontSize 는 그 workspace 의 글꼴 크기만 바꾸고, undefined 면 지운다', () => {
    const ws = opened(2)
    const [a] = keys(ws)
    ws.setFontSize(a, 16)
    expect(ws.list.value.map((w) => w.fontSize)).toEqual([16, undefined])
    ws.setFontSize(a, undefined)
    ws.setFontSize(-1, 20)
    expect(ws.list.value.map((w) => w.fontSize)).toEqual([undefined, undefined])
  })

  it('나눈 pane 과 새로 연 workspace 는 글꼴 크기를 바꾸지 않는다', () => {
    const ws = opened(1)
    ws.setFontSize(selected(ws).key, 20)
    ws.split('right')
    expect(selected(ws).fontSize).toBe(20)
    ws.open()
    ws.openFrom(ws.list.value[0].id, {})
    expect(ws.list.value.map((w) => w.fontSize)).toEqual([20, undefined, undefined])
  })

  it('setPaneCols 는 그 workspace 의 pane 폭만 바꾸고, undefined 면 지운다', () => {
    const ws = opened(2)
    ws.setPaneCols(selected(ws).key, 110)
    expect(ws.list.value.map((w) => w.paneCols)).toEqual([undefined, 110])
    ws.setPaneCols(selected(ws).key, undefined)
    expect(ws.list.value.map((w) => 'paneCols' in w)).toEqual([false, false])
  })

  it('나눈 pane 과 새로 연 workspace 는 pane 폭을 바꾸거나 물려받지 않는다', () => {
    const ws = opened(1)
    ws.setPaneCols(selected(ws).key, 144)
    ws.split('right')
    expect(selected(ws).paneCols).toBe(144)
    ws.openFrom(selected(ws).id, {})
    ws.open()
    expect(ws.list.value.map((w) => w.paneCols)).toEqual([144, undefined, undefined])
  })

  it('setTitle 은 그 pane 의 제목만 바꾼다', () => {
    const ws = opened(1)
    ws.split('right')
    ws.setTitle(selected(ws).panes[1].key, 'task')
    expect(selected(ws).panes.map((p) => p.title)).toEqual([undefined, 'task'])
  })
})

describe('git', () => {
  function reader() {
    const pending: { cwd: string; resolve: (g: GitHead | null) => void }[] = []
    const read = (cwd: string) =>
      new Promise<GitHead | null>((resolve) => pending.push({ cwd, resolve }))
    const answer = async (cwd: string, git: GitHead | null) => {
      for (const p of pending.filter((p) => p.cwd === cwd)) p.resolve(git)
      await Promise.resolve()
    }
    return { read, pending, answer }
  }

  it('cwd 를 받으면 그 디렉토리의 저장소를 읽고, 늦게 온 이전 디렉토리의 답은 버린다', async () => {
    const r = reader()
    const ws = createWorkspaces(r.read)
    ws.open()
    const key = selected(ws).panes[0].key
    ws.setCwd(key, '/a')
    ws.setCwd(key, '/b')
    await r.answer('/b', { repo: 'b', branch: 'main' })
    await r.answer('/a', { repo: 'a', branch: 'old' })
    expect(selected(ws).panes[0].git).toEqual({ repo: 'b', branch: 'main' })
    ws.setCwd(key, '/c')
    await r.answer('/c', null)
    expect(selected(ws).panes[0].git).toBeUndefined()
  })

  it('같은 디렉토리를 두 번 읽어 답이 거꾸로 와도 나중에 청한 답이 남는다', async () => {
    const r = reader()
    const ws = createWorkspaces(r.read)
    ws.open()
    const key = selected(ws).panes[0].key
    ws.setCwd(key, '/a')
    ws.setCwd(key, '/a')
    const [older, newer] = r.pending
    newer.resolve({ repo: 'a', branch: 'feat' })
    await Promise.resolve()
    older.resolve({ repo: 'a', branch: 'main' })
    await Promise.resolve()
    expect(selected(ws).panes[0].git).toEqual({ repo: 'a', branch: 'feat' })
  })

  it('저장소와 branch 가 그대로면 값을 바꾸지 않는다', async () => {
    const r = reader()
    const ws = createWorkspaces(r.read)
    ws.open()
    const key = selected(ws).panes[0].key
    ws.setCwd(key, '/a')
    await r.answer('/a', { repo: 'a', branch: 'main' })
    const before = selected(ws).panes[0].git
    ws.setCwd(key, '/a')
    await r.answer('/a', { repo: 'a', branch: 'main' })
    expect(selected(ws).panes[0].git).toBe(before)
  })

  it('다른 디렉토리로 옮긴 뒤 읽지 못하면 이전 저장소를 남기지 않고, 읽는 사이 닫힌 pane 의 답은 버린다', async () => {
    const r = reader()
    let fail = false
    const ws = createWorkspaces((cwd) => (fail ? Promise.reject(new Error('x')) : r.read(cwd)))
    ws.open()
    const key = selected(ws).panes[0].key
    ws.setCwd(key, '/a')
    await r.answer('/a', { repo: 'a', branch: 'main' })
    fail = true
    ws.setCwd(key, '/tmp')
    await new Promise((resolve) => setTimeout(resolve))
    expect(selected(ws).panes[0].git).toBeUndefined()

    fail = false
    ws.split('right')
    const other = selected(ws).panes[1].key
    ws.setCwd(other, '/b')
    ws.closePane(other)
    await r.answer('/b', { repo: 'b', branch: 'main' })
    expect(selected(ws).panes.map((p) => p.key)).toEqual([key])
  })

  function foreground() {
    const asked: { sessionId: string; resolve: (cwd: string | null) => void }[] = []
    const read = (sessionId: string) =>
      new Promise<string | null>((resolve) => asked.push({ sessionId, resolve }))
    const answer = async (cwd: string | null) => {
      for (const a of asked.splice(0)) a.resolve(cwd)
      await Promise.resolve()
    }
    return { read, asked, answer }
  }

  it('refreshSession 은 그 세션의 pane 만, foreground 프로세스의 cwd 로 옮기고 그 cwd 의 저장소를 읽는다', async () => {
    const r = reader()
    const fg = foreground()
    const ws = createWorkspaces(r.read, fg.read)
    ws.open()
    const first = selected(ws).panes[0].key
    ws.split('right')
    const second = selected(ws).panes[1]
    ws.setCwd(first, '/a')
    ws.setCwd(second.key, '/b')
    r.pending.length = 0
    ws.refreshSession(second.sessionId)
    expect(fg.asked.map((a) => a.sessionId)).toEqual([second.sessionId])
    await fg.answer('/wt')
    expect(selected(ws).panes[1].cwd).toBe('/wt')
    expect(r.pending.map((p) => p.cwd)).toEqual(['/wt'])
    await r.answer('/wt', { repo: 'b', branch: 'wt' })
    expect(selected(ws).panes[1].git).toEqual({ repo: 'b', branch: 'wt' })
  })

  it('foreground 의 cwd 를 모르거나 묻지 못하면 지금 cwd 로 다시 읽는다', async () => {
    const r = reader()
    const fg = foreground()
    let fail = false
    const ws = createWorkspaces(r.read, (id) =>
      fail ? Promise.reject(new Error('not running')) : fg.read(id)
    )
    ws.open()
    const p = selected(ws).panes[0]
    ws.setCwd(p.key, '/a')
    r.pending.length = 0

    ws.refreshSession(p.sessionId)
    expect(fg.asked).toHaveLength(1)
    expect(r.pending).toEqual([])
    await fg.answer(null)
    expect(selected(ws).panes[0].cwd).toBe('/a')
    expect(r.pending.map((x) => x.cwd)).toEqual(['/a'])

    fail = true
    r.pending.length = 0
    ws.refreshSession(p.sessionId)
    await new Promise((resolve) => setTimeout(resolve))
    expect(r.pending.map((x) => x.cwd)).toEqual(['/a'])
  })

  it('foreground 를 묻는 사이에 셸이 cwd 를 알려 오면 늦게 온 foreground 의 답은 버린다', async () => {
    const r = reader()
    const fg = foreground()
    const ws = createWorkspaces(r.read, fg.read)
    ws.open()
    const p = selected(ws).panes[0]
    ws.setCwd(p.key, '/a')
    ws.refreshSession(p.sessionId)
    expect(fg.asked.map((a) => a.sessionId)).toEqual([p.sessionId])
    ws.setCwd(p.key, '/prompt')
    r.pending.length = 0
    await fg.answer('/wt')
    expect(selected(ws).panes[0].cwd).toBe('/prompt')
    expect(r.pending).toEqual([])
  })

  it('refreshSession 이 겹치면 먼저 물은 답은 버리고 나중 답만 쓴다', async () => {
    const r = reader()
    const fg = foreground()
    const ws = createWorkspaces(r.read, fg.read)
    ws.open()
    const p = selected(ws).panes[0]
    ws.setCwd(p.key, '/a')
    r.pending.length = 0
    ws.refreshSession(p.sessionId)
    ws.refreshSession(p.sessionId)
    const [older, newer] = fg.asked
    newer.resolve('/second')
    await Promise.resolve()
    older.resolve('/first')
    await Promise.resolve()
    expect(selected(ws).panes[0].cwd).toBe('/second')
    expect(r.pending.map((x) => x.cwd)).toEqual(['/second'])
  })

  it('foreground 를 묻는 사이에 pane 이 닫히면 늦은 답은 아무것도 바꾸지 않는다', async () => {
    const r = reader()
    const fg = foreground()
    const ws = createWorkspaces(r.read, fg.read)
    ws.open()
    ws.split('right')
    const p = selected(ws).panes[1]
    ws.setCwd(p.key, '/a')
    r.pending.length = 0
    ws.refreshSession(p.sessionId)
    expect(fg.asked.map((a) => a.sessionId)).toEqual([p.sessionId])
    ws.closePane(p.key)
    const before = JSON.stringify(ws.list.value)
    await fg.answer('/wt')
    expect(JSON.stringify(ws.list.value)).toBe(before)
    expect(r.pending).toEqual([])
  })

  it('셸의 cwd 로 청한 git 읽기가 끝나기 전에 refreshSession 이 돌면 그 뒤 도착한 이전 git 답은 버린다', async () => {
    const r = reader()
    const fg = foreground()
    const ws = createWorkspaces(r.read, fg.read)
    ws.open()
    const p = selected(ws).panes[0]
    ws.setCwd(p.key, '/a')
    ws.refreshSession(p.sessionId)
    await fg.answer('/wt')
    await r.answer('/wt', { repo: 'a', branch: 'wt' })
    await r.answer('/a', { repo: 'a', branch: 'main' })
    expect(selected(ws).panes[0].git).toEqual({ repo: 'a', branch: 'wt' })
  })

  it('cwd 를 아직 모르는 pane 도 foreground 가 답하면 cwd 를 달고, 답이 없으면 읽지 않는다', async () => {
    const r = reader()
    const fg = foreground()
    const ws = createWorkspaces(r.read, fg.read)
    ws.open()
    const p = selected(ws).panes[0]
    ws.refreshSession(p.sessionId)
    await fg.answer(null)
    expect(selected(ws).panes[0].cwd).toBeUndefined()
    expect(r.pending).toEqual([])
    ws.refreshSession(p.sessionId)
    await fg.answer('/fresh')
    expect(selected(ws).panes[0].cwd).toBe('/fresh')
    expect(r.pending.map((x) => x.cwd)).toEqual(['/fresh'])
  })
})

describe('panes', () => {
  it('나누면 새 pane 이 포커스가 있던 pane 의 cwd 에서 시작하고 포커스를 받는다', () => {
    const ws = opened(1)
    const first = selected(ws).panes[0].key
    ws.setCwd(first, '/work')
    ws.split('right')
    const w = selected(ws)
    expect(w.panes).toHaveLength(2)
    const added = w.panes[1]
    expect(added.startDir).toBe('/work')
    expect(added.sessionId).not.toBe(w.panes[0].sessionId)
    expect(w.focused).toBe(added.key)
    expect(w.layout).toEqual({
      split: 'right',
      first: { pane: first },
      second: { pane: added.key }
    })
  })

  it('cwd 를 아직 모르는 pane 을 나누면 그 pane 의 시작 디렉토리에서 시작한다', () => {
    const ws = createWorkspaces()
    ws.open('/start')
    ws.split('down')
    expect(selected(ws).panes[1].startDir).toBe('/start')
  })

  it('full 로 나누면 부른 pane 의 workspace 전체를 나누고, 포커스와 선택은 그대로다', () => {
    const ws = opened(2)
    ws.select(keys(ws)[0])
    ws.split('down')
    const [first, second] = ws.list.value
    ws.select(second.key)
    const before = first.layout
    const focused = first.focused
    const pane = ws.splitFrom(first.panes[1].key, 'right', {}, true)
    expect(first.layout).toEqual({ split: 'right', first: before, second: { pane } })
    expect(first.focused).toBe(focused)
    expect(second.panes).toHaveLength(1)
    expect(ws.selectedKey.value).toBe(second.key)
  })

  it('선택된 workspace 만 나눈다', () => {
    const ws = opened(2)
    ws.select(keys(ws)[0])
    ws.split('down')
    expect(ws.list.value.map((w) => w.panes.length)).toEqual([2, 1])
  })

  it('포커스가 있는 pane 을 닫으면 형제 pane 이 자리와 포커스를 받는다', () => {
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

  it('포커스가 없는 pane 이 닫히면 포커스는 그대로다', () => {
    const ws = opened(1)
    const a = selected(ws).panes[0].key
    ws.split('right')
    const b = selected(ws).focused
    ws.closePane(a)
    expect(selected(ws).focused).toBe(b)
    expect(selected(ws).layout).toEqual({ pane: b })
  })

  it('보이지 않는 workspace 의 pane 이 닫혀도 선택은 그대로다', () => {
    const ws = opened(2)
    ws.select(keys(ws)[0])
    ws.split('right')
    const hidden = selected(ws).focused
    ws.select(keys(ws)[1])
    ws.closePane(hidden)
    expect(ws.selectedKey.value).toBe(keys(ws)[1])
    expect(ws.list.value[0].panes).toHaveLength(1)
  })

  it('없는 pane 을 닫거나 그 pane 에 값을 달아도 아무것도 바뀌지 않는다', () => {
    const ws = opened(1)
    const before = JSON.stringify(ws.list.value)
    ws.closePane(999)
    ws.setCwd(999, '/x')
    ws.setTitle(999, 'x')
    ws.refreshSession('s-x')
    ws.focusPane(999)
    expect(JSON.stringify(ws.list.value)).toBe(before)
  })

  it('focusPane 은 그 pane 의 workspace 에서 포커스를 옮긴다', () => {
    const ws = opened(1)
    const a = selected(ws).panes[0].key
    ws.split('right')
    ws.focusPane(a)
    expect(selected(ws).focused).toBe(a)
  })

  it('moveFocus 는 그 방향에 pane 이 있으면 옮기고 없으면 그대로 둔다', () => {
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

  it('focusedPane 은 포커스가 있는 pane 이다', () => {
    const ws = opened(1)
    ws.split('down')
    expect(focusedPane(selected(ws)).key).toBe(selected(ws).focused)
  })

  it('splitFrom 은 선택되지 않은 workspace 의 pane 도 나누고, 포커스와 선택은 그대로 둔다', () => {
    const ws = opened(2)
    const [first, second] = keys(ws)
    const from = ws.list.value[0].panes[0].key
    const pane = ws.splitFrom(from, 'down', { startDir: '/x', command: ['ls', '-l'] })
    const w = ws.list.value.find((w) => w.key === first)!
    expect(w.layout).toEqual({ split: 'down', first: { pane: from }, second: { pane } })
    expect(w.panes.at(-1)).toEqual({
      key: pane,
      sessionId: expect.any(String),
      startDir: '/x',
      command: ['ls', '-l']
    })
    expect(w.focused).toBe(from)
    expect(ws.selectedKey.value).toBe(second)
  })

  it('splitFrom 은 포커스가 없는 pane 을 나눈다', () => {
    const ws = opened(1)
    const a = selected(ws).focused
    ws.split('right')
    const b = selected(ws).focused
    ws.splitFrom(a, 'down', {})
    expect(selected(ws).layout).toEqual({
      split: 'right',
      first: { split: 'down', first: { pane: a }, second: { pane: expect.any(Number) } },
      second: { pane: b }
    })
    expect(selected(ws).focused).toBe(b)
  })

  it('세션 id 로 어느 workspace 의 pane 이든 찾는다', () => {
    const ws = opened(2)
    const hidden = ws.list.value[0].panes[0]
    expect(ws.paneBySession(hidden.sessionId)?.key).toBe(hidden.key)
    expect(ws.paneBySession('s-00000000')).toBeUndefined()
  })

  it('선택된 workspace 가 없으면 split·moveFocus 는 아무것도 바꾸지 않는다', () => {
    const ws = createWorkspaces()
    ws.split('right')
    ws.moveFocus('left')
    expect(ws.list.value).toEqual([])
  })

  it('보이지 않는 workspace 의 pane 에 포커스를 주어도 선택은 그대로다', () => {
    const ws = opened(2)
    const [first, second] = keys(ws)
    const hidden = ws.list.value[0].panes[0].key
    ws.focusPane(hidden)
    expect(ws.selectedKey.value).toBe(second)
    expect(ws.list.value.find((w) => w.key === first)!.focused).toBe(hidden)
  })

  it('step 은 다음·이전 workspace 를 주고, 끝에서는 반대쪽 끝으로 돈다', () => {
    const ws = opened(3)
    const [a, b, c] = keys(ws)
    ws.select(a)
    expect(ws.step(1)).toBe(b)
    expect(ws.step(-1)).toBe(c)
    ws.select(c)
    expect(ws.step(1)).toBe(a)
  })

  it('workspace 가 하나면 step 은 그것을 준다', () => {
    const ws = opened(1)
    expect(ws.step(1)).toBe(keys(ws)[0])
    expect(ws.step(-1)).toBe(keys(ws)[0])
  })

  it('workspace 가 없으면 step 은 아무것도 주지 않는다', () => {
    expect(createWorkspaces().step(1)).toBeUndefined()
  })
})

describe('openFrom', () => {
  function spawn(ws: Workspaces, from: number | undefined, init = {}): number {
    const pane = ws.openFrom(ws.list.value.find((w) => w.key === from)?.id, init)
    return ws.list.value.find((w) => w.panes.some((p) => p.key === pane))!.key
  }

  it('부른 workspace 바로 뒤에 pane 하나로 넣고, 선택과 포커스는 그대로다', () => {
    const ws = opened(3)
    const [w0, w1, w2] = keys(ws)
    ws.split('right')
    const before = { selected: ws.selectedKey.value, focused: selected(ws).focused }
    const a = spawn(ws, w0, { startDir: '/s', command: ['x'] })
    expect(keys(ws)).toEqual([w0, a, w1, w2])
    expect(ws.selectedKey.value).toBe(before.selected)
    expect(selected(ws).focused).toBe(before.focused)
    const added = ws.list.value[1]
    expect(added.panes).toHaveLength(1)
    expect(added.focused).toBe(added.panes[0].key)
    expect(added.panes[0]).toMatchObject({ startDir: '/s', command: ['x'] })
    expect(added.id).toMatch(/^w-[0-9a-f]{8}$/)
  })

  it('같은 workspace 에서 여러 번 띄우면 띄운 순서대로 놓인다', () => {
    const ws = opened(2)
    const [d, e] = keys(ws)
    const a = spawn(ws, d)
    const b = spawn(ws, d)
    const c = spawn(ws, d)
    expect(keys(ws)).toEqual([d, a, b, c, e])
  })

  const restarts: [string, (ws: Workspaces) => Workspaces][] = [
    ['', (ws) => ws],
    ['되살린 뒤에도 ', restarted]
  ]

  it.each(restarts)('%s앞서 띄운 것이 띄운 것도 건너뛴다', (_, through) => {
    const from = opened(2)
    const [d, e] = keys(from)
    const a = spawn(from, d)
    const a1 = spawn(from, a)
    const ws = through(from)
    const b = spawn(ws, d)
    const a2 = spawn(ws, a)
    expect(keys(ws)).toEqual([d, a, a1, a2, b, e])
  })

  it('앞서 띄운 것이 닫히면 남은 것 뒤에 넣는다', () => {
    const ws = opened(2)
    const [d, e] = keys(ws)
    const a = spawn(ws, d)
    const b = spawn(ws, d)
    ws.closePane(ws.list.value[1].panes[0].key)
    const c = spawn(ws, d)
    expect(keys(ws)).toEqual([d, b, c, e])
    expect(keys(ws)).not.toContain(a)
  })

  it.each(restarts)(
    '%s띄운 쪽이 닫혀도 그것이 띄운 것은 처음 부른 workspace 의 묶음에 남는다',
    (_, through) => {
      const from = opened(2)
      const [d, e] = keys(from)
      const a = spawn(from, d)
      const a1 = spawn(from, a)
      from.closePane(from.list.value[1].panes[0].key)
      const ws = through(from)
      const b = spawn(ws, d)
      expect(keys(ws)).toEqual([d, a1, b, e])
    }
  )

  it('부른 workspace 가 없거나 목록에 없으면 목록 끝에 붙이고 선택은 그대로다', () => {
    const ws = opened(2)
    const [w0, w1] = keys(ws)
    ws.select(w0)
    const a = spawn(ws, undefined)
    const b = ws.openFrom('w-gone', {})
    expect(keys(ws).slice(0, 3)).toEqual([w0, w1, a])
    expect(ws.list.value[3].panes[0].key).toBe(b)
    expect(ws.selectedKey.value).toBe(w0)
  })

  it('⌘N 으로 연 workspace 는 묶음에 들지 않는다', () => {
    const ws = opened(1)
    const [d] = keys(ws)
    const a = spawn(ws, d)
    ws.open()
    const e = keys(ws).at(-1)!
    const b = spawn(ws, d)
    expect(keys(ws)).toEqual([d, a, b, e])
  })

  it('되살린 뒤 띄운 쪽을 닫아도 그것이 띄운 것은 처음 부른 workspace 의 묶음에 남는다', () => {
    const from = opened(2)
    const [d, e] = keys(from)
    const a = spawn(from, d)
    const a1 = spawn(from, a)
    const ws = restarted(from)
    ws.closePane(ws.list.value[1].panes[0].key)
    const b = spawn(ws, d)
    expect(keys(restarted(ws))).toEqual([d, a1, b, e])
  })

  it('부른 workspace 를 적지 않은 화면을 되살리면 부른 workspace 바로 뒤에 넣는다', () => {
    const from = opened(1)
    const [d] = keys(from)
    const a = spawn(from, d)
    const screen = from.snapshot()
    for (const w of screen.workspaces) delete w.openedBy
    const ws = createWorkspaces()
    ws.restore(screen)
    const b = spawn(ws, d)
    expect(keys(ws)).toEqual([d, b, a])
  })

  it('아무도 부르지 않은 workspace 가 닫히면 그것이 띄운 것은 어느 묶음에도 들지 않는다', () => {
    const ws = opened(1)
    spawn(ws, keys(ws)[0])
    ws.closePane(ws.list.value[0].panes[0].key)
    expect(restarted(ws).list.value[0].openedBy).toBeUndefined()
  })
})
