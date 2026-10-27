import { describe, expect, it } from 'vitest'
import type { GitHead } from '../../../shared/git'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'
import { isPtyId } from '../../../shared/pty'
import type { PtyState } from '../../../shared/pty-state'
import { parseScreen, SCREEN_VERSION } from '../../../shared/screen'
import { createWorkspaces, focusedPane } from './store'

type Workspaces = ReturnType<typeof createWorkspaces>

const EMPTY: PtyState = {
  cwd: null,
  cwdReports: 0,
  title: null,
  foregroundCwd: null,
  command: null,
  records: []
}

function record(state: ProgramStatusState, message = ''): ProgramStatusRecord {
  return { id: '', state, kind: null, progress: null, app: 'claude-code', title: '', message }
}

/** main 이 보낸 상태를 흉내 낸다. `set` 은 그 pty 의 상태를 바꾼 뒤 store 에 알린다. `old` 는 이전 maru-pty 표시다. */
function source() {
  const states = new Map<string, PtyState>()
  const old = new Set<string>()
  return {
    get: (pty: string) => states.get(pty),
    state: (pty: string) => states.get(pty)?.records.find((r) => r.id === '')?.state,
    isOld: (pty: string) => old.has(pty),
    set(ws: Workspaces, pty: string, over: Partial<PtyState>): void {
      states.set(pty, { ...(states.get(pty) ?? EMPTY), ...over })
      ws.applyState(pty)
    },
    markOld(ws: Workspaces, pty: string): void {
      old.add(pty)
      ws.applyState(pty)
    },
    drop(ws: Workspaces, pty: string): void {
      states.delete(pty)
      ws.applyState(pty)
    }
  }
}

function opened(n: number) {
  const ws = createWorkspaces()
  for (let i = 0; i < n; i++) ws.open(`/d-${i}`)
  return ws
}

const keys = (ws: Workspaces) => ws.cells().map((c) => c.key)
const firstPanes = (ws: Workspaces) => ws.cells().map((c) => c.panes[0])
const wsKeys = (ws: Workspaces) => ws.list.value.map((w) => w.key)
const selected = (ws: Workspaces) => ws.selected()!

/** 재시작 전 pane 은 모두 pty 를 띄운 것으로 둔다 — 되살린 store 는 cwd 가 없는 pane 에 시작 디렉토리를 화면 cwd 로 단다. */
function restarted(from: Workspaces): Workspaces {
  for (const c of from.cells())
    for (const p of c.panes)
      if (p.cwd === undefined) from.setSpawnedCwd(p.key, p.startDir ?? '/home')
  const to = createWorkspaces()
  to.restore(from.snapshot())
  return to
}

describe('snapshot·restore', () => {
  function arranged(): Workspaces {
    const src = source()
    const ws = createWorkspaces(undefined, src)
    ws.open('/d-0')
    ws.open('/d-1')
    ws.split('down')
    const p = selected(ws).panes[1]
    src.set(ws, p.ptyId, { cwd: '/moved', cwdReports: 1, title: 'vim' })
    ws.setFontSize(selected(ws).key, 18)
    ws.setPaneCols(selected(ws).key, 110)
    ws.select(ws.cells()[0].key)
    return ws
  }

  it('되살린 store 는 workspace·cell·pane·배치·포커스·선택이 같다', () => {
    const from = arranged()
    const to = restarted(from)
    expect(to.snapshot()).toEqual(from.snapshot())
    expect(to.selected()!.key).toBe(from.selected()!.key)
    const pane = to.cells()[1].panes[1]
    expect([pane.cwd, pane.title]).toEqual(['/moved', 'vim'])
    expect(to.cells().map((w) => w.fontSize)).toEqual([undefined, 18])
    expect(to.cells().map((w) => w.paneCols)).toEqual([undefined, 110])
  })

  it('되살린 pane 은 pty 에 붙고, 스냅샷에는 붙기와 화면 cwd 의 재료를 싣지 않는다', () => {
    const to = restarted(arranged())
    to.setSpawnedCwd(to.cells()[0].panes[0].key, '/spawned')
    expect(to.cells().flatMap((w) => w.panes.map((p) => p.attach))).toEqual([true, true, true])
    for (const w of to.snapshot().workspaces)
      for (const c of w.cells)
        for (const p of c.panes)
          for (const k of ['attach', 'restoredCwd', 'spawnedCwd'])
            expect(Object.keys(p)).not.toContain(k)
  })

  it('스냅샷은 git 을 싣고, 되살린 store 는 저장한 cwd 의 git 을 다시 읽는다', async () => {
    const from = createWorkspaces(async () => ({ repo: 'r', branch: 'old' }))
    from.open('/r')
    from.setSpawnedCwd(selected(from).panes[0].key, '/r')
    await new Promise((resolve) => setTimeout(resolve))
    const saved = from.snapshot()
    expect(saved.workspaces[0].cells[0].panes[0].git).toEqual({ repo: 'r', branch: 'old' })
    const read: string[] = []
    const to = createWorkspaces(async (cwd) => {
      read.push(cwd)
      return { repo: 'r', branch: 'new' }
    })
    to.restore(saved)
    expect(selected(to).panes[0].git).toEqual({ repo: 'r', branch: 'old' })
    await new Promise((resolve) => setTimeout(resolve))
    expect(read).toEqual(['/r'])
    expect(selected(to).panes[0].git).toEqual({ repo: 'r', branch: 'new' })
  })

  it('되살리기 전에 main 의 상태가 왔으면 되살린 pane 에 그 상태를 쓴다', () => {
    const src = source()
    const from = arranged()
    const to = createWorkspaces(undefined, src)
    const pty = from.cells()[1].panes[1].ptyId
    src.set(to, pty, { cwd: '/now', cwdReports: 4, title: null })
    to.restore(from.snapshot())
    const pane = to.cells()[1].panes[1]
    expect([pane.cwd, pane.title]).toEqual(['/now', undefined])
  })

  it('되살린 뒤 새로 연 workspace·cell·pane 의 key 가 겹치지 않고 새 pane 은 pty 를 띄운다', () => {
    const to = restarted(arranged())
    to.open()
    to.openCell()
    to.split('right')
    const all = to.list.value.flatMap((w) => [
      w.key,
      ...w.cells.flatMap((c) => [c.key, ...c.panes.map((p) => p.key)])
    ])
    expect(new Set(all).size).toBe(all.length)
    expect(selected(to).panes.map((p) => p.attach)).toEqual([undefined, undefined])
  })

  it('cell 둘인 workspace 도 같은 모양으로 되살린다', () => {
    const from = opened(2)
    from.openCell('/x')
    const to = restarted(from)
    expect(to.snapshot()).toEqual(from.snapshot())
    expect(to.list.value.map((w) => w.cells.length)).toEqual([1, 2])
  })
})

