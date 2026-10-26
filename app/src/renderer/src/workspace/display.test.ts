import { describe, expect, it } from 'vitest'
import type { PtyState } from '../../../shared/pty-state'
import { elapsed, fallbackName, paneCwd, paneName, paneTitle } from './display'

const state = (over: Partial<PtyState>): PtyState => ({
  cwd: null,
  cwdReports: 0,
  title: null,
  foregroundCwd: null,
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

describe('elapsed', () => {
  it('분·시간·일 가운데 하나로 짧게 쓴다', () => {
    expect(elapsed(59_999)).toBe('<1m')
    expect(elapsed(4 * 60_000)).toBe('4m')
    expect(elapsed(59 * 60_000)).toBe('59m')
    expect(elapsed(2 * 3600_000 + 59 * 60_000)).toBe('2h')
    expect(elapsed(3 * 86400_000)).toBe('3d')
  })
})
