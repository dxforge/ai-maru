import { describe, expect, it } from 'vitest'
import { parsePtyState } from './pty-state'

describe('parsePtyState', () => {
  it('state 메시지를 바꾸고, 문자열이 아닌 값은 null 로, 보고 수가 없으면 0 으로 둔다', () => {
    const record = {
      id: '',
      state: 'idle',
      kind: null,
      progress: null,
      app: 'x',
      title: '',
      message: ''
    }
    expect(
      parsePtyState({
        type: 'state',
        cwd: '/a',
        cwd_reports: 2,
        title: 't',
        foreground_cwd: '/b',
        records: [record]
      })
    ).toEqual({ cwd: '/a', cwdReports: 2, title: 't', foregroundCwd: '/b', records: [record] })
    expect(parsePtyState({ type: 'state', cwd: 1, title: null, records: [] })).toEqual({
      cwd: null,
      cwdReports: 0,
      title: null,
      foregroundCwd: null,
      records: []
    })
  })

  it('state 가 아니거나 레코드가 배열이 아니면 null 이다', () => {
    expect(parsePtyState({ type: 'program_status', records: [] })).toBeNull()
    expect(parsePtyState({ type: 'state' })).toBeNull()
    expect(parsePtyState(null)).toBeNull()
  })
})
