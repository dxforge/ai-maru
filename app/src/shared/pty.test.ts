import { describe, expect, it } from 'vitest'
import { exitMessage, failedExit } from './pty'

describe('failedExit', () => {
  it('0 이 아닌 코드나 시그널은 실패이고, 0 과 종료 상태를 모르는 것은 실패가 아니다', () => {
    expect(failedExit({ code: 3, signal: null })).toBe(true)
    expect(failedExit({ code: 130, signal: null })).toBe(true)
    expect(failedExit({ code: null, signal: 9 })).toBe(true)
    expect(failedExit({ code: 0, signal: null })).toBe(false)
    expect(failedExit({ code: null, signal: null })).toBe(false)
  })
})

describe('exitMessage', () => {
  it('시그널로 끝났으면 시그널 번호를, 아니면 종료 코드를 적는다', () => {
    expect(exitMessage({ code: 3, signal: null })).toBe('[exited with code 3]')
    expect(exitMessage({ code: null, signal: 9 })).toBe('[exited with signal 9]')
  })
})
