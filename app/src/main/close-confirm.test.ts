import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closePaneDialog,
  createQuitPermission,
  runningDialog,
  runningPanes,
  runningProgram,
  stopJobDialog,
  type ProgramDeps
} from './close-confirm'
import type { PtyCommand } from '../shared/pty-state'

const SHELL = 100

function deps(
  fg: Record<string, { pid: number; name: string | null }>,
  commands: Record<string, PtyCommand> = {}
): ProgramDeps {
  return {
    foreground: vi.fn(async (pty: string) => {
      const f = fg[pty]
      if (!f) throw new Error(`pty ${pty} is not running`)
      return { ...f, cwd: '/w' }
    }),
    shellPid: async (pty: string) => (pty === 'p-norecord' ? null : SHELL),
    command: (pty: string) => commands[pty] ?? null
  }
}

const command = (running: boolean, text: string | null): PtyCommand => ({
  running,
  text,
  exitCode: null,
  startedAt: 1
})

describe('runningProgram', () => {
  it('foreground 가 셸이면 실행 중이 아니고, 다른 프로세스면 그 이름으로 실행 중이다', async () => {
    const d = deps({ 'p-1': { pid: SHELL, name: 'bash' }, 'p-2': { pid: 7, name: 'vim' } })
    expect(await runningProgram({ ptyId: 'p-1' }, d)).toBeNull()
    expect(await runningProgram({ ptyId: 'p-2' }, d)).toEqual({ name: 'vim' })
  })

  it('이름을 모르는 옛 maru-pty 면 이름 없이 실행 중이다', async () => {
    const d = deps({ 'p-1': { pid: 7, name: null } })
    expect(await runningProgram({ ptyId: 'p-1' }, d)).toEqual({ name: null })
  })

  it('셸이 알린 명령이 도는 중이면 foreground 이름 대신 그 명령으로 실행 중이다', async () => {
    const d = deps(
      { 'p-1': { pid: 7, name: 'node' }, 'p-2': { pid: 7, name: 'node' } },
      { 'p-1': command(true, 'npm run dev'), 'p-2': command(true, null) }
    )
    expect(await runningProgram({ ptyId: 'p-1' }, d)).toEqual({ name: 'npm run dev' })
    expect(await runningProgram({ ptyId: 'p-2' }, d)).toEqual({ name: 'node' })
  })

  it('셸이 알린 명령 상태는 실행 중인지를 바꾸지 않는다', async () => {
    const d = deps(
      { 'p-1': { pid: SHELL, name: 'zsh' }, 'p-2': { pid: 7, name: 'vim' } },
      { 'p-1': command(true, 'slow_function'), 'p-2': command(false, 'old') }
    )
    expect(await runningProgram({ ptyId: 'p-1' }, d)).toBeNull()
    expect(await runningProgram({ ptyId: 'p-2' }, d)).toEqual({ name: 'vim' })
  })

  it('명령 pane 은 foreground 를 묻지 않고, maru-pty 가 준 명령 텍스트(없으면 명령 전체)로 실행 중이다', async () => {
    const d = deps({ 'p-1': { pid: SHELL, name: 'bash' } })
    expect(await runningProgram({ ptyId: 'p-1', command: ['npm', 'run', 'dev'] }, d)).toEqual({
      name: 'npm run dev'
    })
    const withState = deps({}, { 'p-2': command(true, 'from-pty') })
    expect(await runningProgram({ ptyId: 'p-2', command: ['npm'] }, withState)).toEqual({
      name: 'from-pty'
    })
    expect(d.foreground).not.toHaveBeenCalled()
  })

  it('명령 pane 은 maru-pty 가 명령이 끝났다고 알렸으면 실행 중이 아니다', async () => {
    const d = deps({}, { 'p-1': { ...command(false, 'claude'), exitCode: 3 } })
    expect(await runningProgram({ ptyId: 'p-1', command: ['claude'] }, d)).toBeNull()
    expect(d.foreground).not.toHaveBeenCalled()
  })

  it('빈 명령은 명령 pane 이 아니다', async () => {
    const d = deps({ 'p-1': { pid: SHELL, name: 'bash' } })
    expect(await runningProgram({ ptyId: 'p-1', command: [] }, d)).toBeNull()
  })

  it('pty 에 닿지 못하거나 레코드가 없으면 실행 중이 아니다', async () => {
    const d = deps({ 'p-norecord': { pid: 7, name: 'vim' } })
    expect(await runningProgram({ ptyId: 'p-gone' }, d)).toBeNull()
    expect(await runningProgram({ ptyId: 'p-norecord' }, d)).toBeNull()
  })
})

