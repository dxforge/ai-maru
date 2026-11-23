import { describe, expect, it } from 'vitest'
import type { ProgramStatusRecord, ProgramStatusState } from '../../../shared/program-status'
import type { PtyState, PtyStateEntry } from '../../../shared/pty-state'
import { createPtyStates, syncPtyStates } from './states'

function rec(state: ProgramStatusState, id = ''): ProgramStatusRecord {
  return { id, state, kind: null, progress: null, app: 'make', title: '', message: '' }
}

function state(records: ProgramStatusRecord[] = [], title: string | null = null): PtyState {
  return { cwd: '/w', cwdReports: 1, title, foregroundCwd: null, command: null, records }
}

describe('createPtyStates', () => {
  it('main 이 보낸 상태에서 보일 레코드와 그 상태를 고르고, 지우면 없다', () => {
    const s = createPtyStates()
    s.apply('p-1', { state: state([rec('working', 'build')]) })
    expect(s.shown('p-1')).toBeUndefined()
    s.apply('p-1', { state: state([rec('blocked'), rec('working', 'build')]) })
    expect(s.state('p-1')).toBe('blocked')
    s.apply('p-1', { state: state([rec('done'), rec('error', 'build')]) })
    expect(s.shown('p-1')?.id).toBe('build')
    expect(s.state('p-1')).toBe('error')
    expect(s.rootState('p-1')).toBe('done')
    expect(s.get('p-1')?.cwd).toBe('/w')
    s.apply('p-1', null)
    expect([s.get('p-1'), s.state('p-1')]).toEqual([undefined, undefined])
    expect(s.state(undefined)).toBeUndefined()
  })

  it('루트의 app 을 단 하위 레코드도 같은 상태에서는 같은 객체다', () => {
    const s = createPtyStates()
    s.apply('p-1', { state: state([rec('done'), { ...rec('blocked', 'ask'), app: 'cargo' }]) })
    const first = s.shown('p-1')
    expect(first).toMatchObject({ id: 'ask', app: 'make' })
    expect(s.shown('p-1')).toBe(first)
  })

  it('도는 백그라운드 일은 같은 상태에서 같은 배열이고, 새 상태가 오면 다시 고른다', () => {
    const s = createPtyStates()
    s.apply('p-1', { state: state([rec('done'), rec('working', 'a1'), rec('done', 'a2')]) })
    const first = s.tasks('p-1')
    expect(first.map((r) => r.id)).toEqual(['a1'])
    expect(s.tasks('p-1')).toBe(first)
    s.apply('p-1', { state: state([rec('done')]) })
    expect(s.tasks('p-1')).toEqual([])
    expect([s.tasks('p-2'), s.tasks(undefined)]).toEqual([[], []])
  })

  it('보일 명령은 같은 상태에서 같은 객체이고, 새 상태가 오면 다시 고른다', () => {
    const s = createPtyStates()
    const running = { running: true, text: 'make', exitCode: null, startedAt: 1 }
    s.apply('p-1', { state: { ...state(), command: running } })
    const first = s.command('p-1')
    expect(first).toEqual({ running: true, text: 'make', startedAt: 1 })
    expect(s.command('p-1')).toBe(first)
    s.apply('p-1', { state: { ...state(), command: { ...running, running: false, exitCode: 2 } } })
    expect(s.command('p-1')).toEqual({ running: false, text: 'make', exitCode: 2 })
    expect([s.command('p-2'), s.command(undefined)]).toEqual([undefined, undefined])
  })

  it('main 이 보낸 읽지 않은 알림을 돌려주고, 지운 항목에는 없다', () => {
    const s = createPtyStates()
    const n = { title: 'Tests', body: '3 failed' }
    s.apply('p-1', { state: state(), notification: n })
    expect(s.notification('p-1')).toEqual(n)
    s.apply('p-1', { state: state() })
    expect(s.notification('p-1')).toBeUndefined()
    expect(s.notification(undefined)).toBeUndefined()
  })
})

describe('syncPtyStates', () => {
  it('main 에 물은 전체를 넣되, 묻는 동안 push 로 온 pty 는 덮지 않는다', async () => {
    const applied: [string, PtyStateEntry | null][] = []
    let push!: (pty: string, entry: PtyStateEntry | null) => void
    let answer!: (all: Record<string, PtyStateEntry>) => void
    syncPtyStates((pty, entry) => applied.push([pty, entry]), {
      onPtyState: (cb) => (push = cb),
      ptyStates: () => new Promise((r) => (answer = r))
    })
    const fresh = { state: state([], 'new') }
    push('p-1', fresh)
    push('p-gone', null)
    const other = { state: state([], 'other') }
    answer({ 'p-1': { state: state([], 'old') }, 'p-gone': other, 'p-2': other })
    await Promise.resolve()
    expect(applied).toEqual([
      ['p-1', fresh],
      ['p-gone', null],
      ['p-2', other]
    ])
    push('p-1', null)
    expect(applied.at(-1)).toEqual(['p-1', null])
  })
})
