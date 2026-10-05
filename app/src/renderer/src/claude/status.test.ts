import { describe, expect, it } from 'vitest'
import { createClaudeStatuses } from './status'

describe('claude statuses', () => {
  it('set 은 상태를 고치고 null 은 지운다', () => {
    const c = createClaudeStatuses()
    c.set('s-1', 'working')
    expect(c.state('s-1')).toBe('working')
    c.set('s-1', null)
    expect(c.state('s-1')).toBeUndefined()
  })

  it('replace 는 통째로 바꾼다', () => {
    const c = createClaudeStatuses()
    c.set('s-1', 'working')
    c.replace({ 's-2': 'idle' })
    expect(c.state('s-1')).toBeUndefined()
    expect(c.state('s-2')).toBe('idle')
  })

  it('세션 id 가 아직 없으면 상태도 없다', () => {
    expect(createClaudeStatuses().state(undefined)).toBeUndefined()
  })
})
