import { describe, expect, it } from 'vitest'
import {
  parseProgramStatus,
  programName,
  shownRecord,
  type ProgramStatusRecord,
  type ProgramStatusState
} from './program-status'

function rec(id: string, state: ProgramStatusState, app = ''): ProgramStatusRecord {
  return { id, state, kind: null, progress: null, app, title: '', message: '' }
}

const picked = (records: ProgramStatusRecord[]) => {
  const r = shownRecord(records)
  return r && [r.id, r.state]
}

describe('shownRecord', () => {
  it('루트가 없으면 하위가 있어도 없다', () => {
    expect(shownRecord([])).toBeUndefined()
    expect(shownRecord([rec('ask', 'blocked'), rec('b', 'error')])).toBeUndefined()
  })

  it('루트가 working 이면 하위가 더 급해도 루트다', () => {
    expect(picked([rec('', 'working'), rec('ask', 'blocked'), rec('b', 'error')])).toEqual([
      '',
      'working'
    ])
  })

  it('그 밖에는 blocked, error, done, working, idle 순으로 가장 급한 레코드다', () => {
    expect(picked([rec('', 'done'), rec('b', 'error')])).toEqual(['b', 'error'])
    expect(picked([rec('', 'idle'), rec('b', 'working')])).toEqual(['b', 'working'])
    expect(picked([rec('', 'error'), rec('ask', 'blocked')])).toEqual(['ask', 'blocked'])
    expect(picked([rec('', 'done'), rec('ask', 'blocked'), rec('b', 'error')])).toEqual([
      'ask',
      'blocked'
    ])
    expect(picked([rec('', 'blocked'), rec('b', 'error')])).toEqual(['', 'blocked'])
    expect(picked([rec('', 'done'), rec('b', 'idle')])).toEqual(['', 'done'])
  })

  it('같은 상태가 여럿이면 루트, 그다음 받은 순서(id 순)다', () => {
    expect(picked([rec('', 'error'), rec('a', 'error')])).toEqual(['', 'error'])
    expect(picked([rec('', 'idle'), rec('a', 'error'), rec('b', 'error')])).toEqual(['a', 'error'])
    expect(picked([rec('a', 'done'), rec('', 'idle'), rec('b', 'done')])).toEqual(['a', 'done'])
  })

  it('고른 하위에 app 이 없으면 가장 가까운 조상의 app 을, 조상에 없으면 루트의 app 을 쓴다', () => {
    const root = rec('', 'done', 'claude-code')
    expect(shownRecord([root, rec('ask', 'blocked')])).toEqual({
      ...rec('ask', 'blocked'),
      app: 'claude-code'
    })
    expect(
      shownRecord([root, rec('a', 'idle', 'make'), rec('a/b', 'idle'), rec('a/b/c', 'error')])?.app
    ).toBe('make')
    expect(shownRecord([root, rec('a', 'idle', 'make'), rec('a/b', 'error', 'cargo')])?.app).toBe(
      'cargo'
    )
    expect(shownRecord([root, rec('ab', 'idle', 'make'), rec('a/b', 'error')])?.app).toBe(
      'claude-code'
    )
    expect(shownRecord([rec('', 'idle'), rec('ask', 'error')])?.app).toBe('')
  })

  it('고른 레코드의 kind·progress·title·message 는 그 레코드의 것이다', () => {
    const ask = {
      ...rec('ask', 'blocked'),
      kind: 'question',
      progress: 3,
      title: 't',
      message: 'm'
    }
    expect(
      shownRecord([{ ...rec('', 'done', 'x'), message: 'root' }, ask as ProgramStatusRecord])
    ).toEqual({ ...ask, app: 'x' })
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
