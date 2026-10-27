import { describe, expect, it } from 'vitest'
import type { PtyState } from '../../../shared/pty-state'
import {
  commandLabel,
  commandTail,
  commandView,
  elapsed,
  fallbackName,
  paneCwd,
  paneName,
  paneTitle
} from './display'

const state = (over: Partial<PtyState>): PtyState => ({
  cwd: null,
  cwdReports: 0,
  title: null,
  foregroundCwd: null,
  command: null,
  records: [],
  ...over
})

describe('paneCwd', () => {
  it('foreground cwd, 셸 cwd, 되살린 cwd, 띄운 디렉토리, 시작 디렉토리 순서로 고른다', () => {
    const all = {
      state: state({ foregroundCwd: '/fg', cwd: '/shell' }),
      restoredCwd: '/restored',
      spawnedCwd: '/spawned',
      startDir: '/start'
    }
    expect(paneCwd(all)).toBe('/fg')
    expect(paneCwd({ ...all, state: state({ cwd: '/shell' }) })).toBe('/shell')
    expect(paneCwd({ ...all, state: state({}) })).toBe('/restored')
    expect(paneCwd({ ...all, state: undefined, restoredCwd: undefined })).toBe('/spawned')
    expect(paneCwd({ startDir: '/start' })).toBe('/start')
    expect(paneCwd({})).toBeUndefined()
  })
})

describe('paneTitle', () => {
  it('상태의 제목을 쓰고, 상태가 없으면 되살린 제목을, 이전 maru-pty 의 pty 면 아무것도 쓰지 않는다', () => {
    expect(paneTitle({ state: state({ title: 't' }), restoredTitle: 'r', old: false })).toBe('t')
    expect(paneTitle({ state: state({}), restoredTitle: 'r', old: false })).toBeUndefined()
    expect(paneTitle({ restoredTitle: 'r', old: false })).toBe('r')
    expect(paneTitle({ restoredTitle: 'r', old: true })).toBeUndefined()
  })
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

  it('성공했거나 Ctrl-C(130)로 끝났거나 종료 코드를 모르거나, 텍스트가 없거나, 신호를 받은 적 없거나, 레코드가 있으면 보이지 않는다', () => {
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

describe('commandTail·commandLabel', () => {
  it('도는 명령은 돈 시간(시작 시각을 모르면 빈 문자열)을, 실패한 명령은 종료 코드를 쓴다', () => {
    const running = { running: true, text: 'a', startedAt: 1_000 } as const
    expect(commandTail(running, 1_000 + 3 * 60_000)).toBe('3m')
    expect(commandTail({ running: true, text: 'a' }, 5)).toBe('')
    expect(commandTail({ running: false, text: 'a', exitCode: 2 }, 5)).toBe('2')
    expect(commandLabel(running)).toBe('Running')
    expect(commandLabel({ running: false, text: 'a', exitCode: 1 })).toBe('Exited with code 1')
  })
})

describe('elapsed', () => {
  it('분·시간·일 가운데 하나로 짧게 쓴다', () => {
    expect(elapsed(59_999)).toBe('<1m')
    expect(elapsed(4 * 60_000)).toBe('4m')
    expect(elapsed(59 * 60_000)).toBe('59m')
    expect(elapsed(2 * 3600_000 + 59 * 60_000)).toBe('2h')
    expect(elapsed(3 * 86400_000)).toBe('3d')
  })
})
