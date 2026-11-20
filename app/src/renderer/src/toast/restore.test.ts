import { describe, expect, it } from 'vitest'
import { restoreToast } from './restore'

describe('restoreToast', () => {
  it('이전 로그인의 터미널은 저절로 닫히지 않는 경고로 한 줄만 알린다', () => {
    const t = restoreToast('login')
    expect(t.level).toBe('warning')
    expect(t.timeout).toBeUndefined()
    expect(t.action).toBeUndefined()
    expect(t.lines).toHaveLength(1)
  })
})
