import { describe, expect, it } from 'vitest'
import type { PtyState } from '../../../shared/pty-state'
import { commandLabel, commandTail, elapsed, paneCwd, paneTitle } from './display'

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
