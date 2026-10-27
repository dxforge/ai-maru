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
        command: { running: false, text: 'false', exit_code: 1, started_at: 5 },
        records: [record]
      })
    ).toEqual({
      cwd: '/a',
      cwdReports: 2,
      title: 't',
      foregroundCwd: '/b',
      command: { running: false, text: 'false', exitCode: 1, startedAt: 5 },
      records: [record]
    })
    expect(parsePtyState({ type: 'state', cwd: 1, title: null, records: [] })).toEqual({
      cwd: null,
      cwdReports: 0,
      title: null,
      foregroundCwd: null,
      command: null,
      records: []
    })
  })

  it('명령 상태는 running 이 boolean 일 때만 받고, 나머지 값은 모양이 틀리면 null 로 둔다', () => {
    const parse = (command: unknown) =>
      parsePtyState({ type: 'state', command, records: [] })?.command
    expect(parse({ running: true, text: 'npm run dev', exit_code: null, started_at: 9 })).toEqual({
      running: true,
      text: 'npm run dev',
      exitCode: null,
      startedAt: 9
    })
    expect(parse({ running: true, text: 3, exit_code: '1' })).toEqual({
      running: true,
      text: null,
      exitCode: null,
      startedAt: null
    })
    expect(parse({ running: 'yes' })).toBeNull()
    expect(parse(null)).toBeNull()
  })

  it('state 가 아니거나 레코드가 배열이 아니면 null 이다', () => {
    expect(parsePtyState({ type: 'program_status', records: [] })).toBeNull()
    expect(parsePtyState({ type: 'state' })).toBeNull()
    expect(parsePtyState(null)).toBeNull()
  })
})
