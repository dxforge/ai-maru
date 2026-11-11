import { describe, expect, it } from 'vitest'
import type { JobView } from '../../../shared/job'
import type { CommandView } from '../../../shared/pane-name'
import { CLAUDE_APP, type ProgramStatusRecord } from '../../../shared/program-status'
import type { PtyNotification } from '../../../shared/pty-state'
import { dirCard, jobSection, paneSection, workspaceCard } from './sidebarCard'
import { dirRow, paneRow } from './sidebarRows'

const MIN = 60_000

function pane(
  o: { record?: ProgramStatusRecord; command?: CommandView; notice?: PtyNotification; cwd?: string } = {}
) {
  const p = { key: 7, id: 'n-7', ptyId: 'p-7', title: 'vim', ...(o.cwd && { cwd: o.cwd }) }
  const r = paneRow(
    { shown: () => o.record, command: () => o.command, notification: () => o.notice, home: '/Users/me' },
    p,
    false,
    p
  )
  return r
}

const record = (o: Partial<ProgramStatusRecord> = {}): ProgramStatusRecord => ({
  id: '',
  state: 'working',
  kind: null,
  progress: null,
  app: CLAUDE_APP,
  title: '',
  message: '',
  ...o
})

describe('paneSection', () => {
  it('셸 pane 은 사이드바 줄의 아이콘과 이름·경로만 쓴다', () => {
    expect(paneSection(pane({ cwd: '/Users/me/src/app' }), undefined, undefined, 0)).toEqual({
      key: 'pane:7',
      title: 'vim',
      icon: { command: 'terminal' },
      path: '~/src/app'
    })
  })

  it('아이콘과 색 class 는 사이드바 줄과 같다', () => {
    const rec = record({ state: 'blocked' })
    const r = pane({ record: rec })
    expect(paneSection(r, undefined, rec, 0)).toMatchObject({ icon: r.icon, tone: 'blocked' })
    const failed: CommandView = { running: false, text: 'make', exitCode: 2 }
    expect(paneSection(pane({ command: failed }), undefined, undefined, 0)).toMatchObject({
      icon: { command: 'failed' },
      tone: 'command-failed'
    })
  })

  it('repo·branch 를 한 줄로 잇고, 경로에 있는 sub 와 없는 칸은 뺀다', () => {
    const r = pane({ cwd: '/Users/me/src/app/core' })
    expect(paneSection(r, { repo: 'app', branch: 'main', sub: 'core' }, undefined, 0).git).toBe(
      'app · main'
    )
    expect(paneSection(r, { repo: 'app' }, undefined, 0).git).toBe('app')
  })

  it('프로그램 상태는 메시지만 쓰고, 메시지가 없으면 두지 않는다', () => {
    const rec = record({ state: 'blocked', message: 'Allow Bash?' })
    expect(paneSection(pane({ record: rec }), undefined, rec, 0).message).toBe('Allow Bash?')
    const quiet = record()
    expect(paneSection(pane({ record: quiet }), undefined, quiet, 0)).not.toHaveProperty('message')
  })

  it('도는 명령은 돈 시간을, 시작 시각을 모르면 Running 만 쓴다', () => {
    const run: CommandView = { running: true, text: 'sleep 30', startedAt: 0 }
    expect(paneSection(pane({ command: run }), undefined, undefined, 3 * MIN).command).toEqual({
      running: true,
      text: 'Running for 3m'
    })
    const unknown: CommandView = { running: true, text: 'sleep 30' }
    expect(paneSection(pane({ command: unknown }), undefined, undefined, 3 * MIN).command).toEqual({
      running: true,
      text: 'Running'
    })
  })

  it('실패한 명령은 종료 코드를 쓴다', () => {
    const failed: CommandView = { running: false, text: 'make', exitCode: 2 }
    expect(paneSection(pane({ command: failed }), undefined, undefined, 0).command).toEqual({
      running: false,
      text: 'Exited with code 2'
    })
  })

  it('읽지 않은 알림은 제목과 본문을 함께 쓴다', () => {
    const notice = { title: 'Done', body: 'Tests pass' } as PtyNotification
    expect(paneSection(pane({ notice }), undefined, undefined, 0).notice).toBe('Done: Tests pass')
  })
})

describe('jobSection', () => {
  const job = (o: Partial<JobView> = {}): JobView => ({
    pty: 'p-9',
    cell: 'c-1',
    command: ['pnpm', 'dev'],
    ports: [],
    ...o
  })

  it('도는 job 은 명령 전체와 돈 시간·포트를 쓴다', () => {
    expect(jobSection(job({ name: 'web', started: 0, ports: [5173, 5174] }), 3 * MIN)).toEqual({
      key: 'job:p-9',
      title: 'web',
      icon: 'job',
      run: 'pnpm dev',
      time: 'Running for 3m · :5173 · :5174'
    })
  })

  it('시작 시각을 모르면 Running 만 쓴다', () => {
    expect(jobSection(job(), 0).time).toBe('Running')
  })

  it('끝난 job 은 종료 코드나 signal 을 쓴다', () => {
    expect(jobSection(job({ exit: { code: 3, signal: null } }), 0).time).toBe('Exited with code 3')
    expect(jobSection(job({ exit: { code: 0, signal: 15 } }), 0).time).toBe('Killed by signal 15')
  })
})

describe('workspaceCard', () => {
  const ws = { name: 'app', auto: 'app', dir: '~/src/app', cells: 1, jobs: 0 }

  it('이름을 바꿨으면 자동 이름을 쓴다', () => {
    const view = workspaceCard({ ...ws, name: 'mine', states: [] })
    expect(view.sections[0]).toEqual({
      key: 'workspace',
      title: 'mine',
      note: 'Default name: app',
      path: '~/src/app'
    })
    expect(workspaceCard({ ...ws, states: [] }).sections[0].note).toBeUndefined()
  })

  it('상태별 pane 수를 급한 순서로 쓴다', () => {
    const view = workspaceCard({ ...ws, states: ['working', undefined, 'blocked', 'working'] })
    expect(view.foot).toEqual({
      states: [
        { state: 'blocked', text: '1 Blocked' },
        { state: 'working', text: '2 Working' }
      ],
      counts: '1 cell · 4 panes'
    })
  })

  it('상태가 없으면 수만 쓰고, job 이 있으면 job 수도 쓴다', () => {
    expect(workspaceCard({ ...ws, cells: 2, jobs: 1, states: [undefined] }).foot).toEqual({
      counts: '2 cells · 1 pane · 1 job'
    })
    expect(workspaceCard({ ...ws, cells: 1, jobs: 2, states: [] }).foot?.counts).toBe(
      '1 cell · 0 panes · 2 jobs'
    )
  })
})

describe('dirCard', () => {
  it('이름과 경로를 쓰고 띠에 열린 cell 이 없다고 쓴다', () => {
    expect(dirCard(dirRow('/Users/me/src/app', '/Users/me'))).toEqual({
      sections: [{ key: 'dir', title: 'app', path: '~/src/app' }],
      foot: { counts: 'No open cells' }
    })
  })
})
