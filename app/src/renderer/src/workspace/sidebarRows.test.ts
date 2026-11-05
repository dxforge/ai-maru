import { describe, expect, it } from 'vitest'
import type { JobView } from '../../../shared/job'
import type { CommandView } from '../../../shared/pane-name'
import {
  CLAUDE_APP,
  type ProgramStatusRecord,
  type ProgramStatusState
} from '../../../shared/program-status'
import type { PtyNotification } from '../../../shared/pty-state'
import { ICONS } from '../icons'
import {
  closedRows,
  exitText,
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
  o: { record?: ProgramStatusRecord; command?: CommandView; notice?: PtyNotification } = {}
): RowSource {
  return {
    shown: () => o.record,
    command: () => o.command,
    notification: () => o.notice
  }
}

const row = (o: Parameters<typeof source>[0] = {}) => paneRow(source(o), pane, false, pane)

describe('paneRow', () => {
  it('agent 가 쉬는 동안은 앞 칸에 agent 아이콘을 둔다', () => {
    expect(row({ record: record('idle') }).icon).toEqual({ agent: ICONS.claude })
  })

  it('agent 표에 없는 app 이 쉬면 상태 아이콘을 둔다', () => {
    expect(row({ record: record('idle', 'constructor') }).icon).toEqual({ state: 'idle' })
  })

  it('쉬지 않는 agent 는 상태 아이콘을 둔다', () => {
    expect(row({ record: record('working') }).icon).toEqual({ state: 'working' })
  })

  it('상태가 없는 pane 은 명령에 따라 셸·도는 중·실패 글리프를 둔다', () => {
    expect(row().icon).toEqual({ glyph: ICONS.terminal })
    const running: CommandView = { running: true, text: 'make' }
    expect(row({ command: running }).icon).toEqual({ glyph: ICONS.running })
    const failed: CommandView = { running: false, text: 'make', exitCode: 2 }
    expect(row({ command: failed }).icon).toEqual({ glyph: ICONS.error })
  })

  it('알림이 있으면 줄 글은 알림의 제목(없으면 본문)이고, 화면 낭독에 알림을 붙인다', () => {
    const plain = row()
    expect(plain.text).toBe(plain.name)
    expect(plain.aria).toBe(plain.name)

    const titled = row({ notice: { title: 'Deploy', body: 'ok' } })
    expect(titled.text).toBe('Deploy')
    expect(titled.aria).toBe(`${titled.name}. Notification: Deploy: ok`)

    const bodyOnly = row({ notice: { title: '', body: 'build done' } })
    expect(bodyOnly.text).toBe('build done')
    expect(bodyOnly.aria).toBe(`${bodyOnly.name}. Notification: build done`)
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

  it('툴팁은 명령이고, 끝난 job 은 끝난 까닭을 다음 줄에 붙인다', () => {
    expect(jobRow(job).tip).toBe('sleep 600')
    expect(jobRow(job).exited).toBe(false)
    const exited = jobRow({ ...job, exit: { code: null, signal: 9 } })
    expect(exited.tip).toBe('sleep 600\nKilled by signal 9')
    expect(exited.exited).toBe(true)
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

describe('closedRows', () => {
  it('열린 cell 이 맡지 않은 즐겨찾기를 넣은 순서대로 내고, 이름은 디렉토리 이름, 경로는 홈을 ~ 로 줄인다', () => {
    const favorites = ['/h/work/app', '/h/notes', '/opt/x']
    const cells = [{}, { favorite: '/h/work/app/' }]
    expect(closedRows({ dir: '/h/old', favorites, cells }, '/h')).toEqual([
      { dir: '/h/notes', name: 'notes', path: '~/notes', favorite: true },
      { dir: '/opt/x', name: 'x', path: '/opt/x', favorite: true }
    ])
  })

  it('홈 디렉토리의 이름은 ~ 다', () => {
    expect(closedRows({ favorites: ['/h'], cells: [] }, '/h')).toEqual([
      { dir: '/h', name: '~', path: '~', favorite: true }
    ])
  })

  it('cell 도 즐겨찾기도 없으면 dir 줄 하나이고, dir 도 없으면 없다', () => {
    expect(closedRows({ dir: '/h/notes', cells: [] }, '/h')).toEqual([
      { dir: '/h/notes', name: 'notes', path: '~/notes', favorite: false }
    ])
    expect(closedRows({ cells: [] })).toEqual([])
  })

  it('cell 이 있으면 dir 줄은 없다', () => {
    expect(closedRows({ dir: '/h/notes', cells: [{}] })).toEqual([])
  })
})
