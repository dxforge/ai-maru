import { resolveObjectURL } from 'node:buffer'
import { Marked } from 'marked'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasItem } from '../../../shared/canvas'
import {
  bodyOf,
  clockTime,
  createCanvas,
  docKey,
  groupChoices,
  openCells,
  viewKey,
  type Canvas,
  type CellChoice,
  type OpenCell
} from './store'

const md = (id: string, text: string, title?: string): CanvasItem => ({
  id,
  kind: 'markdown',
  text,
  title
})

const image = (id: string, name: string): CanvasItem => ({
  id,
  kind: 'image',
  name,
  mime: 'image/png',
  bytes: new Uint8Array([1])
})

function titleOf(item: CanvasItem): string {
  const c = createCanvas()
  c.put(item)
  return c.docs.value[0].title
}

const docOf = (c: Canvas, id: string) => c.docs.value.find((d) => d.id === id)
const k = (id: string, cell?: string): string => docKey(id, cell)
const keys = (...ids: string[]): string[] => ids.map((id) => k(id))
const urlOf = (c: Canvas, id: string): string => (docOf(c, id) as { url: string }).url

describe('createCanvas', () => {
  it('처음엔 문서도 없고 패널도 닫혀 있다', () => {
    const c = createCanvas()
    expect(c.docs.value).toEqual([])
    expect(c.open.value).toBe(false)
    expect([...c.expanded]).toEqual([])
  })

  it('새 문서는 펼친 채 맨 위에 들어가고 패널이 열린다', () => {
    const c = createCanvas()
    c.choose('all')
    c.put(md('a', 'A'))
    c.expand(k('a'), false)
    c.put(md('b', 'B'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['b', 'a'])
    expect([...c.expanded]).toEqual(keys('b'))
    expect(c.open.value).toBe(true)
  })

  it('같은 id 가 다시 오면 자리와 펼침 상태를 지킨 채 내용만 바뀐다', () => {
    const c = createCanvas()
    c.put(md('a', 'A'))
    c.put(md('b', 'B'))
    c.expand(k('a'), false)
    c.put(md('a', '# A2'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['b', 'a'])
    expect(docOf(c, 'a')?.title).toBe('A2')
    expect(c.expanded.has(k('a'))).toBe(false)
  })

  it('받은 시각을 붙이고, 같은 id 로 고치면 고친 시각으로 바꾼다', () => {
    let t = 1000
    const c = createCanvas(() => t)
    c.put(md('a', 'A'))
    t = 2000
    c.put(md('b', 'B'))
    expect(docOf(c, 'a')?.at).toBe(1000)
    t = 3000
    c.put(md('a', 'A2'))
    expect(docOf(c, 'a')?.at).toBe(3000)
    expect(docOf(c, 'b')?.at).toBe(2000)
  })

  it('같은 id 의 이미지가 다시 오면 앞 그림의 URL 을 놓는다', () => {
    const c = createCanvas()
    c.put(image('i', 'a.png'))
    const first = urlOf(c, 'i')
    c.put(image('i', 'a.png'))
    expect(resolveObjectURL(first)).toBeUndefined()
    expect(resolveObjectURL(urlOf(c, 'i'))).toBeDefined()
  })

  it('같은 id 로 이미지 대신 마크다운이 오면 그림의 URL 을 놓는다', () => {
    const c = createCanvas()
    c.put(image('i', 'a.png'))
    const url = urlOf(c, 'i')
    c.put(md('i', '# text'))
    expect(resolveObjectURL(url)).toBeUndefined()
    expect(docOf(c, 'i')?.kind).toBe('markdown')
    expect(docOf(c, 'i')?.title).toBe('text')
  })

  it('지우면 목록과 펼침 상태에서 빠지고, 이미지는 URL 을 놓는다', () => {
    const c = createCanvas()
    c.put(image('i', 'a.png'))
    c.put(md('a', 'A'))
    const url = urlOf(c, 'i')
    c.remove(k('i'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['a'])
    expect([...c.expanded]).toEqual(keys('a'))
    expect(resolveObjectURL(url)).toBeUndefined()
    c.remove(k('nope'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['a'])
  })

  it('지운 id 로 다시 오면 새 문서처럼 펼친 채 맨 위에 들어간다', () => {
    const c = createCanvas()
    c.put(md('a', 'A'))
    c.put(md('b', 'B'))
    c.remove(k('a'))
    c.put(md('a', 'A2'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['a', 'b'])
    expect(c.expanded.has(k('a'))).toBe(true)
  })

  it('여러 문서를 함께 펼치고, 모두 접기·모두 펼치기는 모든 문서를 접고 펼친다', () => {
    const c = createCanvas()
    c.choose('all')
    c.put(md('a', 'A'))
    c.put(md('b', 'B'))
    c.expand(k('a'), false)
    c.expand(k('a'), true)
    expect([...c.expanded].toSorted()).toEqual(keys('a', 'b'))
    c.collapseAll()
    expect([...c.expanded]).toEqual([])
    expect(c.docs.value).toHaveLength(2)
    c.expandAll()
    expect([...c.expanded].toSorted()).toEqual(keys('a', 'b'))
  })

  it('붙잡은 동안 온 문서는 새 문서도 고친 문서도 넣지 않고 수만 세며, 놓으면 받은 순서와 받은 시각으로 넣는다', () => {
    let t = 1000
    const c = createCanvas(() => t)
    c.choose('all')
    c.put(md('a', '# A'))
    c.hold(true)
    t = 2000
    c.put(md('b', 'B'))
    c.put(md('a', '# A2'))
    c.put(md('c', 'C'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['a'])
    expect(docOf(c, 'a')?.title).toBe('A')
    expect(c.held.value).toBe(3)
    t = 3000
    c.hold(false)
    expect(c.docs.value.map((d) => d.id)).toEqual(['c', 'b', 'a'])
    expect(docOf(c, 'a')?.title).toBe('A2')
    expect(docOf(c, 'a')?.at).toBe(2000)
    expect([...c.expanded].toSorted()).toEqual(keys('a', 'b', 'c'))
    expect(c.held.value).toBe(0)
  })

  it('쌓인 문서를 지금 넣어도 붙잡은 채라, 그 뒤에 온 문서는 다시 쌓인다', () => {
    const c = createCanvas()
    c.choose('all')
    c.put(md('a', 'A'))
    c.hold(true)
    c.put(md('b', 'B'))
    c.flush()
    expect(c.docs.value.map((d) => d.id)).toEqual(['b', 'a'])
    expect(c.held.value).toBe(0)
    c.put(md('c', 'C'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['b', 'a'])
    expect(c.held.value).toBe(1)
  })

  it('닫으면 쌓인 문서를 넣고 다시 열지 않으며, 닫힌 패널은 붙잡지 않는다', () => {
    const c = createCanvas()
    c.choose('all')
    c.put(md('a', 'A'))
    c.hold(true)
    c.put(md('b', 'B'))
    c.close()
    expect(c.docs.value.map((d) => d.id)).toEqual(['b', 'a'])
    expect(c.open.value).toBe(false)
    c.hold(true)
    c.put(md('c', 'C'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['c', 'b', 'a'])
    expect(c.open.value).toBe(true)
  })

  it('붙잡은 동안 지운 문서가 쌓여 있었으면 놓을 때 새 문서처럼 들어간다', () => {
    const c = createCanvas()
    c.choose('all')
    c.put(md('a', 'A'))
    c.put(md('b', 'B'))
    c.hold(true)
    c.put(md('a', 'A2'))
    c.remove(k('a'))
    expect(c.docs.value.map((d) => d.id)).toEqual(['b'])
    c.hold(false)
    expect(c.docs.value.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('닫은 뒤 문서가 오면 다시 열린다', () => {
    const c = createCanvas()
    c.choose('all')
    c.put(md('a', 'A'))
    c.close()
    expect(c.open.value).toBe(false)
    c.put(md('a', 'A2'))
    expect(c.open.value).toBe(true)
  })

  it('닫은 패널을 다시 열면 펼침 상태가 그대로다', () => {
    const c = createCanvas()
    c.put(md('a', 'A'))
    c.put(md('b', 'B'))
    c.expand(k('b'), false)
    c.close()
    c.toggle()
    expect(c.open.value).toBe(true)
    expect([...c.expanded]).toEqual(keys('a'))
  })

  it('toggle 은 열린 패널을 닫고 닫힌 패널을 연다 — 문서가 없어도 연다', () => {
    const c = createCanvas()
    c.choose('all')
    c.toggle()
    expect(c.open.value).toBe(true)
    c.toggle()
    expect(c.open.value).toBe(false)
    c.put(md('a', 'A'))
    c.toggle()
    expect(c.open.value).toBe(false)
    c.toggle()
    expect(c.open.value).toBe(true)
  })
})

const owned = (id: string, cell?: string, text = id): CanvasItem => ({
  ...md(id, text, text),
  pty: 'p-1',
  ...(cell === undefined ? {} : { cell })
})

const shownTexts = (c: Canvas): [string | undefined, string][] =>
  c.shown.value.map((d) => [d.cell, d.title])

const named = (id: string, workspace: string, cell: string, branch?: string): OpenCell => ({
  id,
  group: `w-${workspace}`,
  name: { workspace, cell: branch === undefined ? { name: cell } : { name: cell, branch } }
})

const A = named('c-a', 'ws', 'app', 'main')
const B = named('c-b', 'ws', 'core')
const C = named('c-c', 'other', 'docs')

const flat = (c: Canvas): CellChoice[] => c.choices.value.flatMap((g) => g.cells)

const shownIds = (c: Canvas): string[] => c.shown.value.map((d) => d.id)

describe('cell 별 보기', () => {
  it('문서에 보낸 pty 와 cell 을 붙이고, 소속이 없으면 붙이지 않는다', () => {
    const c = createCanvas()
    c.put(owned('a', 'c-a'))
    c.put(md('n', 'N'))
    expect(docOf(c, 'a')).toMatchObject({ pty: 'p-1', cell: 'c-a' })
    expect(docOf(c, 'n')).not.toHaveProperty('pty')
    expect(docOf(c, 'n')).not.toHaveProperty('cell')
  })

  it('처음 보기는 현재 cell 이고, 선택된 cell 을 따라 그 cell 의 문서만 보인다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('a', 'c-a'))
    c.put(owned('b', 'c-b'))
    c.put(owned('n'))
    expect(c.view.value).toBe('current')
    expect(c.viewCell.value).toBe('c-a')
    expect(shownIds(c)).toEqual(['a'])
    c.sync({ cells: [A, B], current: 'c-b' })
    expect(c.viewCell.value).toBe('c-b')
    expect(shownIds(c)).toEqual(['b'])
  })

  it('같은 이름의 cell 목록을 다시 받으면 고를 목록을 새로 만들지 않고, 이름이 바뀌면 새로 만든다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    const before = c.choices.value
    c.sync({ cells: [{ ...A }, { ...B }], current: 'c-b' })
    expect(c.choices.value).toBe(before)
    expect(c.viewCell.value).toBe('c-b')
    c.sync({ cells: [A, named('c-b', 'ws', 'renamed')], current: 'c-b' })
    expect(flat(c).map((x) => x.name.cell.name)).toEqual(['app', 'renamed'])
  })

  it('선택된 cell 이 없으면 현재 cell 보기에는 아무 문서도 없다', () => {
    const c = createCanvas()
    c.sync({ cells: [] })
    c.put(owned('a', 'c-a'))
    c.put(owned('n'))
    expect(c.viewCell.value).toBeUndefined()
    expect(shownIds(c)).toEqual([])
  })

  it('모든 문서 보기는 소속이 없는 문서까지 모두 보이고, 선택이 바뀌어도 그대로다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('a', 'c-a'))
    c.put(owned('b', 'c-b'))
    c.put(owned('n'))
    c.choose('all')
    expect(c.viewCell.value).toBeNull()
    expect(shownIds(c)).toEqual(['n', 'b', 'a'])
    c.sync({ cells: [A, B], current: 'c-b' })
    expect(c.view.value).toBe('all')
    expect(shownIds(c)).toEqual(['n', 'b', 'a'])
  })

  it('고른 cell 의 보기는 선택이 바뀌어도 그 cell 의 문서만 보인다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('a', 'c-a'))
    c.put(owned('b', 'c-b'))
    c.choose({ cell: 'c-b' })
    expect(shownIds(c)).toEqual(['b'])
    c.sync({ cells: [A, B], current: 'c-a' })
    expect(c.viewCell.value).toBe('c-b')
    expect(shownIds(c)).toEqual(['b'])
  })

  it('새 문서가 와도 보기는 바뀌지 않는다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.choose({ cell: 'c-a' })
    c.put(owned('b', 'c-b'))
    expect(c.view.value).toEqual({ cell: 'c-a' })
    expect(shownIds(c)).toEqual([])
    expect(c.docs.value.map((d) => d.id)).toEqual(['b'])
  })

  it('고를 cell 은 workspace 로 묶어 열린 cell 을 모두 두고, 그 뒤에 문서가 남은 닫힌 cell 을 둔다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B, C], current: 'c-a' })
    c.put(owned('b', 'c-b'))
    c.put(owned('c', 'c-c'))
    c.sync({ cells: [A], current: 'c-a' })
    expect(c.choices.value).toEqual([
      {
        id: 'w-ws',
        workspace: 'ws',
        cells: [
          { ...A, closed: false },
          { ...B, closed: true }
        ]
      },
      { id: 'w-other', workspace: 'other', cells: [{ ...C, closed: true }] }
    ])
    c.remove(k('b', 'c-b'))
    expect(flat(c).map((x) => x.id)).toEqual(['c-a', 'c-c'])
  })

  it('닫힌 cell 은 닫히기 직전의 이름을 쓰고, 다시 열리면 닫힌 cell 이 아니다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('b', 'c-b'))
    const moved = named('c-b', 'other', 'core', 'fix')
    c.sync({ cells: [A, moved], current: 'c-a' })
    c.sync({ cells: [A], current: 'c-a' })
    expect(c.nameOf('c-b')).toEqual(moved.name)
    expect(c.choices.value.map((g) => g.workspace)).toEqual(['ws', 'other'])
    expect(flat(c).find((x) => x.id === 'c-b')).toEqual({ ...moved, closed: true })
    expect(c.isClosed('c-b')).toBe(true)
    expect(c.isClosed('c-a')).toBe(false)
    c.sync({ cells: [A, B], current: 'c-a' })
    expect(c.nameOf('c-b')).toEqual(B.name)
    expect(flat(c).filter((x) => x.closed)).toEqual([])
    expect(c.isClosed('c-b')).toBe(false)
  })

  it('닫힌 cell 을 고른 보기는 그 cell 에 남은 문서를 보인다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('b', 'c-b'))
    c.sync({ cells: [A], current: 'c-a' })
    c.choose({ cell: 'c-b' })
    expect(shownIds(c)).toEqual(['b'])
  })

  it('고른 닫힌 cell 은 문서가 모두 지워져도 고를 cell 에 남고, 다른 보기로 바꾸면 빠진다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('b', 'c-b'))
    c.sync({ cells: [A], current: 'c-a' })
    c.choose({ cell: 'c-b' })
    c.remove(k('b', 'c-b'))
    expect(flat(c)).toEqual([
      { ...A, closed: false },
      { ...B, closed: true }
    ])
    c.choose('all')
    expect(flat(c).map((x) => x.id)).toEqual(['c-a'])
  })

  it('현재 workspace 보기는 선택된 cell 의 workspace 를 따라가, 그 workspace 의 cell 문서만 보인다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B, C], current: 'c-a' })
    c.put(owned('a', 'c-a'))
    c.put(owned('b', 'c-b'))
    c.put(owned('c', 'c-c'))
    c.put(owned('n'))
    c.choose('workspace')
    expect(c.viewWorkspace.value).toBe('w-ws')
    expect(c.viewCell.value).toBeNull()
    expect(shownIds(c)).toEqual(['b', 'a'])
    c.sync({ cells: [A, B, C], current: 'c-c' })
    expect(c.viewWorkspace.value).toBe('w-other')
    expect(shownIds(c)).toEqual(['c'])
  })

  it('현재 workspace 보기는 그 workspace 의 닫힌 cell 에 남은 문서도 보인다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('b', 'c-b'))
    c.sync({ cells: [A], current: 'c-a' })
    c.choose('workspace')
    expect(shownIds(c)).toEqual(['b'])
  })

  it('선택된 cell 이 없으면 현재 workspace 보기에는 아무 문서도 없다', () => {
    const c = createCanvas()
    c.sync({ cells: [A] })
    c.put(owned('a', 'c-a'))
    c.put(owned('n'))
    c.choose('workspace')
    expect(c.viewWorkspace.value).toBeUndefined()
    expect(shownIds(c)).toEqual([])
  })

  it('고른 workspace 의 보기는 선택이 바뀌어도 그 workspace 의 문서만 보인다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B, C], current: 'c-a' })
    c.put(owned('a', 'c-a'))
    c.put(owned('c', 'c-c'))
    c.choose({ workspace: 'w-other' })
    expect(shownIds(c)).toEqual(['c'])
    c.sync({ cells: [A, B, C], current: 'c-b' })
    expect(c.viewWorkspace.value).toBe('w-other')
    expect(shownIds(c)).toEqual(['c'])
  })

  it('고른 workspace 의 cell 이 모두 닫혀 문서가 없어도 빈 묶음과 이름이 남고, 다른 보기로 바꾸면 빠진다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B, C], current: 'c-a' })
    c.choose({ workspace: 'w-other' })
    c.sync({ cells: [A, B], current: 'c-a' })
    expect(c.choices.value.map((g) => [g.id, g.cells.length])).toEqual([
      ['w-ws', 2],
      ['w-other', 0]
    ])
    expect(c.workspaceName.value).toBe('other')
    c.choose('workspace')
    expect(c.choices.value.map((g) => g.id)).toEqual(['w-ws'])
  })

  it('workspace 를 고정해도 문서 없는 닫힌 cell 은 고정 전에 닫혔든 고정 중에 닫혔든 고를 cell 에 넣지 않는다', () => {
    const c = createCanvas()
    const D = named('c-d', 'ws', 'docs')
    const E = named('c-e', 'ws', 'e2e')
    c.sync({ cells: [A, B, D, E], current: 'c-a' })
    c.sync({ cells: [A, D, E], current: 'c-a' })
    c.choose({ workspace: 'w-ws' })
    c.put(owned('d', 'c-d'))
    c.sync({ cells: [A], current: 'c-a' })
    expect(flat(c)).toEqual([
      { ...A, closed: false },
      { ...D, closed: true }
    ])
  })

  it('고정한 workspace 의 마지막 cell 이 다른 workspace 로 옮겨지면 빈 묶음과 이름이 남고, 다른 보기로 바꾸면 빠진다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, C], current: 'c-a' })
    c.put(owned('c', 'c-c'))
    c.choose({ workspace: 'w-other' })
    c.sync({
      cells: [A, { ...C, group: 'w-ws', name: { ...C.name, workspace: 'ws' } }],
      current: 'c-a'
    })
    expect(c.choices.value.map((g) => [g.id, g.cells.length])).toEqual([
      ['w-ws', 2],
      ['w-other', 0]
    ])
    expect(c.workspaceName.value).toBe('other')
    expect(shownIds(c)).toEqual([])
    c.choose('all')
    expect(c.choices.value.map((g) => g.id)).toEqual(['w-ws'])
  })

  it('workspace 이름은 workspace 보기에서 그 workspace 의 것이고, 다른 보기나 선택된 cell 이 없으면 없다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, C] })
    c.choose('workspace')
    expect(c.workspaceName.value).toBeUndefined()
    c.sync({ cells: [A, C], current: 'c-c' })
    expect(c.workspaceName.value).toBe('other')
    c.choose({ workspace: 'w-ws' })
    expect(c.workspaceName.value).toBe('ws')
    c.choose({ cell: 'c-a' })
    expect(c.workspaceName.value).toBeUndefined()
    c.choose('all')
    expect(c.workspaceName.value).toBeUndefined()
  })

  it('workspace 보기에서는 그 workspace 의 문서만 닫힌 패널을 열고, 붙잡은 동안의 개수와 모두 접기도 그 문서에만 미친다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B, C], current: 'c-a' })
    c.choose('workspace')
    c.put(owned('c', 'c-c'))
    c.put(owned('n'))
    expect(c.open.value).toBe(false)
    c.put(owned('b', 'c-b'))
    expect(c.open.value).toBe(true)
    c.collapseAll()
    expect([...c.expanded].toSorted()).toEqual([k('c', 'c-c'), k('n')].toSorted())
    c.hold(true)
    c.put(owned('a', 'c-a'))
    c.put(owned('c2', 'c-c'))
    c.put(owned('n2'))
    expect(c.held.value).toBe(1)
  })

  it('보이는 문서의 key 는 따라가는 보기와 그 대상에 고정한 보기가 같고, 선택이 바뀌면 따라 바뀐다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B, C], current: 'c-a' })
    expect(c.shownKey.value).toBe('cell:c-a')
    c.choose({ cell: 'c-a' })
    expect(c.shownKey.value).toBe('cell:c-a')
    c.choose('workspace')
    expect(c.shownKey.value).toBe('workspace:w-ws')
    c.sync({ cells: [A, B, C], current: 'c-c' })
    expect(c.shownKey.value).toBe('workspace:w-other')
    c.choose({ workspace: 'w-ws' })
    expect(c.shownKey.value).toBe('workspace:w-ws')
    c.choose('all')
    expect(c.shownKey.value).toBe('all')
  })

  it('모두 펼치기·모두 접기는 지금 보기의 문서에만 미친다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('a', 'c-a'))
    c.put(owned('b', 'c-b'))
    c.collapseAll()
    expect([...c.expanded]).toEqual([k('b', 'c-b')])
    c.expand(k('b', 'c-b'), false)
    c.expandAll()
    expect([...c.expanded]).toEqual([k('a', 'c-a')])
  })

  it('소속이 없거나 모르는 cell 은 이름이 없다', () => {
    const c = createCanvas()
    c.sync({ cells: [A], current: 'c-a' })
    expect(c.nameOf('c-a')).toEqual(A.name)
    expect(c.nameOf(undefined)).toBeUndefined()
    expect(c.nameOf('c-x')).toBeUndefined()
  })

  it('같은 id 라도 보낸 cell 이 다르면 따로 두고, 같은 cell 이면 고친다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('f', 'c-a', 'A'))
    c.put(owned('f', 'c-b', 'B'))
    c.put(owned('f', undefined, 'N'))
    c.choose('all')
    expect(shownTexts(c)).toEqual([
      [undefined, 'N'],
      ['c-b', 'B'],
      ['c-a', 'A']
    ])
    c.put(owned('f', 'c-a', 'A2'))
    c.put(owned('f', undefined, 'N2'))
    expect(shownTexts(c)).toEqual([
      [undefined, 'N2'],
      ['c-b', 'B'],
      ['c-a', 'A2']
    ])
    c.choose('current')
    expect(shownTexts(c)).toEqual([['c-a', 'A2']])
  })

  it('펼침 상태와 지우기는 (cell, id) 의 그 문서에만 미친다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('f', 'c-a'))
    c.put(owned('f', 'c-b'))
    c.expand(k('f', 'c-a'), false)
    expect([...c.expanded]).toEqual([k('f', 'c-b')])
    c.remove(k('f', 'c-b'))
    expect(c.docs.value.map((d) => d.cell)).toEqual(['c-a'])
    c.choose({ cell: 'c-b' })
    c.put(owned('f', 'c-b'))
    expect([...c.expanded].toSorted()).toEqual([k('f', 'c-b')])
  })

  it('지금 보기에 드는 문서만 닫힌 패널을 연다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('b', 'c-b'))
    c.put(owned('n'))
    expect(c.open.value).toBe(false)
    expect(c.docs.value.map((d) => d.id)).toEqual(['n', 'b'])
    c.put(owned('a', 'c-a'))
    expect(c.open.value).toBe(true)
    c.close()
    c.choose({ cell: 'c-b' })
    c.put(owned('a2', 'c-a'))
    expect(c.open.value).toBe(false)
    c.put(owned('b', 'c-b'))
    expect(c.open.value).toBe(true)
    c.close()
    c.choose('all')
    c.put(owned('n'))
    expect(c.open.value).toBe(true)
  })

  it('붙잡은 동안 쌓인 문서는 지금 보기에 드는 것만 센다', () => {
    const c = createCanvas()
    c.sync({ cells: [A, B], current: 'c-a' })
    c.put(owned('a', 'c-a'))
    c.hold(true)
    c.put(owned('a2', 'c-a'))
    c.put(owned('b', 'c-b'))
    c.put(owned('n'))
    expect(c.held.value).toBe(1)
    c.choose('all')
    expect(c.held.value).toBe(3)
  })
})

