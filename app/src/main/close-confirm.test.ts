import { describe, expect, it, vi } from 'vitest'
import {
  closePaneDialog,
  runningDialog,
  runningPanes,
  runningProgram,
  type ProgramDeps
} from './close-confirm'

const SHELL = 100

function deps(fg: Record<string, { pid: number; name: string | null }>): ProgramDeps {
  return {
    foreground: vi.fn(async (pty: string) => {
      const f = fg[pty]
      if (!f) throw new Error(`pty ${pty} is not running`)
      return { ...f, cwd: '/w' }
    }),
    shellPid: async (pty: string) => (pty === 'p-norecord' ? null : SHELL)
  }
}

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

  it('명령 pane 은 foreground 를 묻지 않고 명령의 첫 단어로 실행 중이다', async () => {
    const d = deps({ 'p-1': { pid: SHELL, name: 'bash' } })
    expect(await runningProgram({ ptyId: 'p-1', command: ['npm', 'run', 'dev'] }, d)).toEqual({
      name: 'npm'
    })
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
