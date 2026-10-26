import { describe, expect, it } from 'vitest'
import { mateRows } from './mates'
import type { ProgramStatusRecord } from './program-status'
import type { ScreenPane, ScreenWorkspace } from './screen'

function record(app: string, fields: Partial<ProgramStatusRecord> = {}): ProgramStatusRecord {
  return {
    id: '',
    state: 'working',
    kind: null,
    progress: null,
    app,
    title: '',
    message: '',
    ...fields
  }
}

function cell(
  key: number,
  panes: ScreenPane[],
  focused = panes[0].key
): ScreenWorkspace['cells'][number] {
  return { key, id: `c-${key}`, panes, focused, layout: { pane: panes[0].key } }
}

const git = (branch: string) => ({ repo: 'ai-maru', branch })

describe('mateRows', () => {
  it('화면 순서대로 claude 가 도는 pane 만, 사이드바와 같은 이름으로 돌려주고 dir 은 cwd 가 없으면 시작 디렉토리다', () => {
    const workspaces = [
      {
        key: 1,
        id: 'w-1',
        cells: [
          cell(2, [
            { key: 3, ptyId: 'p-a', cwd: '/r/ai-maru', git: git('main') },
            { key: 4, ptyId: 'p-shell', cwd: '/r/ai-maru' }
          ]),
          cell(
            5,
            [
              { key: 6, ptyId: 'p-other', cwd: '/r/wt' },
              { key: 7, ptyId: 'p-b', cwd: '/r/wt/app', git: git('feat/x') }
            ],
            7
          )
        ]
      },
      { key: 8, id: 'w-8', cells: [cell(9, [{ key: 10, ptyId: 'p-c', startDir: '/tmp/notes' }])] }
    ]
    const records = new Map([
      ['p-a', record('claude-code', { message: 'reading', title: 'T' })],
      ['p-other', record('codex')],
      ['p-b', record('claude-code', { state: 'blocked', kind: 'permission', title: 'Bash' })],
      ['p-c', record('claude-code', { state: 'idle' })]
    ])
    expect(mateRows(workspaces, (pty) => records.get(pty))).toEqual([
      {
        pty: 'p-a',
        state: 'working',
        kind: null,
        workspace: 'ai-maru',
        cell: 'ai-maru main',
        dir: '/r/ai-maru',
        message: 'reading'
      },
      {
        pty: 'p-b',
        state: 'blocked',
        kind: 'permission',
        workspace: 'ai-maru',
        cell: 'ai-maru feat/x',
        dir: '/r/wt/app',
        message: 'Bash'
      },
      {
        pty: 'p-c',
        state: 'idle',
        kind: null,
        workspace: 'Shell',
        cell: 'Shell',
        dir: '/tmp/notes',
        message: ''
      }
    ])
  })

  it('cwd 도 시작 디렉토리도 모르는 pane 의 dir 은 빈 문자열이다', () => {
    const workspaces = [{ key: 1, id: 'w-1', cells: [cell(2, [{ key: 3, ptyId: 'p-a' }])] }]
    const rows = mateRows(workspaces, () => record('claude-code'))
    expect(rows.map((r) => [r.workspace, r.cell, r.dir])).toEqual([['Shell', 'Shell', '']])
  })

  it('CELL 은 cell 의 focused pane 기준이고 DIR 은 claude pane 자신의 cwd 다', () => {
    const workspaces = [
      {
        key: 1,
        id: 'w-1',
        cells: [
          cell(
            2,
            [
              { key: 3, ptyId: 'p-a', cwd: '/r/wt-a', git: git('feat/a') },
              { key: 4, ptyId: 'p-b', cwd: '/r/wt-b', git: git('feat/b') }
            ],
            4
          )
        ]
      }
    ]
    const rows = mateRows(workspaces, (pty) => (pty === 'p-a' ? record('claude-code') : undefined))
    expect(rows.map((r) => [r.pty, r.workspace, r.cell, r.dir])).toEqual([
      ['p-a', 'ai-maru', 'ai-maru feat/b', '/r/wt-a']
    ])
  })

  it('하위 레코드만 claude 인 pane 은 들지 않는다', () => {
    const records = new Map([
      ['p-a', [record('codex'), record('claude-code', { id: '/sub' })]],
      ['p-b', [record('claude-code', { id: '/sub' })]]
    ])
    const root = (pty: string) => records.get(pty)?.find((r) => r.id === '')
    const workspaces = [
      {
        key: 1,
        id: 'w-1',
        cells: [
          cell(2, [
            { key: 3, ptyId: 'p-a' },
            { key: 4, ptyId: 'p-b' }
          ])
        ]
      }
    ]
    expect(mateRows(workspaces, root)).toEqual([])
  })

  it('pane 이 하나도 claude 가 아니면 빈 목록이다', () => {
    const workspaces = [{ key: 1, id: 'w-1', cells: [cell(2, [{ key: 3, ptyId: 'p-a' }])] }]
    expect(mateRows(workspaces, () => undefined)).toEqual([])
  })
})