describe('viewKey', () => {
  it('따라가는 보기, 고정한 cell, 고정한 workspace 를 서로 다른 key 로 가른다', () => {
    expect(
      (['current', 'workspace', 'all', { cell: 'x' }, { workspace: 'x' }] as const).map(viewKey)
    ).toEqual(['current', 'workspace', 'all', 'cell:x', 'workspace:x'])
  })
})

describe('openCells', () => {
  it('workspace 순서, 그 안의 cell 순서로 workspace 와 이름을 붙이고, cell 이름은 cell 헤더처럼 포커스된 pane 으로 정한다', () => {
    const home = '/Users/me'
    const pane = (key: number, cwd: string, git?: { repo: string; branch: string }) => ({
      key,
      cwd,
      ...(git && { git: { ...git, common: `${cwd}/.git` } })
    })
    const cells = openCells(
      [
        {
          id: 'w-1',
          cells: [
            {
              id: 'c-1',
              focused: 2,
              panes: [pane(1, home), pane(2, '/r/app', { repo: 'app', branch: 'main' })]
            },
            { id: 'c-2', focused: 3, panes: [pane(3, '/tmp/x')] }
          ]
        },
        {
          id: 'w-2',
          name: 'Named',
          cells: [{ id: 'c-3', focused: 4, panes: [pane(4, '/r/core')] }]
        }
      ],
      home
    )
    expect(cells).toEqual([
      { id: 'c-1', group: 'w-1', name: { workspace: '~', cell: { name: 'app', branch: 'main' } } },
      { id: 'c-2', group: 'w-1', name: { workspace: '~', cell: { name: 'x' } } },
      { id: 'c-3', group: 'w-2', name: { workspace: 'Named', cell: { name: 'core' } } }
    ])
  })
})

