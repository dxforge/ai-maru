import { describe, expect, it } from 'vitest'
import type { ProgramStatusState } from '../../../shared/program-status'
import { unreadWorkspaces, urgentStates } from './status'

const cell = (key: number, ...ptys: string[]) => ({ key, panes: ptys.map((ptyId) => ({ ptyId })) })

const tree = [
  { key: 1, cells: [cell(10, 'a', 'b'), cell(11, 'c')] },
  { key: 2, cells: [cell(20, 'd')] },
  { key: 3, cells: [cell(30, 'e')] }
]

describe('urgentStates', () => {
  it('cell 은 그 pane 들의, workspace 는 그 cell 들의 가장 급한 상태다', () => {
    const states: Record<string, ProgramStatusState> = {
      a: 'idle',
      b: 'blocked',
      c: 'done',
      d: 'working',
      e: 'error'
    }
    const map = urgentStates(tree, (pty) => states[pty])
    expect(Object.fromEntries(map)).toEqual({
      10: 'blocked',
      11: 'done',
      1: 'blocked',
      20: 'working',
      2: 'working',
      30: 'error',
      3: 'error'
    })
  })

  it('상태가 있는 pane 이 없는 cell 과 workspace 는 표에 없다', () => {
    const map = urgentStates(tree, (pty) => (pty === 'c' ? 'idle' : undefined))
    expect(Object.fromEntries(map)).toEqual({ 11: 'idle', 1: 'idle' })
  })
})

describe('unreadWorkspaces', () => {
  it('알림이 남은 pane 이 하나라도 있는 workspace 만 든다', () => {
    const notices: Record<string, object> = {
      c: { title: 't', body: '' },
      e: { title: '', body: 'b' }
    }
    expect(unreadWorkspaces(tree, (pty) => notices[pty])).toEqual(new Set([1, 3]))
    expect(unreadWorkspaces(tree, () => undefined)).toEqual(new Set())
  })
})
