import { describe, expect, it } from 'vitest'
import { parseProgramStatus, type ProgramStatusRecord } from '../../../shared/program-status'
import { createProgramStatuses, programName } from './store'

function rec(partial: Partial<ProgramStatusRecord> & Pick<ProgramStatusRecord, 'state'>) {
  return {
    id: '',
    kind: null,
    progress: null,
    app: 'claude-code',
    title: '',
    message: '',
    ...partial
  }
}

describe('program statuses', () => {
  it('루트 레코드의 상태를 돌려주고, 루트가 없으면 undefined 다', () => {
    const s = createProgramStatuses()
    s.set('p-1', [rec({ id: 'build', state: 'working' })])
    expect(s.state('p-1')).toBeUndefined()
    s.set('p-1', [
      rec({ state: 'blocked', kind: 'permission' }),
      rec({ id: 'build', state: 'working' })
    ])
    expect(s.state('p-1')).toBe('blocked')
    expect(s.records('p-1')).toHaveLength(2)
  })

  it('빈 목록을 받으면 상태가 없어지고, remove 로 pty 를 지운다', () => {
    const s = createProgramStatuses()
    s.set('p-1', [rec({ state: 'done' })])
    s.set('p-2', [rec({ state: 'idle' })])
    s.set('p-1', [])
    expect(s.state('p-1')).toBeUndefined()
    expect(s.records('p-1')).toEqual([])
    s.remove('p-2')
    expect(s.state('p-2')).toBeUndefined()
  })

  it('pty id 가 아직 없으면 상태도 없다', () => {
    expect(createProgramStatuses().state(undefined)).toBeUndefined()
  })

  it('root 는 루트 레코드를 돌려준다', () => {
    const s = createProgramStatuses()
    s.set('p-1', [rec({ id: 'build', state: 'working', app: 'make' })])
    expect(s.root('p-1')).toBeUndefined()
    s.set('p-1', [rec({ state: 'idle', app: 'make' }), rec({ id: 'build', state: 'working' })])
    expect(s.root('p-1')?.app).toBe('make')
  })
})

describe('programName', () => {
  it('claude-code 만 Claude 로, 다른 app 은 그 값으로, 빈 app 은 Program 으로 부른다', () => {
    expect(programName('claude-code')).toBe('Claude')
    expect(programName('make')).toBe('make')
    expect(programName('')).toBe('Program')
  })
})

describe('parseProgramStatus', () => {
  it('모르는 state 의 레코드를 건너뛰고 빠진 값을 null·빈 문자열로 채운다', () => {
    expect(
      parseProgramStatus({
        type: 'program_status',
        records: [
          {
            id: '',
            state: 'blocked',
            kind: 'permission',
            progress: 3,
            app: 'x',
            title: 't',
            message: 'm'
          },
          { id: 'a', state: 'paused' },
          { id: 'b', state: 'done', kind: 'other' },
          'junk'
        ]
      })
    ).toEqual([
      {
        id: '',
        state: 'blocked',
        kind: 'permission',
        progress: 3,
        app: 'x',
        title: 't',
        message: 'm'
      },
      { id: 'b', state: 'done', kind: null, progress: null, app: '', title: '', message: '' }
    ])
  })

  it('records 가 배열이 아니면 null 이다', () => {
    expect(parseProgramStatus({ type: 'program_status' })).toBeNull()
    expect(parseProgramStatus({ records: 'no' })).toBeNull()
    expect(parseProgramStatus(null)).toBeNull()
  })
})
