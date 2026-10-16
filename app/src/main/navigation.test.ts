import { describe, expect, it } from 'vitest'
import { isDevReload } from './navigation'

describe('isDevReload', () => {
  const dev = 'http://vite.test/'

  it('dev 서버와 origin 이 같은 이동만 새로 고침으로 본다', () => {
    expect(isDevReload('http://vite.test/', dev)).toBe(true)
    expect(isDevReload('http://vite.test/src/main.ts?t=1', dev)).toBe(true)
  })

  it('포트나 호스트가 다르면 새로 고침이 아니다', () => {
    expect(isDevReload('http://vite.test:81/', dev)).toBe(false)
    expect(isDevReload('http://vite.test.evil.test/', dev)).toBe(false)
    expect(isDevReload('https://example.com/', dev)).toBe(false)
  })

  it('dev 서버가 없으면(패키징한 앱) 어느 이동도 새로 고침이 아니다', () => {
    expect(isDevReload('http://vite.test/', undefined)).toBe(false)
  })

  it('주소를 읽지 못하면 새로 고침이 아니다', () => {
    expect(isDevReload('not a url', dev)).toBe(false)
  })
})
