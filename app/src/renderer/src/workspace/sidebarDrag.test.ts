import { describe, expect, it } from 'vitest'
import {
  dropAt,
  SCROLL_EDGE,
  SCROLL_MAX,
  scrollStep,
  type Dragged,
  type SidebarSpans
} from './sidebarDrag'

// 사이드바의 모양을 따른다: 이름 줄 30px, cell 카드 30px, 카드 사이 6px, workspace 사이 6px·선·6px.
const SPANS: SidebarSpans = {
  workspaces: [
    {
      key: 1,
      top: 0,
      bottom: 96,
      head: { top: 0, bottom: 30 },
      count: 2,
      cells: [
        { top: 30, bottom: 60 },
        { top: 66, bottom: 96 }
      ]
    },
    {
      key: 2,
      top: 102,
      bottom: 168,
      head: { top: 108, bottom: 138 },
      count: 1,
      cells: [{ top: 138, bottom: 168 }]
    },
    { key: 3, top: 174, bottom: 210, head: { top: 180, bottom: 210 }, count: 3, cells: [] }
  ],
  newWorkspace: { top: 218, bottom: 248 }
}

const cell = (workspace: number, index: number, key = 99): Dragged => ({
  kind: 'cell',
  cell: key,
  workspace,
  index
})

describe('dropAt — cell', () => {
  it('cell 면의 위 절반이면 그 앞, 아래 절반이면 그 뒤에 놓고, 선은 면 사이 틈의 가운데에 긋는다', () => {
    const from = cell(2, 0)
    expect(dropAt(from, SPANS, 38)).toEqual({
      drop: { kind: 'cell', workspace: 1, index: 0 },
      line: 27
    })
    expect(dropAt(from, SPANS, 55)).toEqual({
      drop: { kind: 'cell', workspace: 1, index: 1 },
      line: 63
    })
    expect(dropAt(from, SPANS, 90)).toEqual({
      drop: { kind: 'cell', workspace: 1, index: 2 },
      line: 99
    })
  })

  it('펼친 workspace 의 이름 줄 위면 그 workspace 의 맨 앞이다', () => {
    expect(dropAt(cell(1, 1), SPANS, 120)?.drop).toEqual({ kind: 'cell', workspace: 2, index: 0 })
  })

  it('workspace 사이의 틈은 가운데에서 갈라 위아래 workspace 에 나눠 준다', () => {
    const from = cell(3, 0)
    expect(dropAt(from, SPANS, 98)?.drop).toEqual({ kind: 'cell', workspace: 1, index: 2 })
    expect(dropAt(from, SPANS, 100)?.drop).toEqual({ kind: 'cell', workspace: 2, index: 0 })
  })

  it('접힌 workspace 에 놓으면 그 끝이고, 선은 이름 줄 아래에 긋는다', () => {
    expect(dropAt(cell(1, 0), SPANS, 190)).toEqual({
      drop: { kind: 'cell', workspace: 3, index: 3 },
      line: 213
    })
  })

  it('New Workspace 칸 위나 그 아래면 새 workspace 이고, 선은 긋지 않는다', () => {
    for (const y of [218, 233, 400])
      expect(dropAt(cell(1, 0), SPANS, y)).toEqual({ drop: { kind: 'new-workspace' } })
  })

  it('New Workspace 칸이 없으면 마지막 workspace 아래도 그 workspace 다', () => {
    const spans = { workspaces: SPANS.workspaces }
    expect(dropAt(cell(1, 0), spans, 400)?.drop).toEqual({ kind: 'cell', workspace: 3, index: 3 })
  })

  it('놓아도 순서가 그대로인 제자리 앞뒤면 아무것도 주지 않는다', () => {
    expect(dropAt(cell(1, 0), SPANS, 38)).toBeUndefined()
    expect(dropAt(cell(1, 0), SPANS, 55)).toBeUndefined()
    expect(dropAt(cell(1, 0), SPANS, 90)).toBeDefined()
    expect(dropAt(cell(2, 0), SPANS, 145)).toBeUndefined()
  })

  it('workspace 가 없으면 New Workspace 칸 밖에서는 아무것도 주지 않는다', () => {
    expect(dropAt(cell(1, 0), { workspaces: [] }, 10)).toBeUndefined()
  })
})

describe('dropAt — workspace', () => {
  const ws = (index: number): Dragged => ({ kind: 'workspace', workspace: 0, index })

  it('workspace 의 가운데보다 위면 그 앞, 아래면 그 뒤이고, 선은 workspace 사이 틈의 가운데에 긋는다', () => {
    expect(dropAt(ws(2), SPANS, 10)).toEqual({ drop: { kind: 'workspace', index: 0 }, line: -3 })
    expect(dropAt(ws(2), SPANS, 60)).toEqual({ drop: { kind: 'workspace', index: 1 }, line: 99 })
    expect(dropAt(ws(0), SPANS, 300)).toEqual({ drop: { kind: 'workspace', index: 3 }, line: 213 })
  })

  it('제자리 앞뒤면 아무것도 주지 않는다', () => {
    expect(dropAt(ws(1), SPANS, 60)).toBeUndefined()
    expect(dropAt(ws(1), SPANS, 140)).toBeUndefined()
    expect(dropAt(ws(1), SPANS, 200)).toBeDefined()
  })
})

describe('scrollStep', () => {
  const list = { top: 100, bottom: 500 }

  it('끝에서 SCROLL_EDGE 안쪽에서만 굴리고, 끝에 가까울수록 빠르며 가장 빠를 때 SCROLL_MAX 다', () => {
    expect(scrollStep(list, 300)).toBe(0)
    expect(scrollStep(list, list.top + SCROLL_EDGE)).toBe(0)
    expect(scrollStep(list, list.bottom - SCROLL_EDGE)).toBe(0)
    expect(scrollStep(list, list.top + SCROLL_EDGE - 1)).toBe(-1)
    expect(scrollStep(list, list.top + SCROLL_EDGE / 2)).toBe(-Math.ceil(SCROLL_MAX / 2))
    expect(scrollStep(list, list.top)).toBe(-SCROLL_MAX)
    expect(scrollStep(list, list.bottom - 1)).toBe(SCROLL_MAX)
    expect(scrollStep(list, list.bottom - SCROLL_EDGE / 2)).toBe(Math.ceil(SCROLL_MAX / 2))
  })

  it('목록 밖으로 나가도 가장 빠른 폭을 넘지 않는다', () => {
    expect(scrollStep(list, 0)).toBe(-SCROLL_MAX)
    expect(scrollStep(list, 900)).toBe(SCROLL_MAX)
  })
})
