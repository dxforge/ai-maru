import { describe, expect, it } from 'vitest'
import { utf8Locale } from './session'

describe('utf8Locale', () => {
  it('지역 태그를 로케일 이름으로 바꾼다', () => {
    expect(utf8Locale('ko-KR', (n) => n === 'ko_KR.UTF-8')).toBe('ko_KR.UTF-8')
  })

  it('없는 조합이면 C.UTF-8 이다', () => {
    expect(utf8Locale('en-KR', () => false)).toBe('C.UTF-8')
  })
})
