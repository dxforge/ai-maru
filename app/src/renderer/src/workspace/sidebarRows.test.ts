import { describe, expect, it } from 'vitest'
import type { JobView } from '../../../shared/job'
import type { CommandView } from '../../../shared/pane-name'
import {
  CLAUDE_APP,
  type ProgramStatusRecord,
  type ProgramStatusState
} from '../../../shared/program-status'
import type { PtyNotification } from '../../../shared/pty-state'
import {
  dirRow,
  emptyRows,
  exitText,
  favoriteRow,
  favoriteRows,
  jobRow,
  paneRow,
  workspaceMarks,
  type RowSource
} from './sidebarRows'

const pane = { key: 1, id: 'n-1', ptyId: 'p-1', title: 'vim' }

function record(state: ProgramStatusState, app = CLAUDE_APP): ProgramStatusRecord {
  return { id: '', state, kind: null, progress: null, app, title: '', message: '' }
}

function source(
  o: {
    record?: ProgramStatusRecord
    command?: CommandView
    notice?: PtyNotification
    tasks?: ProgramStatusRecord[]
  } = {}
): RowSource {
  return {
    shown: () => o.record,
    command: () => o.command,
    notification: () => o.notice,
    tasks: () => o.tasks ?? []
  }
}

const row = (o: Parameters<typeof source>[0] = {}) => paneRow(source(o), pane, false, pane)

describe('paneRow', () => {
  it('도는 백그라운드 일이 있을 때만 tasks 를 둔다', () => {
    const task = { ...record('working'), id: 'a1', title: 'Explore the code' }
    expect(row({ record: record('working'), tasks: [task] }).tasks).toEqual([task])
    expect(row({ record: record('working') })).not.toHaveProperty('tasks')
  })

  it('agent 가 쉬는 동안은 앞 칸에 agent 아이콘을 둔다', () => {
    expect(row({ record: record('idle') }).icon).toEqual({ agent: 'claude' })
  })

  it('agent 표에 없는 app 이 쉬면 상태 아이콘을 둔다', () => {
    expect(row({ record: record('idle', 'constructor') }).icon).toEqual({ state: 'idle' })
  })

  it('쉬지 않는 agent 는 상태 아이콘을 둔다', () => {
    expect(row({ record: record('working') }).icon).toEqual({ state: 'working' })
  })

  it('상태가 없는 pane 은 명령에 따라 셸·도는 중·실패 아이콘을 둔다', () => {
    expect(row().icon).toEqual({ command: 'terminal' })
    const running: CommandView = { running: true, text: 'make' }
    expect(row({ command: running }).icon).toEqual({ command: 'running' })
    const failed: CommandView = { running: false, text: 'make', exitCode: 2 }
    expect(row({ command: failed }).icon).toEqual({ command: 'failed' })
  })

  it('알림이 있으면 줄 글은 알림의 본문(없으면 제목)이고, 화면 낭독에 알림을 붙인다', () => {
    const plain = row()
    expect(plain.text).toBe(plain.name)
    expect(plain.aria).toBe(plain.name)

    const titled = row({ notice: { title: 'Deploy', body: 'ok' } })
    expect(titled.text).toBe('ok')
    expect(titled.aria).toBe(`${titled.name}. Notification: Deploy: ok`)

    const bodyOnly = row({ notice: { title: '', body: 'build done' } })
    expect(bodyOnly.text).toBe('build done')
    expect(bodyOnly.aria).toBe(`${bodyOnly.name}. Notification: build done`)

    const titleOnly = row({ notice: { title: 'Deploy', body: '' } })
    expect(titleOnly.text).toBe('Deploy')
    expect(titleOnly.aria).toBe(`${titleOnly.name}. Notification: Deploy`)
  })

  it('글 없는 알림은 줄 글을 pane 이름으로 두고 점만 달며, 화면 낭독에는 알림이 있다는 것만 붙인다', () => {
    const r = row({ notice: { title: '', body: '' } })
    expect(r.notice).toEqual({ title: '', body: '' })
    expect(r.text).toBe(r.name)
    expect(r.aria).toBe(`${r.name}. Notification`)
  })

  it('상태가 있으면 화면 낭독은 상태 이름으로, 명령만 있으면 명령의 상태로 시작한다', () => {
    const r = row({ record: record('blocked') })
    expect(r.aria).toBe(`Blocked: ${r.name}`)
    const failed: CommandView = { running: false, text: 'make', exitCode: 2 }
    expect(row({ command: failed }).aria).toBe('Exited with code 2: make')
  })

  describe('위치', () => {
    const home = '/Users/me'
    const shell = { key: 2, id: 'n-2', ptyId: 'p-2', cwd: '/Users/me/proj' }
    const base = { key: 1, id: 'n-1', ptyId: 'p-1', cwd: home }
    const at = (p: typeof shell & { command?: string[] }, command?: CommandView) =>
      paneRow({ ...source({ command }), home }, p, false, base)
    const running: CommandView = { running: true, text: 'make' }

    it('cwd 가 있으면 줄 끝에 위치를, 툴팁에 쓸 경로를 ~ 로 쓰고, 화면 낭독에 위치를 붙인다', () => {
      const r = at(shell)
      expect(r.place).toEqual({ name: 'proj' })
      expect(r.path).toBe('~/proj')
      expect(r.commandTail).toBe(false)
      expect(r.aria).toBe(`${r.name}, proj`)
    })

    it('셸 pane 에 명령이 돌면 위치 대신 명령의 꼬리를 쓴다', () => {
      const r = at(shell, running)
      expect(r.commandTail).toBe(true)
      expect(r.place).toBeUndefined()
    })

    it('base 가 없으면(바꾼 이름이 있는 workspace) 같은 저장소의 pane 도 저장소 이름을 온전히 쓴다', () => {
      const repo = { repo: 'ai-maru', branch: 'feat/x', common: '/r/ai-maru/.git', sub: '' }
      const wt = { key: 2, id: 'n-2', ptyId: 'p-2', cwd: '/r/wt', git: repo }
      const first = { ...base, cwd: '/r/ai-maru', git: { ...repo, branch: 'main' } }
      expect(paneRow(source(), wt, false, first).place).toEqual({ branch: 'feat/x' })
      expect(paneRow(source(), wt, false, undefined).place).toEqual({
        name: 'ai-maru',
        branch: 'feat/x'
      })
    })

    it('명령 pane 은 명령이 돌아도 위치를 쓴다', () => {
      const r = at({ ...shell, command: ['make'] }, running)
      expect(r.commandTail).toBe(false)
      expect(r.place).toEqual({ name: 'proj' })
    })
  })
})

