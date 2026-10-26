import { describe, expect, it } from 'vitest'
import { parseProgramStatus, programName } from './program-status'

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
