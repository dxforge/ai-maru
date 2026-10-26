import { describe, expect, it } from 'vitest'
import { tildePath } from './cwd'

describe('tildePath', () => {
  it('홈과 그 아래는 ~ 로 줄인다', () => {
    expect(tildePath('/u/a', '/u/a')).toBe('~')
    expect(tildePath('/u/a/w/x', '/u/a')).toBe('~/w/x')
  })

  it('이름만 홈으로 시작하는 형제 디렉토리나 홈 밖은 그대로다', () => {
    expect(tildePath('/u/ab/x', '/u/a')).toBe('/u/ab/x')
    expect(tildePath('/tmp', '/u/a')).toBe('/tmp')
  })

  it('홈이 / 로 끝나도 줄인다', () => {
    expect(tildePath('/u/a/x', '/u/a/')).toBe('~/x')
  })

  it('홈을 모르거나 / 이면 그대로다', () => {
    expect(tildePath('/tmp', undefined)).toBe('/tmp')
    expect(tildePath('/tmp', '/')).toBe('/tmp')
  })
})
