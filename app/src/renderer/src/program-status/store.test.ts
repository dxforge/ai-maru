import { describe, expect, it } from 'vitest'
import { parseProgramStatus, type ProgramStatusRecord } from '../../../shared/program-status'
import { createProgramStatuses } from './store'

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
    s.set('s-1', [rec({ id: 'build', state: 'working' })])
    expect(s.state('s-1')).toBeUndefined()
    s.set('s-1', [
      rec({ state: 'blocked', kind: 'permission' }),
      rec({ id: 'build', state: 'working' })
    ])
    expect(s.state('s-1')).toBe('blocked')
    expect(s.records('s-1')).toHaveLength(2)
  })

  it('빈 목록을 받으면 상태가 없어지고, remove 로 세션을 지운다', () => {
    const s = createProgramStatuses()
    s.set('s-1', [rec({ state: 'done' })])
    s.set('s-2', [rec({ state: 'idle' })])
    s.set('s-1', [])
    expect(s.state('s-1')).toBeUndefined()
    expect(s.records('s-1')).toEqual([])
    s.remove('s-2')
    expect(s.state('s-2')).toBeUndefined()
  })

  it('세션 id 가 아직 없으면 상태도 없다', () => {
    expect(createProgramStatuses().state(undefined)).toBeUndefined()
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