describe('groupChoices', () => {
  const choice = (id: string, group: string, closed: boolean, workspace = group): CellChoice => ({
    id,
    group,
    name: { workspace, cell: { name: id } },
    closed
  })

  it('받은 순서로 workspace 를 묶고, 닫힌 cell 은 그 workspace 의 열린 cell 뒤에 둔다', () => {
    const groups = groupChoices([
      choice('a1', 'a', false),
      choice('b1', 'b', false),
      choice('a2', 'a', false),
      choice('a3', 'a', true, 'old name'),
      choice('b2', 'b', true)
    ])
    expect(groups.map((g) => [g.workspace, g.cells.map((c) => c.id)])).toEqual([
      ['a', ['a1', 'a2', 'a3']],
      ['b', ['b1', 'b2']]
    ])
  })

  it('없어진 workspace 의 닫힌 cell 은 남긴 이름으로 묶음을 만들어 뒤에 둔다', () => {
    const groups = groupChoices([
      choice('x1', 'x', true, 'gone'),
      choice('a1', 'a', false),
      choice('x2', 'x', true, 'gone')
    ])
    expect(groups.map((g) => [g.id, g.workspace, g.cells.map((c) => c.id)])).toEqual([
      ['a', 'a', ['a1']],
      ['x', 'gone', ['x1', 'x2']]
    ])
  })
})

