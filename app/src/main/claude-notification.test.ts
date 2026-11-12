import { describe, expect, it } from 'vitest'
import type { PtyNotification } from '../shared/pty-state'
import { InvalidParams } from './cli-server'
import { claudeNotificationHandlers, lineText } from './claude-notification'

function setup() {
  const notified: [string, PtyNotification][] = []
  const handlers = claudeNotificationHandlers((pty, n) => void notified.push([pty, n]))
  const hook = (params: Record<string, unknown>, pty = 'p-1'): unknown =>
    handlers['claude.notification'](params, pty)
  return { notified, hook }
}

describe('claude.notification', () => {
  it('상태 레코드가 같은 내용을 보이는 종류는 글 없는 알림으로 넣고 null 로 답한다', () => {
    const t = setup()
    for (const type of ['permission_prompt', 'idle_prompt', 'elicitation_dialog']) {
      expect(t.hook({ type, message: 'Claude needs your permission', title: 'T' })).toBeNull()
    }
    t.hook({ type: 'permission_prompt', message: '' })
    expect(t.notified).toEqual([
      ['p-1', { title: '', body: '' }],
      ['p-1', { title: '', body: '' }],
      ['p-1', { title: '', body: '' }],
      ['p-1', { title: '', body: '' }]
    ])
  })

  it('그 밖의 종류와 종류가 없는 알림은 글을 싣고, title 이 오면 제목으로 싣는다', () => {
    const t = setup()
    expect(t.hook({ type: 'push_notification', message: 'm', title: 'T' })).toBeNull()
    t.hook({ type: 'some_new_type', message: 'n' })
    t.hook({ message: 'o' })
    expect(t.notified).toEqual([
      ['p-1', { title: 'T', body: 'm' }],
      ['p-1', { title: '', body: 'n' }],
      ['p-1', { title: '', body: 'o' }]
    ])
  })

  it('글을 maru-pty 처럼 한 줄로 다듬고, 다듬어 둘 다 비면 넣지 않는다', () => {
    const t = setup()
    t.hook({ type: 'push_notification', message: ' a\nb\tc\r\u0007\u009b ', title: '\n' })
    t.hook({ type: 'push_notification', message: ' \n ' })
    expect(t.notified).toEqual([['p-1', { title: '', body: 'a b c' }]])
  })

  it('맞지 않는 params 는 거절한다', () => {
    const t = setup()
    for (const params of [
      {},
      { message: 1 },
      { message: 'm', type: 1 },
      { message: 'm', title: null },
      { type: 'permission_prompt' }
    ]) {
      expect(() => t.hook(params)).toThrow(InvalidParams)
    }
    expect(t.notified).toEqual([])
  })
})

describe('lineText', () => {
  it('줄바꿈·탭은 공백으로, 그 밖의 C0·DEL·C1 은 지우고 앞뒤 공백을 뗀다', () => {
    expect(lineText('\u0000 x\ny\tz\u007f\u0085 ')).toBe('x y z')
  })
})
