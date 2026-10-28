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

  it('app 을 물려받은 하위 레코드도 같은 상태에서는 같은 객체다', () => {
    const s = createPtyStates()
    s.apply('p-1', { state: state([rec('done'), { ...rec('blocked', 'ask'), app: '' }]) })
    const first = s.shown('p-1')
    expect(first).toMatchObject({ id: 'ask', app: 'make' })
    expect(s.shown('p-1')).toBe(first)
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

  it('attach 스트림의 레코드는 이전 maru-pty 의 pty 에서만 쓴다', () => {
    const s = createPtyStates()
    s.setLegacyRecords('p-1', [rec('working')])
    expect(s.state('p-1')).toBeUndefined()
    s.apply('p-1', { old: true })
    expect([s.isOld('p-1'), s.state('p-1'), s.get('p-1')]).toEqual([true, 'working', undefined])

    s.setLegacyRecords('p-2', [rec('working')])
    s.apply('p-2', { state: state([rec('done')]) })
    expect([s.isOld('p-2'), s.state('p-2')]).toEqual([false, 'done'])

    s.remove('p-1')
    expect([s.isOld('p-1'), s.state('p-1')]).toEqual([false, undefined])
    s.apply('p-1', { old: true })
    expect(s.state('p-1')).toBeUndefined()
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
    answer({ 'p-1': { state: state([], 'old') }, 'p-gone': { old: true }, 'p-2': { old: true } })
    await Promise.resolve()
    expect(applied).toEqual([
      ['p-1', fresh],
      ['p-gone', null],
      ['p-2', { old: true }]
    ])
    push('p-1', null)
    expect(applied.at(-1)).toEqual(['p-1', null])
  })
})