describe('clockTime', () => {
  it('받은 시각을 그 자리의 HH:MM 으로 보인다', () => {
    expect(clockTime(new Date(2026, 0, 2, 9, 5, 59).getTime())).toBe('09:05')
    expect(clockTime(new Date(2026, 0, 2, 23, 40).getTime())).toBe('23:40')
  })
})

describe('문서 제목', () => {
  it('준 제목이 먼저다', () => {
    expect(titleOf(md('a', '# 머리', '제목'))).toBe('제목')
  })

  it('제목이 없으면 첫 heading 이다', () => {
    expect(titleOf(md('a', '본문\n\n## 둘째\n\n# 셋째'))).toBe('둘째')
  })

  it('heading 안의 인라인 마크다운은 글자만 남긴다', () => {
    expect(titleOf(md('a', '# **굵게** `code` [링크](https://x) <em>e</em>'))).toBe(
      '굵게 code 링크 e'
    )
  })

  it('heading 의 문자 참조는 본문처럼 풀고, 코드 안의 것은 글자 그대로 둔다', () => {
    expect(
      titleOf(md('a', '# Tom &amp; *J &lt;3&gt;* [&copy;](https://x) &#38; `&amp;` \\&amp;'))
    ).toBe('Tom & J <3> © & &amp; &amp;')
  })

  it('세미콜론 없는 참조는 본문처럼 풀지 않고, 세미콜론까지의 이름은 본문처럼 앞부분을 푼다', () => {
    expect(titleOf(md('a', '# &copy 2024 a &lt b &copyx; &notit;'))).toBe(
      '&copy 2024 a &lt b ©x; ¬it;'
    )
  })

  it('밑줄 heading 도 heading 이다', () => {
    expect(titleOf(md('a', '머리\n===\n'))).toBe('머리')
  })

  it('코드 블록 안의 # 줄은 heading 이 아니다', () => {
    expect(titleOf(md('a', '```sh\n# 주석\n```\n'))).toBe('Markdown')
  })

  it('heading 이 없으면 Markdown 이다', () => {
    expect(titleOf(md('a', '본문만'))).toBe('Markdown')
  })

  it('이미지는 파일 이름이다', () => {
    expect(titleOf(image('i', 'shot.png'))).toBe('shot.png')
  })

  it('lexing 하지 못한 문서도 버리지 않고 Markdown 이라는 제목으로 넣는다', () => {
    const lexer = vi.spyOn(Marked.prototype, 'lexer').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded')
    })
    try {
      const c = createCanvas()
      c.put(md('a', '# big\nline\n'))
      expect(c.docs.value.map((d) => d.title)).toEqual(['Markdown'])
      expect(bodyOf(c.docs.value[0])?.length).toBe(1)
    } finally {
      lexer.mockRestore()
    }
  })
})

describe('문서 본문', () => {
  it('넣을 때 한 번만 lexing 하고, 그 결과로 제목과 본문 묶음을 함께 만든다', () => {
    const lexer = vi.spyOn(Marked.prototype, 'lexer')
    try {
      const c = createCanvas()
      c.put(md('a', '# 머리\n\n본문'))
      expect(lexer).toHaveBeenCalledTimes(1)
      expect(c.docs.value[0].title).toBe('머리')
      expect(bodyOf(c.docs.value[0])?.length).toBe(1)
    } finally {
      lexer.mockRestore()
    }
  })

  it('같은 id 로 다시 오면 새 본문이고, 이미지에는 본문이 없다', () => {
    const c = createCanvas()
    c.put(md('a', 'old'))
    const old = bodyOf(c.docs.value[0])
    c.put(md('a', 'new'))
    expect(bodyOf(c.docs.value[0])).not.toBe(old)
    expect(bodyOf(c.docs.value[0])).toBe(bodyOf(c.docs.value[0]))
    c.put(image('i', 'shot.png'))
    expect(bodyOf(docOf(c, 'i')!)).toBeUndefined()
  })
})