describe('exitText', () => {
  it('시그널로 끝났으면 시그널을, 아니면 종료 코드를 쓴다', () => {
    expect(exitText({ code: null, signal: 9 })).toBe('Killed by signal 9')
    expect(exitText({ code: 1, signal: null })).toBe('Exited with code 1')
  })
})

describe('jobRow', () => {
  const job: JobView = { pty: 'p-2', cell: 'c-1', command: ['sleep', '600'], ports: [] }

  it('끝난 job 은 끝났다고 표시한다', () => {
    expect(jobRow(job).exited).toBe(false)
    expect(jobRow({ ...job, exit: { code: null, signal: 9 } }).exited).toBe(true)
  })

  it('이름이 없으면 명령을 이름으로 쓰고, 포트는 :포트 로 잇는다', () => {
    expect(jobRow(job).text).toBe('sleep 600')
    expect(jobRow({ ...job, name: 'dev' }).text).toBe('dev')
    expect(jobRow({ ...job, ports: [3000, 5173] }).ports).toBe(':3000 :5173')
  })
})

describe('workspaceMarks', () => {
  it('펼친 workspace 는 아무것도 붙이지 않는다', () => {
    expect(workspaceMarks(false, 'blocked', true)).toEqual({ notified: false, dot: false })
  })

  it('접은 workspace 는 상태 아이콘을 보이고, 읽지 않은 알림은 그 아이콘에 점을 단다', () => {
    expect(workspaceMarks(true, 'blocked', true)).toEqual({
      state: 'blocked',
      notified: true,
      dot: false
    })
  })

  it('접은 workspace 에 상태가 없으면 읽지 않은 알림은 이름 뒤 점이다', () => {
    expect(workspaceMarks(true, undefined, true)).toEqual({
      state: undefined,
      notified: true,
      dot: true
    })
    expect(workspaceMarks(true, undefined, false)).toEqual({
      state: undefined,
      notified: false,
      dot: false
    })
  })
})

describe('dirRow', () => {
  it('이름은 디렉토리 이름, 경로는 홈을 ~ 로 줄이고, 홈 디렉토리의 이름은 ~ 다', () => {
    expect(dirRow('/h/notes', '/h')).toEqual({ dir: '/h/notes', name: 'notes', path: '~/notes' })
    expect(dirRow('/opt/x', '/h')).toEqual({ dir: '/opt/x', name: 'x', path: '/opt/x' })
    expect(dirRow('/h', '/h')).toEqual({ dir: '/h', name: '~', path: '~' })
  })
})

