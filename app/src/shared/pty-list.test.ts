import { describe, expect, it } from 'vitest'
import type { ProgramStatusRecord } from './program-status'
import type { PtyState } from './pty-state'
import { ptyRows } from './pty-list'
import type { ScreenWorkspace } from './screen'

function state(cwd: string | null, records: Partial<ProgramStatusRecord>[] = []): PtyState {
  return {
    cwd,
    cwdReports: 0,
    title: null,
    foregroundCwd: null,
    command: null,
    records: records.map((r) => ({
      id: '',
      state: 'working',
      kind: null,
      progress: null,
      app: 'claude-code',
      title: '',
      message: '',
      ...r
    }))
  }
}

const workspaces: ScreenWorkspace[] = [
  {
    key: 1,
    id: 'w-1',
    cells: [
      {
        key: 2,
        id: 'c-2',
        focused: 3,
        layout: { pane: 3 },
        panes: [{ key: 3, id: 'n-3', ptyId: 'p-a', cwd: '/r/ai-maru', title: 'fix it' }]
      }
    ]
  },
  {
    key: 4,
    id: 'w-4',
    cells: [
      {
        key: 5,
        id: 'c-5',
        focused: 6,
        layout: { pane: 6 },
        panes: [{ key: 6, id: 'n-6', ptyId: 'p-b', cwd: '/r/other' }]
      }
    ]
  }
]

describe('ptyRows', () => {
  it('pane 의 pty 를 화면 순서로, 그 뒤에 job 을 표 순서로 싣고, 이름 없는 job 의 NAME 은 사이드바처럼 명령이다', () => {
    const states = new Map([
      ['p-a', state('/r/ai-maru', [{ state: 'blocked', kind: 'permission' }])],
      ['p-j', state('/r/other/app', [{ state: 'idle' }])]
    ])
    const exits = new Map([['p-b', { code: 0, signal: null }]])
    const rows = ptyRows(
      workspaces,
      [
        { pty: 'p-j', name: 'dev', cell: 'c-5', command: ['pnpm', 'dev'] },
        { pty: 'p-k', cell: 'c-2', command: ['sleep', '600'], exit: { code: null, signal: 15 } }
      ],
      (pty) => states.get(pty),
      (pty) => exits.get(pty) ?? null,
      '/bin/zsh'
    )
    expect(rows).toEqual([
      {
        pty: 'p-a',
        kind: 'pane',
        workspace: 'ai-maru',
        cell: 'c-2',
        state: 'blocked',
        state_kind: 'permission',
        exit: null,
        name: 'fix it',
        dir: '/r/ai-maru'
      },
      {
        pty: 'p-b',
        kind: 'pane',
        workspace: 'other',
        cell: 'c-5',
        state: '',
        state_kind: null,
        exit: { code: 0, signal: null },
        name: 'zsh',
        dir: '/r/other'
      },
      {
        pty: 'p-j',
        kind: 'job',
        workspace: 'other',
        cell: 'c-5',
        state: 'idle',
        state_kind: null,
        exit: null,
        name: 'dev',
        dir: '/r/other/app'
      },
      {
        pty: 'p-k',
        kind: 'job',
        workspace: 'ai-maru',
        cell: 'c-2',
        state: '',
        state_kind: null,
        exit: { code: null, signal: 15 },
        name: 'sleep 600',
        dir: ''
      }
    ])
  })

  it('창에 없는 cell 의 job 은 WORKSPACE 를 비우고 싣는다', () => {
    const rows = ptyRows(
      [],
      [{ pty: 'p-j', cell: 'c-9', command: ['sleep', '600'] }],
      () => undefined,
      () => null,
      '/bin/zsh'
    )
    expect(rows.map((r) => [r.pty, r.kind, r.workspace, r.cell])).toEqual([
      ['p-j', 'job', '', 'c-9']
    ])
  })
})
