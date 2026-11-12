import { describe, expect, it } from 'vitest'
import { clampLine, CodeBody, HIGHLIGHT_MAX_CHARS, prepareCode } from './code'

describe('prepareCode', () => {
  it('CRLF 를 LF 로 바꾸고, 끝의 줄바꿈 하나는 줄로 세지 않는다', () => {
    expect(prepareCode('a\r\nb\r\n')).toEqual({ code: 'a\nb', count: 2 })
    expect(prepareCode('a\n\n')).toEqual({ code: 'a\n', count: 2 })
    expect(prepareCode('a')).toEqual({ code: 'a', count: 1 })
    expect(prepareCode('')).toEqual({ code: '', count: 1 })
  })
})

describe('clampLine', () => {
  it('줄이 없거나 1보다 작으면 없고, 줄 수를 넘으면 마지막 줄이다', () => {
    expect(clampLine(undefined, 5)).toBeUndefined()
    expect(clampLine(0, 5)).toBeUndefined()
    expect(clampLine(1, 5)).toBe(1)
    expect(clampLine(5, 5)).toBe(5)
    expect(clampLine(99, 5)).toBe(5)
  })
})

describe('CodeBody', () => {
  it('본문마다 id 가 다르다 — 늦게 온 강조 결과를 가리는 데 쓴다', () => {
    const a = new CodeBody('x', 'a.ts')
    const b = new CodeBody('x', 'a.ts')
    expect(a.id).not.toBe(b.id)
    expect(new CodeBody('a\r\nb\r\nc', 'a.ts', 3).line).toBe(3)
  })
})

describe('CodeBody.highlighted', () => {
  it('기준보다 긴 파일은 worker 에 보내지 않고 강조 없이 둔다', async () => {
    const body = new CodeBody('x'.repeat(HIGHLIGHT_MAX_CHARS + 1), 'a.ts')
    expect(body.html).toBeUndefined()
    expect(await body.highlighted()).toBeNull()
    expect(body.html).toBeNull()
  })
})
