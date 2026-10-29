import { describe, expect, it } from 'vitest'
import { commandView, fallbackName, paneName } from './pane-name'
import type { PtyState } from './pty-state'

const state = (over: Partial<PtyState>): PtyState => ({
  cwd: null,
  cwdReports: 0,
  title: null,
  foregroundCwd: null,
  command: null,
  records: [],
  ...over
})

describe('paneName', () => {
  it('제목, 루트 레코드의 프로그램 이름, 셸·명령 이름 순서다', () => {
    expect(paneName({ title: 'vim' }, { app: 'claude-code' }, '/bin/zsh')).toBe('vim')
    expect(paneName({ title: '' }, { app: 'claude-code' }, '/bin/zsh')).toBe('Claude')
    expect(paneName({}, { app: '' }, '/bin/zsh')).toBe('Program')
    expect(paneName({}, undefined, '/bin/zsh')).toBe('zsh')
    expect(paneName({ command: ['vim', 'x'] }, undefined, '/bin/zsh')).toBe('vim')
  })

  it('레코드가 없으면 보일 명령이 제목보다 먼저고, 레코드가 있으면 명령을 쓰지 않는다', () => {
    const running = { running: true, text: 'npm run dev' } as const
    expect(paneName({ title: 'user@mac' }, undefined, '/bin/zsh', running)).toBe('npm run dev')
    expect(paneName({}, undefined, '/bin/zsh', { running: false, text: 'x', exitCode: 2 })).toBe(
      'x'
    )
    expect(paneName({ title: 'vim' }, { app: 'claude-code' }, '/bin/zsh', running)).toBe('vim')
    expect(paneName({ title: 't' }, undefined, '/bin/zsh', undefined)).toBe('t')
  })
})

describe('commandView', () => {
  const cmd = (over: Partial<NonNullable<PtyState['command']>>) =>
    state({
      command: { running: false, text: 'cargo test', exitCode: null, startedAt: 7, ...over }
    })

  it('도는 명령은 시작 시각과 함께, 실패한 명령은 종료 코드와 함께 보인다', () => {
    expect(commandView(cmd({ running: true }))).toEqual({
      running: true,
      text: 'cargo test',
      startedAt: 7
    })
    expect(commandView(cmd({ running: true, startedAt: null }))).toEqual({
      running: true,
      text: 'cargo test',
      startedAt: undefined
    })
    expect(commandView(cmd({ exitCode: 101 }))).toEqual({
      running: false,
      text: 'cargo test',
      exitCode: 101
    })
    expect(commandView(cmd({ exitCode: -1 }))).toEqual({
      running: false,
      text: 'cargo test',
      exitCode: -1
    })
  })

  it('성공했거나 Ctrl-C(130)로 끝났거나 종료 코드를 모르거나, 텍스트가 없거나, 신호를 받은 적 없거나, 보일 레코드가 있으면 보이지 않는다', () => {
    expect(commandView(cmd({ exitCode: 0 }))).toBeUndefined()
    expect(commandView(cmd({ exitCode: 130 }))).toBeUndefined()
    expect(commandView(cmd({}))).toBeUndefined()
    expect(commandView(cmd({ running: true, text: null }))).toBeUndefined()
    expect(commandView(cmd({ running: true, text: '' }))).toBeUndefined()
    expect(commandView(state({}))).toBeUndefined()
    expect(commandView(undefined)).toBeUndefined()
    const record = {
      id: '',
      state: 'working',
      kind: null,
      progress: null,
      app: 'claude-code',
      title: '',
      message: ''
    } as const
    expect(commandView({ ...cmd({ running: true }), records: [record] })).toBeUndefined()
    expect(
      commandView({ ...cmd({ running: true }), records: [{ ...record, id: 'ask' }] })
    ).toMatchObject({ running: true })
  })
})

describe('fallbackName', () => {
  it('명령 pane 은 명령의 이름, 아니면 셸의 이름이고, 셸을 모르면 sh 다', () => {
    expect(fallbackName({ command: ['/usr/bin/bash', '-c', 'x'] }, '/bin/zsh')).toBe('bash')
    expect(fallbackName({}, '/bin/zsh')).toBe('zsh')
    expect(fallbackName({ command: [] }, '/opt/homebrew/bin/fish')).toBe('fish')
    expect(fallbackName({}, undefined)).toBe('sh')
    expect(fallbackName({}, '')).toBe('sh')
  })
})
