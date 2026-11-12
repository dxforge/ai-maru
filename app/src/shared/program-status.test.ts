import { describe, expect, it } from 'vitest'
import {
  parseProgramStatus,
  programName,
  runningTasks,
  shownRecord,
  statusText,
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

describe('statusText', () => {
  it('보일 레코드의 메시지를 쓰고, 메시지가 없으면 상태 이름을, 레코드가 없으면 undefined 를 낸다', () => {
    const ask = {
      ...rec('ask', 'blocked'),
      kind: 'permission' as const,
      message: 'approve Bash: ls'
    }
    expect(statusText([rec('', 'working'), ask])).toBe('approve Bash: ls')
    expect(statusText([rec('', 'idle')])).toBe('Idle')
    expect(statusText([rec('ask', 'blocked')])).toBeUndefined()
  })
})

describe('shownRecord', () => {
  it('루트가 없으면 하위가 있어도 없다', () => {
    expect(shownRecord([])).toBeUndefined()
    expect(shownRecord([rec('ask', 'blocked'), rec('b', 'error')])).toBeUndefined()
  })

  it('루트가 working 이면 kind 없는 blocked·error 하위는 더 급해도 루트다', () => {
    expect(picked([rec('', 'working'), rec('ask', 'blocked'), rec('b', 'error')])).toEqual([
      '',
      'working'
    ])
  })

  describe('루트가 working 일 때 Claude Code 의 하위 task 레코드', () => {
    // Claude Code 가 서브에이전트 같은 백그라운드 task 마다 보내는 하위 레코드의 모양이다(id 는 task id, title 은 task 설명).
    // kind 있는 `blocked` 는 실제로 재지 못해 잰 모양에서 `state`·`kind` 만 바꿨다.
    const root = rec('', 'working', 'claude-code')
    const task = (
      id: string,
      state: ProgramStatusState,
      kind: ProgramStatusRecord['kind'] = null
    ): ProgramStatusRecord => ({ ...rec(id, state, 'claude-code'), kind, title: `task ${id}` })

    it.each(['question', 'permission', 'auth'] as const)(
      'kind 가 %s 인 blocked 는 루트 대신 보인다',
      (kind) => {
        const t = task('a1b2c3d4e5f6g7h8i', 'blocked', kind)
        expect(shownRecord([root, task('a0000000000000000', 'working'), t])).toEqual(t)
      }
    )

    it('kind 없는 blocked 와 working 하위만 있으면 루트다', () => {
      expect(
        shownRecord([
          root,
          task('a1b2c3d4e5f6g7h8i', 'blocked'),
          task('a9999999999999999', 'working')
        ])
      ).toEqual(root)
    })

    it('kind 있는 blocked 가 여럿이면 받은 순서(id 순)로 첫 것이다', () => {
      expect(
        picked([
          root,
          task('a1', 'blocked'),
          task('a2', 'blocked', 'permission'),
          task('a3', 'blocked', 'question')
        ])
      ).toEqual(['a2', 'blocked'])
    })

    it('maru status 로 쓴 --id ask 도 같고, 고른 하위의 app 은 루트의 app 이다', () => {
      const ask = { ...rec('ask', 'blocked'), kind: 'question' as const, message: 'Which one?' }
      expect(shownRecord([root, ask])).toEqual({ ...ask, app: 'claude-code' })
    })
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

  it('고른 하위의 app 은 하위와 조상의 app 과 상관없이 루트의 app 이다', () => {
    const root = rec('', 'done', 'claude-code')
    expect(shownRecord([root, rec('ask', 'blocked')])).toEqual({
      ...rec('ask', 'blocked'),
      app: 'claude-code'
    })
    expect(shownRecord([root, rec('build', 'error', 'cargo')])?.app).toBe('claude-code')
    expect(
      shownRecord([root, rec('a', 'idle', 'make'), rec('a/b', 'idle'), rec('a/b/c', 'error')])?.app
    ).toBe('claude-code')
    expect(shownRecord([rec('', 'idle', 'codex'), rec('ask', 'blocked', 'claude-code')])?.app).toBe(
      'codex'
    )
    expect(shownRecord([rec('', 'idle'), rec('ask', 'error', 'cargo')])?.app).toBe('')
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

describe('runningTasks', () => {
  it('하위 working·error 와 kind 없는 blocked 를 받은 순서로 고른다', () => {
    const ask = { ...rec('ask', 'blocked'), kind: 'permission' as const }
    const records = [
      rec('', 'working'),
      rec('a1', 'working'),
      rec('a2', 'done'),
      ask,
      rec('a3', 'blocked'),
      rec('a4', 'idle'),
      rec('a5', 'error'),
      rec('a6', 'working')
    ]
    expect(runningTasks(records).map((r) => r.id)).toEqual(['a1', 'a3', 'a5', 'a6'])
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
