import { describe, expect, it } from 'vitest'
import type { PtyState } from '../../../shared/pty-state'
import { paneCwd, paneName, paneTitle } from './display'

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
  it('제목, 루트 레코드의 프로그램 이름, Shell 순서다', () => {
    expect(paneName('vim', { app: 'claude-code' })).toBe('vim')
    expect(paneName('', { app: 'claude-code' })).toBe('Claude')
    expect(paneName(undefined, { app: '' })).toBe('Program')
    expect(paneName(undefined, undefined)).toBe('Shell')
  })
})