describe('workspaces', () => {
  it('pane 을 만들 때마다 그 pty 의 id 를 새로 정한다', () => {
    let n = 0
    const ws = createWorkspaces(undefined, undefined, () => `p-${++n}`)
    ws.open()
    ws.split('right')
    ws.splitFrom(selected(ws).panes[0].key, 'down', {})
    ws.open()
    expect(ws.cells().flatMap((w) => w.panes.map((p) => p.ptyId))).toEqual([
      'p-1',
      'p-2',
      'p-3',
      'p-4'
    ])
  })

  it('기본 pty id 는 pty id 모양이고 pane 마다 다르다', () => {
    const ws = opened(2)
    const [a, b] = firstPanes(ws).map((p) => p.ptyId)
    expect(isPtyId(a) && isPtyId(b)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('cell·workspace 를 열 때마다 id 를 새로 정하고, 나눈 pane 은 cell 의 id 를 바꾸지 않는다', () => {
    let c = 0
    let w = 0
    const ws = createWorkspaces(
      undefined,
      undefined,
      undefined,
      () => `c-${++c}`,
      () => `w-${++w}`
    )
    ws.open()
    ws.split('right')
    ws.openCell()
    ws.open()
    expect(ws.cells().map((x) => x.id)).toEqual(['c-1', 'c-2', 'c-3'])
    expect(ws.list.value.map((x) => x.id)).toEqual(['w-1', 'w-2'])
  })

  it('기본 cell id 는 c- 뒤에 16진 8자리이고, workspace id 는 w- 뒤에 16진 8자리다', () => {
    const ws = opened(2)
    const [a, b] = ws.cells().map((c) => c.id)
    expect(a).toMatch(/^c-[0-9a-f]{8}$/)
    expect(b).toMatch(/^c-[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
    const [x, y] = ws.list.value.map((w) => w.id)
    expect(x).toMatch(/^w-[0-9a-f]{8}$/)
    expect(y).toMatch(/^w-[0-9a-f]{8}$/)
    expect(x).not.toBe(y)
  })

  it('open 은 새 workspace 를 끝에 만들어 그 cell 을 선택한다', () => {
    const ws = opened(1)
    ws.openCell()
    ws.open('/n')
    expect(ws.list.value.map((w) => w.cells.length)).toEqual([2, 1])
    expect(selected(ws).panes[0].startDir).toBe('/n')
    expect(ws.workspaceOf(selected(ws).key)?.key).toBe(wsKeys(ws)[1])
  })

  it('openCell 은 선택한 cell 바로 뒤에 cell 을 더해 선택하고, 선택이 없으면 새 workspace 다', () => {
    const ws = opened(2)
    const [c0, c1] = keys(ws)
    ws.select(c0)
    ws.openCell('/a')
    const a = selected(ws)
    expect(a.panes[0].startDir).toBe('/a')
    ws.select(c0)
    ws.openCell()
    const b = ws.selectedKey.value
    expect(keys(ws)).toEqual([c0, b, a.key, c1])
    expect(ws.list.value.map((w) => w.cells.length)).toEqual([3, 1])

    const empty = createWorkspaces()
    empty.openCell('/e')
    expect(empty.list.value).toHaveLength(1)
    expect(selected(empty).panes[0].startDir).toBe('/e')
  })

  it('workspace 의 마지막 cell 이 닫히면 workspace 도 닫고 편 목록의 다음(없으면 앞) cell 을 선택한다', () => {
    const ws = opened(2)
    const [first, second] = keys(ws)
    ws.select(second)
    ws.openCell()
    const third = ws.selectedKey.value!
    ws.select(first)
    ws.closePane(firstPanes(ws)[0].key)
    expect(ws.list.value).toHaveLength(1)
    expect(ws.selectedKey.value).toBe(second)
    ws.select(third)
    ws.closePane(firstPanes(ws)[1].key)
    expect(ws.list.value).toHaveLength(1)
    expect(ws.selectedKey.value).toBe(second)
  })

  it('cell 이 닫혀도 같은 workspace 에 cell 이 남으면 workspace 는 남는다', () => {
    const ws = opened(1)
    ws.openCell()
    const w = ws.list.value[0].key
    ws.closePane(firstPanes(ws)[1].key)
    expect(wsKeys(ws)).toEqual([w])
    expect(keys(ws)).toHaveLength(1)
  })

  it('step 은 workspace 경계를 넘어 편 순서대로 돈다', () => {
    const ws = opened(2)
    const [c0, c1] = keys(ws)
    ws.select(c0)
    ws.openCell()
    const a = ws.selectedKey.value!
    expect(ws.step(1)).toBe(c1)
    ws.select(c1)
    expect(ws.step(1)).toBe(c0)
    expect(ws.step(-1)).toBe(a)
  })

  it('연 cell 은 pane 하나로 목록 끝에 붙고 선택된다', () => {
    const ws = opened(2)
    ws.open()
    expect(firstPanes(ws).map((p) => p.startDir)).toEqual(['/d-0', '/d-1', undefined])
    expect(ws.selectedKey.value).toBe(keys(ws)[2])
    expect(selected(ws).panes).toHaveLength(1)
    expect(selected(ws).focused).toBe(selected(ws).panes[0].key)
  })

  it('선택한 cell 의 마지막 pane 이 닫히면 cell 도 닫고 바로 아래 것을 선택한다', () => {
    const ws = opened(3)
    const [, middle, last] = keys(ws)
    ws.select(middle)
    ws.closePane(firstPanes(ws)[1].key)
    expect(keys(ws)).not.toContain(middle)
    expect(ws.selectedKey.value).toBe(last)
  })

  it('맨 아래의 선택한 cell 이 닫히면 바로 위 것을 선택한다', () => {
    const ws = opened(3)
    const [, middle] = keys(ws)
    ws.closePane(firstPanes(ws)[2].key)
    expect(ws.selectedKey.value).toBe(middle)
  })

  it('선택하지 않은 cell 이 닫히면 선택은 그대로다', () => {
    const ws = opened(3)
    const [, , last] = keys(ws)
    ws.closePane(firstPanes(ws)[0].key)
    expect(ws.selectedKey.value).toBe(last)
  })

  it('마지막 cell 이 닫히면 workspace 도 없어지고 아무것도 선택하지 않는다', () => {
    const ws = opened(1)
    ws.closePane(firstPanes(ws)[0].key)
    expect(ws.cells()).toEqual([])
    expect(ws.list.value).toEqual([])
    expect(ws.selectedKey.value).toBeNull()
    expect(ws.selected()).toBeUndefined()
  })

  it('화면 cwd 는 foreground cwd, 셸 cwd, 띄운 디렉토리, 시작 디렉토리 순서로 고르고, 상태가 바뀌기 전에는 비어 있다', () => {
    const src = source()
    const ws = createWorkspaces(undefined, src)
    ws.open('/a')
    const pane = () => firstPanes(ws)[0]
    expect(pane().startDir).toBe('/a')
    expect(pane().cwd).toBeUndefined()
    src.set(ws, pane().ptyId, {})
    expect(pane().cwd).toBe('/a')
    ws.setSpawnedCwd(pane().key, '/home')
    expect(pane().cwd).toBe('/home')
    src.set(ws, pane().ptyId, { cwd: '/shell', cwdReports: 1 })
    expect(pane().cwd).toBe('/shell')
    src.set(ws, pane().ptyId, { foregroundCwd: '/fg' })
    expect(pane().cwd).toBe('/fg')
    src.set(ws, pane().ptyId, { foregroundCwd: null, cwd: null })
    expect(pane().cwd).toBe('/home')
  })

  it('되살린 pane 은 상태가 오기 전과 셸 cwd 가 없을 때 되살린 cwd 를 띄운 디렉토리보다 먼저 쓴다', () => {
    const src = source()
    const from = createWorkspaces(undefined, src)
    from.open('/start')
    src.set(from, selected(from).panes[0].ptyId, { cwd: '/saved', cwdReports: 1 })
    const to = createWorkspaces(undefined, src)
    const saved = from.snapshot()
    src.drop(from, selected(from).panes[0].ptyId)
    to.restore(saved)
    const pane = () => selected(to).panes[0]
    expect(pane().cwd).toBe('/saved')
    to.setSpawnedCwd(pane().key, '/spawned')
    expect(pane().cwd).toBe('/saved')
    src.set(to, pane().ptyId, { cwd: '/live', cwdReports: 1 })
    expect(pane().cwd).toBe('/live')
    src.set(to, pane().ptyId, { cwd: null })
    expect(pane().cwd).toBe('/saved')
  })

  it('setFontSize 는 그 cell 의 글꼴 크기만 바꾸고, undefined 면 지운다', () => {
    const ws = opened(2)
    const [a] = keys(ws)
    ws.setFontSize(a, 16)
    expect(ws.cells().map((w) => w.fontSize)).toEqual([16, undefined])
    ws.setFontSize(a, undefined)
    ws.setFontSize(-1, 20)
    expect(ws.cells().map((w) => w.fontSize)).toEqual([undefined, undefined])
  })

  it('나눈 pane 과 새로 연 cell 은 글꼴 크기를 바꾸지 않는다', () => {
    const ws = opened(1)
    ws.setFontSize(selected(ws).key, 20)
    ws.split('right')
    expect(selected(ws).fontSize).toBe(20)
    ws.open()
    ws.openCellFrom(ws.cells()[0].id, {})
    expect(ws.cells().map((w) => w.fontSize)).toEqual([20, undefined, undefined])
  })

  it('setPaneCols 는 그 cell 의 pane 폭만 바꾸고, undefined 면 지운다', () => {
    const ws = opened(2)
    ws.setPaneCols(selected(ws).key, 110)
    expect(ws.cells().map((w) => w.paneCols)).toEqual([undefined, 110])
    ws.setPaneCols(selected(ws).key, undefined)
    expect(ws.cells().map((w) => 'paneCols' in w)).toEqual([false, false])
  })

  it('나눈 pane 과 새로 연 cell 은 pane 폭을 바꾸거나 물려받지 않는다', () => {
    const ws = opened(1)
    ws.setPaneCols(selected(ws).key, 144)
    ws.split('right')
    expect(selected(ws).paneCols).toBe(144)
    ws.openCellFrom(selected(ws).id, {})
    ws.open()
    expect(ws.cells().map((w) => w.paneCols)).toEqual([144, undefined, undefined])
  })

  it('제목은 그 pane 의 상태를 따르고, null 이면 지운다', () => {
    const src = source()
    const ws = createWorkspaces(undefined, src)
    ws.open()
    ws.split('right')
    const p = selected(ws).panes[1]
    src.set(ws, p.ptyId, { title: 'task' })
    expect(selected(ws).panes.map((x) => x.title)).toEqual([undefined, 'task'])
    src.set(ws, p.ptyId, { title: null })
    expect(selected(ws).panes.map((x) => x.title)).toEqual([undefined, undefined])
  })

  it('되살린 제목은 상태가 오기 전까지 두고, 이전 maru-pty 의 pty 면 지운다', () => {
    const src = source()
    const from = createWorkspaces(undefined, src)
    from.open()
    src.set(from, selected(from).panes[0].ptyId, { title: 'kept' })
    const to = createWorkspaces(undefined, src)
    const saved = from.snapshot()
    src.drop(from, selected(from).panes[0].ptyId)
    to.restore(saved)
    expect(selected(to).panes[0].title).toBe('kept')
    src.markOld(to, selected(to).panes[0].ptyId)
    expect(selected(to).panes[0].title).toBeUndefined()
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

  function setup(read: (cwd: string) => Promise<GitHead | null>) {
    const src = source()
    const ws = createWorkspaces(read, src)
    ws.open()
    const p = selected(ws).panes[0]
    const report = (over: Partial<PtyState> = {}) => src.set(ws, p.ptyId, over)
    return { ws, src, p, report }
  }

  it('cwd 를 받으면 그 디렉토리의 저장소를 읽고, 늦게 온 이전 디렉토리의 답은 버린다', async () => {
    const r = reader()
    const { ws, report } = setup(r.read)
    report({ cwd: '/a', cwdReports: 1 })
    report({ cwd: '/b', cwdReports: 2 })
    await r.answer('/b', { repo: 'b', branch: 'main' })
    await r.answer('/a', { repo: 'a', branch: 'old' })
    expect(selected(ws).panes[0].git).toEqual({ repo: 'b', branch: 'main' })
    report({ cwd: '/c', cwdReports: 3 })
    await r.answer('/c', null)
    expect(selected(ws).panes[0].git).toBeUndefined()
  })

  it('셸이 같은 디렉토리를 다시 보고하면 다시 읽고, 답이 거꾸로 와도 나중에 청한 답이 남는다', async () => {
    const r = reader()
    const { ws, report } = setup(r.read)
    report({ cwd: '/a', cwdReports: 1 })
    report({ cwd: '/a', cwdReports: 2 })
    const [older, newer] = r.pending
    expect(r.pending.map((p) => p.cwd)).toEqual(['/a', '/a'])
    newer.resolve({ repo: 'a', branch: 'feat' })
    await Promise.resolve()
    older.resolve({ repo: 'a', branch: 'main' })
    await Promise.resolve()
    expect(selected(ws).panes[0].git).toEqual({ repo: 'a', branch: 'feat' })
  })

  it('제목이나 레코드의 메시지만 바뀐 상태로는 읽지 않고, 루트 레코드의 상태가 바뀌면 읽는다', async () => {
    const r = reader()
    const { report } = setup(r.read)
    report({ cwd: '/a', cwdReports: 1 })
    r.pending.length = 0
    report({ title: 'vim' })
    report({ records: [record('working', 'a')] })
    expect(r.pending.map((p) => p.cwd)).toEqual(['/a'])
    report({ records: [record('working', 'b')] })
    expect(r.pending).toHaveLength(1)
    report({ records: [record('blocked', 'b')] })
    expect(r.pending).toHaveLength(2)
  })

  it('저장소와 branch 가 그대로면 값을 바꾸지 않는다', async () => {
    const r = reader()
    const { ws, report } = setup(r.read)
    report({ cwd: '/a', cwdReports: 1 })
    await r.answer('/a', { repo: 'a', branch: 'main' })
    const before = selected(ws).panes[0].git
    report({ cwd: '/a', cwdReports: 2 })
    await r.answer('/a', { repo: 'a', branch: 'main' })
    expect(selected(ws).panes[0].git).toBe(before)
  })

  it('다른 디렉토리로 옮긴 뒤 읽지 못하면 이전 저장소를 남기지 않고, 읽는 사이 닫힌 pane 의 답은 버린다', async () => {
    const r = reader()
    let fail = false
    const { ws, src, p, report } = setup((cwd) =>
      fail ? Promise.reject(new Error('x')) : r.read(cwd)
    )
    report({ cwd: '/a', cwdReports: 1 })
    await r.answer('/a', { repo: 'a', branch: 'main' })
    fail = true
    report({ cwd: '/tmp', cwdReports: 2 })
    await new Promise((resolve) => setTimeout(resolve))
    expect(selected(ws).panes[0].git).toBeUndefined()

    fail = false
    ws.split('right')
    const other = selected(ws).panes[1]
    src.set(ws, other.ptyId, { cwd: '/b', cwdReports: 1 })
    ws.closePane(other.key)
    await r.answer('/b', { repo: 'b', branch: 'main' })
    expect(selected(ws).panes.map((x) => x.key)).toEqual([p.key])
  })

  it('foreground 의 cwd 가 있으면 그 디렉토리로 옮기고 그 저장소를 읽으며, 없어지면 셸의 cwd 로 돌아온다', async () => {
    const r = reader()
    const { ws, report } = setup(r.read)
    report({ cwd: '/a', cwdReports: 1, records: [record('working')] })
    r.pending.length = 0
    report({ foregroundCwd: '/wt' })
    expect(selected(ws).panes[0].cwd).toBe('/wt')
    expect(r.pending.map((p) => p.cwd)).toEqual(['/wt'])
    await r.answer('/wt', { repo: 'a', branch: 'wt' })
    expect(selected(ws).panes[0].git).toEqual({ repo: 'a', branch: 'wt' })
    report({ foregroundCwd: null, records: [] })
    expect(selected(ws).panes[0].cwd).toBe('/a')
    expect(r.pending.map((p) => p.cwd)).toEqual(['/wt', '/a'])
  })
})

describe('panes', () => {
  it('나누면 새 pane 이 포커스가 있던 pane 의 cwd 에서 시작하고 포커스를 받는다', () => {
    const src = source()
    const ws = createWorkspaces(undefined, src)
    ws.open()
    const first = selected(ws).panes[0].key
    src.set(ws, selected(ws).panes[0].ptyId, { cwd: '/work', cwdReports: 1 })
    ws.split('right')
    const w = selected(ws)
    expect(w.panes).toHaveLength(2)
    const added = w.panes[1]
    expect(added.startDir).toBe('/work')
    expect(added.ptyId).not.toBe(w.panes[0].ptyId)
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

  it('full 로 나누면 부른 pane 의 cell 전체를 나누고, 포커스와 선택은 그대로다', () => {
    const ws = opened(2)
    ws.select(keys(ws)[0])
    ws.split('down')
    const [first, second] = ws.cells()
    ws.select(second.key)
    const before = first.layout
    const focused = first.focused
    const pane = ws.splitFrom(first.panes[1].key, 'right', {}, true)
    expect(first.layout).toEqual({ split: 'right', first: before, second: { pane } })
    expect(first.focused).toBe(focused)
    expect(second.panes).toHaveLength(1)
    expect(ws.selectedKey.value).toBe(second.key)
  })

  it('선택된 cell 만 나눈다', () => {
    const ws = opened(2)
    ws.select(keys(ws)[0])
    ws.split('down')
    expect(ws.cells().map((w) => w.panes.length)).toEqual([2, 1])
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

  it('보이지 않는 cell 의 pane 이 닫혀도 선택은 그대로다', () => {
    const ws = opened(2)
    ws.select(keys(ws)[0])
    ws.split('right')
    const hidden = selected(ws).focused
    ws.select(keys(ws)[1])
    ws.closePane(hidden)
    expect(ws.selectedKey.value).toBe(keys(ws)[1])
    expect(ws.cells()[0].panes).toHaveLength(1)
  })

  it('없는 pane 을 닫거나 그 pane 에 값을 달아도 아무것도 바뀌지 않는다', () => {
    const ws = opened(1)
    const before = JSON.stringify(ws.cells())
    ws.closePane(999)
    ws.setSpawnedCwd(999, '/x')
    ws.applyState('p-x')
    ws.focusPane(999)
    expect(JSON.stringify(ws.cells())).toBe(before)
  })

  it('focusPane 은 그 pane 의 cell 에서 포커스를 옮긴다', () => {
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

  it('splitFrom 은 선택되지 않은 cell 의 pane 도 나누고, 포커스와 선택은 그대로 둔다', () => {
    const ws = opened(2)
    const [first, second] = keys(ws)
    const from = ws.cells()[0].panes[0].key
    const pane = ws.splitFrom(from, 'down', { startDir: '/x', command: ['ls', '-l'] })
    const w = ws.cells().find((w) => w.key === first)!
    expect(w.layout).toEqual({ split: 'down', first: { pane: from }, second: { pane } })
    expect(w.panes.at(-1)).toEqual({
      key: pane,
      ptyId: expect.any(String),
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

  it('pty id 로 어느 cell 의 pane 이든 찾는다', () => {
    const ws = opened(2)
    const hidden = ws.cells()[0].panes[0]
    expect(ws.paneByPty(hidden.ptyId)?.key).toBe(hidden.key)
    expect(ws.paneByPty('p-00000000')).toBeUndefined()
  })

  it('선택된 cell 이 없으면 split·moveFocus 는 아무것도 바꾸지 않는다', () => {
    const ws = createWorkspaces()
    ws.split('right')
    ws.moveFocus('left')
    expect(ws.cells()).toEqual([])
  })

  it('보이지 않는 cell 의 pane 에 포커스를 주어도 선택은 그대로다', () => {
    const ws = opened(2)
    const [first, second] = keys(ws)
    const hidden = ws.cells()[0].panes[0].key
    ws.focusPane(hidden)
    expect(ws.selectedKey.value).toBe(second)
    expect(ws.cells().find((w) => w.key === first)!.focused).toBe(hidden)
  })

  it('step 은 다음·이전 cell 을 주고, 끝에서는 반대쪽 끝으로 돈다', () => {
    const ws = opened(3)
    const [a, b, c] = keys(ws)
    ws.select(a)
    expect(ws.step(1)).toBe(b)
    expect(ws.step(-1)).toBe(c)
    ws.select(c)
    expect(ws.step(1)).toBe(a)
  })

  it('cell 이 하나면 step 은 그것을 준다', () => {
    const ws = opened(1)
    expect(ws.step(1)).toBe(keys(ws)[0])
    expect(ws.step(-1)).toBe(keys(ws)[0])
  })

  it('cell 이 없으면 step 은 아무것도 주지 않는다', () => {
    expect(createWorkspaces().step(1)).toBeUndefined()
  })
})

describe('openCellFrom', () => {
  const idOf = (ws: Workspaces, key: number | undefined) =>
    ws.cells().find((c) => c.key === key)?.id

  function spawn(
    ws: Workspaces,
    from: number | undefined,
    init = {},
    place?: { cell: number; before: boolean }
  ): number | undefined {
    const pane = ws.openCellFrom(
      idOf(ws, from),
      init,
      place && { cell: idOf(ws, place.cell) ?? 'c-gone', before: place.before }
    )
    return ws.cells().find((w) => w.panes.some((p) => p.key === pane))?.key
  }

  it('부른 cell 바로 뒤에 pane 하나로 넣고, 선택과 포커스는 그대로다', () => {
    const ws = opened(3)
    const [w0, w1, w2] = keys(ws)
    ws.split('right')
    const before = { selected: ws.selectedKey.value, focused: selected(ws).focused }
    const a = spawn(ws, w0, { startDir: '/s', command: ['x'] })
    expect(keys(ws)).toEqual([w0, a, w1, w2])
    expect(ws.selectedKey.value).toBe(before.selected)
    expect(selected(ws).focused).toBe(before.focused)
    const added = ws.cells()[1]
    expect(added.panes).toHaveLength(1)
    expect(added.focused).toBe(added.panes[0].key)
    expect(added.panes[0]).toMatchObject({ startDir: '/s', command: ['x'] })
    expect(added.id).toMatch(/^c-[0-9a-f]{8}$/)
    expect(ws.list.value).toHaveLength(3)
    expect(ws.list.value[0].cells.map((c) => c.key)).toEqual([w0, a])
  })

  it('같은 cell 에서 여러 번 띄우면 늘 부른 cell 바로 뒤라, 나중에 띄운 것이 앞에 놓인다', () => {
    const ws = opened(2)
    const [d, e] = keys(ws)
    const a = spawn(ws, d)
    const b = spawn(ws, d)
    const c = spawn(ws, d)
    expect(keys(ws)).toEqual([d, c, b, a, e])
  })

  it('띄운 cell 이 다시 띄운 것은 그 cell 바로 뒤에 놓인다', () => {
    const ws = opened(1)
    const [d] = keys(ws)
    const a = spawn(ws, d)
    const b = spawn(ws, d)
    const a1 = spawn(ws, a)
    expect(keys(ws)).toEqual([d, b, a, a1])
  })

  describe('place', () => {
    function arranged() {
      const ws = opened(2)
      const [d, o] = keys(ws)
      const y = spawn(ws, d)!
      const x = spawn(ws, d)!
      return { ws, d, x, y, o }
    }
    const after = (cell: number) => ({ cell, before: false })
    const before = (cell: number) => ({ cell, before: true })

    it('가리킨 cell 바로 뒤나 바로 앞에 넣고, 선택은 그대로다', () => {
      const { ws, d, x, y, o } = arranged()
      ws.select(d)
      const a = spawn(ws, d, {}, after(x))
      expect(keys(ws)).toEqual([d, x, a, y, o])
      const b = spawn(ws, d, {}, before(x))
      expect(keys(ws)).toEqual([d, b, x, a, y, o])
      const first = spawn(ws, x, {}, before(d))
      expect(keys(ws)[0]).toBe(first)
      expect(ws.selectedKey.value).toBe(d)
    })

    it('부른 cell 자신의 뒤를 가리키면 옵션이 없을 때와 같다', () => {
      const { ws, d, x } = arranged()
      const a = spawn(ws, d, {}, after(d))
      expect(keys(ws).slice(0, 3)).toEqual([d, a, x])
    })

    it('가리킨 cell 이 다른 workspace 에 있거나, 부른 cell 이나 가리킨 cell 을 모르면 넣지 않는다', () => {
      const { ws, d, o } = arranged()
      const was = keys(ws)
      expect(spawn(ws, d, {}, after(o))).toBeUndefined()
      expect(spawn(ws, o, {}, before(d))).toBeUndefined()
      expect(spawn(ws, undefined, {}, after(d))).toBeUndefined()
      expect(spawn(ws, -1, {}, after(d))).toBeUndefined()
      expect(spawn(ws, d, {}, after(-1))).toBeUndefined()
      expect(keys(ws)).toEqual(was)
    })

    it('옮긴 뒤에는 옮긴 자리를 기준으로 넣는다', () => {
      const { ws, d, x, y, o } = arranged()
      ws.moveCell(y, { workspace: wsKeys(ws)[0], index: 0 })
      const a = spawn(ws, d, {}, after(y))
      expect(keys(ws)).toEqual([y, a, d, x, o])
    })
  })

  it('부른 cell 이 없거나 목록에 없으면 새 workspace 를 목록 끝에 만들고 선택은 그대로다', () => {
    const ws = opened(2)
    const [w0, w1] = keys(ws)
    ws.select(w0)
    const a = spawn(ws, undefined)
    const b = ws.openCellFrom('c-gone', {})
    expect(keys(ws).slice(0, 3)).toEqual([w0, w1, a])
    expect(ws.cells()[3].panes[0].key).toBe(b)
    expect(ws.list.value.map((w) => w.cells.length)).toEqual([1, 1, 1, 1])
    expect(ws.selectedKey.value).toBe(w0)
  })

  it('⌘N 으로 연 workspace 는 부른 cell 의 workspace 에 들지 않는다', () => {
    const ws = opened(1)
    const [d] = keys(ws)
    const a = spawn(ws, d)
    ws.open()
    const e = keys(ws).at(-1)!
    const b = spawn(ws, d)
    expect(keys(ws)).toEqual([d, b, a, e])
    expect(ws.list.value.map((w) => w.cells.length)).toEqual([3, 1])
  })

  it('옛 빌드가 openedBy 를 쓴 화면을 되살려도 부른 cell 바로 뒤에 넣고, 다음 snapshot 에 openedBy 가 없다', () => {
    const from = opened(1)
    const [d] = keys(from)
    const a = spawn(from, d)
    const old = {
      ...from.snapshot(),
      version: SCREEN_VERSION,
      sidebar: { open: true, width: 282, folded: [] },
      viewMode: 'single'
    }
    Object.assign(old.workspaces[0].cells[1], { openedBy: d })
    const ws = createWorkspaces()
    ws.restore(parseScreen(old)!)
    const b = spawn(ws, d)
    expect(keys(ws)).toEqual([d, b, a])
    expect(JSON.stringify(ws.snapshot())).not.toContain('openedBy')
  })
})

describe('moveCell·moveWorkspace', () => {
  /** workspace 셋에 cell 을 [2, 1, 2] 개씩 둔다. */
  function arranged() {
    const ws = opened(3)
    ws.select(ws.cells()[0].key)
    ws.openCell()
    ws.select(ws.cells()[3].key)
    ws.openCell()
    return ws
  }
  const shape = (ws: Workspaces) => ws.list.value.map((w) => w.cells.map((c) => c.key))

  it('같은 workspace 안에서 뒤로·앞으로 옮기고, 자리는 옮기기 전 목록의 틈으로 센다', () => {
    const ws = opened(1)
    for (let i = 0; i < 3; i++) ws.openCell()
    const [a, b, c, d] = keys(ws)
    const w = wsKeys(ws)[0]
    ws.moveCell(a, { workspace: w, index: 3 })
    expect(keys(ws)).toEqual([b, c, a, d])
    ws.moveCell(d, { workspace: w, index: 0 })
    expect(keys(ws)).toEqual([d, b, c, a])
    ws.moveCell(b, { workspace: w, index: 4 })
    expect(keys(ws)).toEqual([d, c, a, b])
  })

  it('제자리 앞뒤의 틈으로 옮기면 순서가 그대로다', () => {
    const ws = opened(1)
    ws.openCell()
    ws.openCell()
    const before = keys(ws)
    const w = wsKeys(ws)[0]
    ws.moveCell(before[1], { workspace: w, index: 1 })
    ws.moveCell(before[1], { workspace: w, index: 2 })
    expect(keys(ws)).toEqual(before)
  })

  it('다른 workspace 의 앞·가운데·끝으로 옮긴다', () => {
    const ws = arranged()
    const [[a, b], [c], [d, e]] = shape(ws)
    const [w0, , w2] = wsKeys(ws)
    ws.moveCell(c, { workspace: w2, index: 1 })
    expect(shape(ws)).toEqual([
      [a, b],
      [d, c, e]
    ])
    ws.moveCell(e, { workspace: w0, index: 0 })
    ws.moveCell(d, { workspace: w0, index: 3 })
    expect(shape(ws)).toEqual([[e, a, b, d], [c]])
  })

  it('마지막 cell 이 빠진 workspace 는 닫히고, 남은 workspace 의 id 는 그대로다', () => {
    const ws = arranged()
    const [[a, b], [c], [d, e]] = shape(ws)
    const ids = ws.list.value.map((w) => w.id)
    ws.moveCell(c, { workspace: wsKeys(ws)[2], index: 0 })
    expect(shape(ws)).toEqual([
      [a, b],
      [c, d, e]
    ])
    expect(ws.list.value.map((w) => w.id)).toEqual([ids[0], ids[2]])
  })

  it("'new' 는 그 cell 하나로 된 workspace 를 목록 끝에 새 id 로 만든다", () => {
    const ws = arranged()
    const [[a, b], [c], [d, e]] = shape(ws)
    const ids = ws.list.value.map((w) => w.id)
    ws.moveCell(a, 'new')
    expect(shape(ws)).toEqual([[b], [c], [d, e], [a]])
    expect(ws.list.value.slice(0, 3).map((w) => w.id)).toEqual(ids)
    expect(ws.list.value[3].id).toMatch(/^w-[0-9a-f]{8}$/)
    expect(ids).not.toContain(ws.list.value[3].id)
  })

  it("혼자인 cell 을 'new' 로 옮기면 그 workspace 를 id 그대로 목록 끝으로 옮긴다", () => {
    const ws = arranged()
    const [[a, b], [c], [d, e]] = shape(ws)
    const id = ws.list.value[1].id
    ws.moveCell(c, 'new')
    expect(shape(ws)).toEqual([[a, b], [d, e], [c]])
    expect(ws.list.value[2].id).toBe(id)
  })

  it('옮겨도 선택·포커스는 그대로이고, step 은 옮긴 순서를 따른다', () => {
    const ws = arranged()
    const [[a, b], [c], [d, e]] = shape(ws)
    ws.select(b)
    ws.split('right')
    const focused = selected(ws).focused
    ws.moveCell(b, { workspace: wsKeys(ws)[2], index: 2 })
    expect(ws.selectedKey.value).toBe(b)
    expect(selected(ws).focused).toBe(focused)
    expect(keys(ws)).toEqual([a, c, d, e, b])
    expect(ws.step(1)).toBe(a)
    expect(ws.step(-1)).toBe(e)
  })

  it('옮긴 순서는 snapshot 에 실리고 되살려도 남는다', () => {
    const ws = arranged()
    const [[a]] = shape(ws)
    ws.moveCell(a, { workspace: wsKeys(ws)[2], index: 1 })
    ws.moveWorkspace(wsKeys(ws)[2], 0)
    expect(shape(restarted(ws))).toEqual(shape(ws))
    expect(shape(ws)[0]).toContain(a)
  })

  it('moveWorkspace 는 workspace 를 뒤로·앞으로·끝으로 옮기고, 제자리 앞뒤의 틈이면 그대로다', () => {
    const ws = opened(4)
    const [p, q, r, s] = wsKeys(ws)
    ws.moveWorkspace(p, 2)
    expect(wsKeys(ws)).toEqual([q, p, r, s])
    ws.moveWorkspace(s, 0)
    expect(wsKeys(ws)).toEqual([s, q, p, r])
    ws.moveWorkspace(s, 4)
    expect(wsKeys(ws)).toEqual([q, p, r, s])
    ws.moveWorkspace(p, 1)
    ws.moveWorkspace(p, 2)
    expect(wsKeys(ws)).toEqual([q, p, r, s])
  })

  it('없는 cell·workspace 를 옮기거나 없는 workspace 로 옮기면 아무것도 바뀌지 않는다', () => {
    const ws = arranged()
    const before = shape(ws)
    ws.moveCell(9999, 'new')
    ws.moveCell(9999, { workspace: wsKeys(ws)[0], index: 0 })
    ws.moveCell(before[0][0], { workspace: 9999, index: 0 })
    ws.moveWorkspace(9999, 0)
    expect(shape(ws)).toEqual(before)
  })

  it('혼자인 cell 을 제 workspace 의 어느 자리로 옮겨도 cell 과 workspace 가 그대로 남는다', () => {
    const ws = arranged()
    const before = shape(ws)
    const [, [c]] = before
    const w = wsKeys(ws)[1]
    for (const index of [0, 1, 2]) ws.moveCell(c, { workspace: w, index })
    expect(shape(ws)).toEqual(before)
    expect(ws.workspaceOf(c)?.key).toBe(w)
  })

  it('pane 이 여럿인 cell 을 다른 workspace 로 옮겨도 pane·배치·포커스된 pane 이 그대로다', () => {
    const ws = arranged()
    const [[a]] = shape(ws)
    ws.select(a)
    ws.split('right')
    ws.split('down')
    const before = JSON.parse(JSON.stringify(selected(ws)))
    ws.moveCell(a, { workspace: wsKeys(ws)[2], index: 2 })
    expect(JSON.parse(JSON.stringify(ws.cells().find((c) => c.key === a)))).toEqual(before)
  })
})