describe('favoriteRow', () => {
  it('workspace 디렉토리 아래면 path 는 그로부터의 상대 경로이고, 밖이거나 이름만 같으면 ~ 경로다', () => {
    expect(favoriteRow('/h/r2/backend', '/h/r2/', '/h')).toEqual({
      dir: '/h/r2/backend',
      name: 'backend',
      path: 'backend'
    })
    expect(favoriteRow('/h/r2/a/b', '/h/r2', '/h').path).toBe('a/b')
    expect(favoriteRow('/h/r2x/a', '/h/r2', '/h').path).toBe('~/r2x/a')
    expect(favoriteRow('/h/r2', '/h/r2', '/h').path).toBe('~/r2')
    expect(favoriteRow('/opt/x', undefined, '/h').path).toBe('/opt/x')
  })
})

describe('favoriteRows', () => {
  const names = (dirs: string[]) => favoriteRows(dirs, '/h/w', '/h').map((r) => r.path)

  it('추가한 순서와 상관없이 이름순이고, 대소문자를 가리지 않는다', () => {
    expect(names(['/h/w/beta', '/h/w/Alpha', '/h/w/gamma'])).toEqual(['Alpha', 'beta', 'gamma'])
    expect(names(['/h/w/gamma', '/h/w/beta', '/h/w/Alpha'])).toEqual(['Alpha', 'beta', 'gamma'])
  })

  it('대소문자·악센트만 다른 두 디렉토리도 추가한 순서와 상관없이 같은 자리에 둔다', () => {
    expect(names(['/h/w/app', '/h/w/App'])).toEqual(names(['/h/w/App', '/h/w/app']))
    expect(names(['/h/w/cafe', '/h/w/café'])).toEqual(names(['/h/w/café', '/h/w/cafe']))
  })

  it('이름의 숫자는 숫자 크기로 비교한다', () => {
    expect(names(['/h/w/r10', '/h/w/r2', '/h/w/r1'])).toEqual(['r1', 'r2', 'r10'])
  })

  it('이름이 같으면 보이는 경로로 가른다', () => {
    expect(names(['/h/w/b/app', '/opt/app', '/h/w/a/app'])).toEqual(['/opt/app', 'a/app', 'b/app'])
  })

  it('넘긴 배열의 순서를 바꾸지 않는다', () => {
    const dirs = ['/h/w/b', '/h/w/a']
    favoriteRows(dirs, '/h/w', '/h')
    expect(dirs).toEqual(['/h/w/b', '/h/w/a'])
  })
})

describe('emptyRows', () => {
  it('즐겨찾기가 없으면 디렉토리 줄 하나이고, 디렉토리도 없으면 없다', () => {
    expect(emptyRows(0, dirRow('/h/notes', '/h'), [], '/h')).toEqual([
      { dir: '/h/notes', name: 'notes', path: '~/notes', label: '~/notes', root: true }
    ])
    expect(emptyRows(0, undefined, [])).toEqual([])
  })

  it('디렉토리를 모르면 즐겨찾기가 있어도 줄이 없다', () => {
    expect(emptyRows(0, undefined, favoriteRows(['/h/x'], undefined, '/h'), '/h')).toEqual([])
  })

  it('cell 이 있으면 줄이 없다', () => {
    const favorites = favoriteRows(['/h/notes/x'], '/h/notes', '/h')
    expect(emptyRows(1, dirRow('/h/notes', '/h'), favorites, '/h')).toEqual([])
  })

  it('디렉토리 줄 아래에 즐겨찾기를 받은 순서로 두고, 줄 글자는 디렉토리 아래면 상대 경로, tooltip 경로는 ~ 경로다', () => {
    const favorites = favoriteRows(['/h/w/b', '/opt/a', '/h/w', '/h/w/A'], '/h/w', '/h')
    const rows = emptyRows(0, dirRow('/h/w', '/h'), favorites, '/h')
    expect(rows.map((r) => [r.label, r.path, r.root])).toEqual([
      ['~/w', '~/w', true],
      ['/opt/a', '/opt/a', false],
      ['A', '~/w/A', false],
      ['b', '~/w/b', false],
      ['~/w', '~/w', false]
    ])
  })
})
