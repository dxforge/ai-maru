import { describe, expect, it } from 'vitest'
import {
  dropAt,
  SCROLL_EDGE,
  SCROLL_MAX,
  scrollStep,
  type Dragged,
  type SidebarSpans
} from './sidebarDrag'

// 사이드바의 모양을 따른다: 이름 줄 28px, cell 카드 26px, 카드 사이 6px, workspace 사이 6px·선·6px.
const SPANS: SidebarSpans = {
  workspaces: [
    {
      key: 1,
      top: 0,
      bottom: 86,
      head: { top: 0, bottom: 28 },
      count: 2,
      cells: [
        { top: 28, bottom: 54 },
        { top: 60, bottom: 86 }
      ]
    },
    {
      key: 2,
      top: 92,
      bottom: 152,
      head: { top: 98, bottom: 126 },
      count: 1,
      cells: [{ top: 126, bottom: 152 }]
    },
    { key: 3, top: 158, bottom: 192, head: { top: 164, bottom: 192 }, count: 3, cells: [] }
  ],
  newWorkspace: { top: 200, bottom: 230 }
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
    expect(dropAt(from, SPANS, 35)).toEqual({
      drop: { kind: 'cell', workspace: 1, index: 0 },
      line: 25
    })
    expect(dropAt(from, SPANS, 50)).toEqual({
      drop: { kind: 'cell', workspace: 1, index: 1 },
      line: 57
    })
    expect(dropAt(from, SPANS, 80)).toEqual({
      drop: { kind: 'cell', workspace: 1, index: 2 },
      line: 89
    })
  })

  it('펼친 workspace 의 이름 줄 위면 그 workspace 의 맨 앞이다', () => {
    expect(dropAt(cell(1, 1), SPANS, 110)?.drop).toEqual({ kind: 'cell', workspace: 2, index: 0 })
  })

  it('workspace 사이의 틈은 가운데에서 갈라 위아래 workspace 에 나눠 준다', () => {
    const from = cell(3, 0)
    expect(dropAt(from, SPANS, 88)?.drop).toEqual({ kind: 'cell', workspace: 1, index: 2 })
    expect(dropAt(from, SPANS, 90)?.drop).toEqual({ kind: 'cell', workspace: 2, index: 0 })
  })

  it('접힌 workspace 에 놓으면 그 끝이고, 선은 이름 줄 아래에 긋는다', () => {
    expect(dropAt(cell(1, 0), SPANS, 175)).toEqual({
      drop: { kind: 'cell', workspace: 3, index: 3 },
      line: 195
    })
  })

  it('New Workspace 칸 위나 그 아래면 새 workspace 이고, 선은 긋지 않는다', () => {
    for (const y of [200, 215, 400])
      expect(dropAt(cell(1, 0), SPANS, y)).toEqual({ drop: { kind: 'new-workspace' } })
  })

  it('New Workspace 칸이 없으면 마지막 workspace 아래도 그 workspace 다', () => {
    const spans = { workspaces: SPANS.workspaces }
    expect(dropAt(cell(1, 0), spans, 400)?.drop).toEqual({ kind: 'cell', workspace: 3, index: 3 })
  })

  it('놓아도 순서가 그대로인 제자리 앞뒤면 아무것도 주지 않는다', () => {
    expect(dropAt(cell(1, 0), SPANS, 35)).toBeUndefined()
    expect(dropAt(cell(1, 0), SPANS, 50)).toBeUndefined()
    expect(dropAt(cell(1, 0), SPANS, 80)).toBeDefined()
    expect(dropAt(cell(2, 0), SPANS, 130)).toBeUndefined()
  })

  it('workspace 가 없으면 New Workspace 칸 밖에서는 아무것도 주지 않는다', () => {
    expect(dropAt(cell(1, 0), { workspaces: [] }, 10)).toBeUndefined()
  })
})

describe('dropAt — workspace', () => {
  const ws = (index: number): Dragged => ({ kind: 'workspace', workspace: 0, index })

  it('workspace 의 가운데보다 위면 그 앞, 아래면 그 뒤이고, 선은 workspace 사이 틈의 가운데에 긋는다', () => {
    expect(dropAt(ws(2), SPANS, 10)).toEqual({ drop: { kind: 'workspace', index: 0 }, line: -3 })
    expect(dropAt(ws(2), SPANS, 60)).toEqual({ drop: { kind: 'workspace', index: 1 }, line: 89 })
    expect(dropAt(ws(0), SPANS, 300)).toEqual({ drop: { kind: 'workspace', index: 3 }, line: 195 })
  })

  it('제자리 앞뒤면 아무것도 주지 않는다', () => {
    expect(dropAt(ws(1), SPANS, 60)).toBeUndefined()
    expect(dropAt(ws(1), SPANS, 140)).toBeUndefined()
    expect(dropAt(ws(1), SPANS, 180)).toBeDefined()
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
