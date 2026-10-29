import { describe, expect, it } from 'vitest'
import { paneRows } from './pane-list'
import type { ProgramStatusRecord } from './program-status'
import type { PtyCommand, PtyState } from './pty-state'
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

function state(records: ProgramStatusRecord[], command: PtyCommand | null = null): PtyState {
  return { cwd: null, cwdReports: 0, title: null, foregroundCwd: null, command, records }
}

function cell(
  key: number,
  panes: ScreenPane[],
  focused = panes[0].key
): ScreenWorkspace['cells'][number] {
  return { key, id: `c-${key}`, panes, focused, layout: { pane: panes[0].key } }
}

const one = (pane: Omit<ScreenPane, 'key'>) => [
  { key: 1, id: 'w-1', cells: [cell(2, [{ key: 3, ...pane }])] }
]

const git = (branch: string) => ({ repo: 'ai-maru', branch })

const SHELL = '/bin/zsh'

describe('paneRows', () => {
  it('모든 pane 을 화면 순서대로, 사이드바와 같은 이름으로 돌려주고 dir 은 cwd 가 없으면 시작 디렉토리다', () => {
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
              { key: 7, ptyId: 'p-b', cwd: '/r/wt/app', git: git('feat/x'), title: 'fix it' }
            ],
            7
          )
        ]
      },
      { key: 8, id: 'w-8', cells: [cell(9, [{ key: 10, ptyId: 'p-c', startDir: '/tmp/notes' }])] }
    ]
    const states = new Map([
      ['p-a', state([record('claude-code', { message: 'reading' })])],
      ['p-other', state([record('codex')])],
      [
        'p-b',
        state([record('claude-code', { state: 'blocked', kind: 'permission', message: 'Bash' })])
      ],
      ['p-c', state([record('claude-code', { state: 'idle' })])]
    ])
    expect(paneRows(workspaces, (pty) => states.get(pty), SHELL)).toEqual([
      {
        pty: 'p-a',
        state: 'working',
        kind: null,
        app: 'claude-code',
        workspace: 'ai-maru',
        cell: 'ai-maru main',
        title: 'Claude',
        dir: '/r/ai-maru',
        message: 'reading'
      },
      {
        pty: 'p-shell',
        state: '',
        kind: null,
        app: '',
        workspace: 'ai-maru',
        cell: 'ai-maru main',
        title: 'zsh',
        dir: '/r/ai-maru',
        message: ''
      },
      {
        pty: 'p-other',
        state: 'working',
        kind: null,
        app: 'codex',
        workspace: 'ai-maru',
        cell: 'ai-maru feat/x',
        title: 'codex',
        dir: '/r/wt',
        message: ''
      },
      {
        pty: 'p-b',
        state: 'blocked',
        kind: 'permission',
        app: 'claude-code',
        workspace: 'ai-maru',
        cell: 'ai-maru feat/x',
        title: 'fix it',
        dir: '/r/wt/app',
        message: 'Bash'
      },
      {
        pty: 'p-c',
        state: 'idle',
        kind: null,
        app: 'claude-code',
        workspace: 'Shell',
        cell: 'Shell',
        title: 'Claude',
        dir: '/tmp/notes',
        message: ''
      }
    ])
  })

  it('상태를 모르는 pane 도 빈 STATE·APP·MESSAGE 로 들고, 이름은 명령이나 셸이다', () => {
    const workspaces = [
      {
        key: 1,
        id: 'w-1',
        cells: [
          cell(2, [
            { key: 3, ptyId: 'p-a' },
            { key: 4, ptyId: 'p-b', command: ['/usr/bin/top', '-o', 'cpu'] }
          ])
        ]
      }
    ]
    const rows = paneRows(workspaces, () => undefined, SHELL)
    expect(rows.map((r) => [r.pty, r.state, r.kind, r.app, r.title, r.message])).toEqual([
      ['p-a', '', null, '', 'zsh', ''],
      ['p-b', '', null, '', 'top', '']
    ])
  })

  it('cwd 도 시작 디렉토리도 모르는 pane 의 dir 은 빈 문자열이고, 셸을 모르면 이름은 sh 다', () => {
    const rows = paneRows(one({ ptyId: 'p-a' }), () => undefined, undefined)
    expect(rows.map((r) => [r.workspace, r.cell, r.dir, r.title])).toEqual([
      ['Shell', 'Shell', '', 'sh']
    ])
  })

  it('레코드가 없는 pane 의 이름은 보일 명령, 터미널 제목, 셸 순서다', () => {
    const running = { running: true, text: 'npm run dev', exitCode: null, startedAt: 1 }
    const failed = { running: false, text: 'cargo test', exitCode: 101, startedAt: 1 }
    const passed = { ...failed, exitCode: 0 }
    const name = (pane: Omit<ScreenPane, 'key'>, command: PtyCommand | null) =>
      paneRows(one(pane), () => state([], command), SHELL)[0].title
    expect(name({ ptyId: 'p-a', title: 'user@mac' }, running)).toBe('npm run dev')
    expect(name({ ptyId: 'p-a', title: 'user@mac' }, failed)).toBe('cargo test')
    expect(name({ ptyId: 'p-a', title: 'user@mac' }, passed)).toBe('user@mac')
    expect(name({ ptyId: 'p-a' }, passed)).toBe('zsh')
  })

  it('레코드가 있는 pane 의 이름은 터미널 제목이나 프로그램 이름이고, 도는 명령은 쓰지 않는다', () => {
    const running = { running: true, text: 'claude', exitCode: null, startedAt: 1 }
    const name = (pane: Omit<ScreenPane, 'key'>, app: string) =>
      paneRows(one(pane), () => state([record(app)], running), SHELL)[0].title
    expect(name({ ptyId: 'p-a', title: 'Refactor' }, 'claude-code')).toBe('Refactor')
    expect(name({ ptyId: 'p-a' }, 'claude-code')).toBe('Claude')
    expect(name({ ptyId: 'p-a' }, '')).toBe('Program')
  })

  it('message 가 비어도 레코드의 title 로 채우지 않는다', () => {
    const rows = paneRows(
      one({ ptyId: 'p-a' }),
      () => state([record('claude-code', { state: 'blocked', title: 'Bash' })]),
      SHELL
    )
    expect(rows.map((r) => [r.state, r.message])).toEqual([['blocked', '']])
  })

  it('홈 디렉토리 workspace 의 WORKSPACE 는 사이드바처럼 ~ 다', () => {
    const workspaces = [
      { key: 1, id: 'w-1', cells: [cell(2, [{ key: 3, ptyId: 'p-a', cwd: '/h/u' }])] },
      { key: 4, id: 'w-4', cells: [cell(5, [{ key: 6, ptyId: 'p-b', cwd: '/h/u/notes' }])] }
    ]
    const rows = paneRows(workspaces, () => undefined, SHELL, '/h/u')
    expect(rows.map((r) => [r.pty, r.workspace])).toEqual([
      ['p-a', '~'],
      ['p-b', 'notes']
    ])
  })

  it('CELL 은 cell 의 focused pane 기준이고 DIR 은 pane 자신의 cwd 다', () => {
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
    const rows = paneRows(workspaces, () => undefined, SHELL)
    expect(rows.map((r) => [r.pty, r.workspace, r.cell, r.dir])).toEqual([
      ['p-a', 'ai-maru', 'ai-maru feat/b', '/r/wt-a'],
      ['p-b', 'ai-maru', 'ai-maru feat/b', '/r/wt-b']
    ])
  })

  it('루트 레코드 없이 하위 레코드만 있는 pane 은 레코드가 없는 pane 처럼 빈 STATE·APP 이다', () => {
    const rows = paneRows(
      one({ ptyId: 'p-a' }),
      () => state([record('claude-code', { id: 'sub', state: 'blocked' })]),
      SHELL
    )
    expect(rows.map((r) => [r.state, r.app, r.title])).toEqual([['', '', 'zsh']])
  })

  it('claude 의 루트가 done 이고 하위가 blocked 면 하위의 상태·kind·메시지를 낸다', () => {
    const records = [
      record('claude-code', { state: 'done', message: 'finished' }),
      record('', { id: 'ask', state: 'blocked', kind: 'question', message: 'Which one?' })
    ]
    const rows = paneRows(one({ ptyId: 'p-a' }), () => state(records), SHELL)
    expect(rows.map((r) => [r.state, r.kind, r.app, r.message])).toEqual([
      ['blocked', 'question', 'claude-code', 'Which one?']
    ])
  })

  it('APP 은 보일 레코드가 하위여도 루트의 app 이다', () => {
    const states = new Map([
      [
        'p-a',
        state([
          record('claude-code', { state: 'done' }),
          record('cargo', { id: 'build', state: 'error' })
        ])
      ],
      [
        'p-b',
        state([
          record('codex', { state: 'idle' }),
          record('claude-code', { id: 'ask', state: 'blocked' })
        ])
      ]
    ])
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
    const rows = paneRows(workspaces, (pty) => states.get(pty), SHELL)
    expect(rows.map((r) => [r.pty, r.state, r.app])).toEqual([
      ['p-a', 'error', 'claude-code'],
      ['p-b', 'blocked', 'codex']
    ])
  })
})