describe('runningPanes', () => {
  it('프로그램이 도는 pane 수를 센다', async () => {
    const d = deps({
      'p-1': { pid: SHELL, name: 'bash' },
      'p-2': { pid: 7, name: 'vim' },
      'p-3': { pid: SHELL, name: 'bash' }
    })
    const panes = [{ ptyId: 'p-1' }, { ptyId: 'p-2' }, { ptyId: 'p-3', command: ['sleep', '9'] }]
    expect(await runningPanes(panes, d)).toBe(2)
  })
})

describe('확인 창', () => {
  it('pane 은 이름이 있으면 이름을, 없으면 일반 문구를 적는다', () => {
    expect(closePaneDialog('vim')).toEqual({
      message: 'Close this pane?',
      detail: '`vim` is still running.',
      buttons: ['Close', 'Cancel']
    })
    expect(closePaneDialog(null).detail).toBe('A program is still running in it.')
  })

  it('job 을 끌 때는 그 이름으로 묻는다', () => {
    expect(stopJobDialog('dev')).toEqual({
      message: 'Stop this job?',
      detail: '`dev` is still running.',
      buttons: ['Stop', 'Cancel']
    })
  })

  it.each([
    [{ panes: 1, jobs: 0 }, '1 pane is running a program.'],
    [{ panes: 2, jobs: 0 }, '2 panes are running a program.'],
    [{ panes: 0, jobs: 1 }, '1 job is running.'],
    [{ panes: 0, jobs: 3 }, '3 jobs are running.'],
    [{ panes: 2, jobs: 1 }, '2 panes are running a program and 1 job is running.']
  ])('%j 이면 "%s"', (running, detail) => {
    expect(runningDialog(running, 'Quit?', 'Quit')).toEqual({
      message: 'Quit?',
      detail,
      buttons: ['Quit', 'Cancel']
    })
  })

  it('도는 것이 없으면 묻지 않는다', () => {
    expect(runningDialog({ panes: 0, jobs: 0 }, 'Quit?', 'Quit')).toBeNull()
  })
})

describe('createQuitPermission', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('처음에는 묻고, 허락하면 그 뒤로 묻지 않는다', () => {
    const q = createQuitPermission(60_000)
    expect(q.allowed()).toBe(false)
    q.allow()
    expect(q.allowed()).toBe(true)
  })

  it('shutdown 뒤에는 정한 시간 동안만 묻지 않는다', () => {
    vi.useFakeTimers()
    const q = createQuitPermission(60_000)
    q.shutdown()
    vi.advanceTimersByTime(59_999)
    expect(q.allowed()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(q.allowed()).toBe(false)
  })

  it('shutdown 이 다시 오면 시간을 처음부터 잰다', () => {
    vi.useFakeTimers()
    const q = createQuitPermission(60_000)
    q.shutdown()
    vi.advanceTimersByTime(30_000)
    q.shutdown()
    vi.advanceTimersByTime(59_999)
    expect(q.allowed()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(q.allowed()).toBe(false)
  })

  it('shutdown 시간 안에 받은 허락은 시간이 지나도 남는다', () => {
    vi.useFakeTimers()
    const q = createQuitPermission(60_000)
    q.shutdown()
    q.allow()
    vi.advanceTimersByTime(60_000)
    expect(q.allowed()).toBe(true)
  })
})
