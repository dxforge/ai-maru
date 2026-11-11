import { describe, expect, it, vi } from 'vitest'
import type { PtyNotification } from '../shared/pty-state'
import { InvalidParams } from './cli-server'
import { createClaudeNotifications, lineText } from './claude-notification'

function setup() {
  const leaders = new Map<string, number>([['p-1', 100]])
  const leader = vi.fn(async (pty: string) => {
    const pid = leaders.get(pty)
    if (pid === undefined) throw new Error(`pty ${pty} has ended`)
    return pid
  })
  const notified: [string, PtyNotification][] = []
  const shown: PtyNotification[] = []
  const c = createClaudeNotifications({
    leader,
    notify: (pty, n) => void notified.push([pty, n])
  })
  const hook = (params: Record<string, unknown>, pty = 'p-1'): unknown =>
    c.handlers['claude.notification'](params, pty)
  const osc = (body: string, pty = 'p-1'): Promise<void> =>
    c.terminal(pty, { title: '', body }, (n) => void shown.push(n))
  return { c, leaders, leader, notified, shown, hook, osc }
}

describe('claude.notification', () => {
  it('알림을 그 pty 에 넣고 null 로 답한다', async () => {
    const t = setup()
    const params = { type: 'permission_prompt', message: 'Claude needs your permission' }
    expect(await t.hook(params)).toBeNull()
    expect(t.notified).toEqual([['p-1', { title: '', body: 'Claude needs your permission' }]])
  })

  it('title 이 오면 제목으로 싣고, 종류가 없는 알림도 넣는다', async () => {
    const t = setup()
    await t.hook({ type: 'plugin_notification', message: 'm', title: 'T' })
    await t.hook({ message: 'n' })
    expect(t.notified).toEqual([
      ['p-1', { title: 'T', body: 'm' }],
      ['p-1', { title: '', body: 'n' }]
    ])
  })

  it('idle_prompt 는 넣지 않는다', async () => {
    const t = setup()
    await t.hook({ type: 'idle_prompt', message: 'Claude is waiting for your input' })
    expect(t.notified).toEqual([])
  })

  it('글을 maru-pty 처럼 한 줄로 다듬고, 다듬어 둘 다 비면 넣지 않는다', async () => {
    const t = setup()
    await t.hook({ type: 'permission_prompt', message: ' a\nb\tc\r\u0007\u009b ', title: '\n' })
    await t.hook({ type: 'permission_prompt', message: ' \n ' })
    expect(t.notified).toEqual([['p-1', { title: '', body: 'a b c' }]])
  })

  it('맞지 않는 params 는 거절한다', async () => {
    const t = setup()
    for (const params of [
      {},
      { message: 1 },
      { message: 'm', type: 1 },
      { message: 'm', title: null }
    ]) {
      await expect(t.hook(params)).rejects.toThrow(InvalidParams)
    }
    expect(t.notified).toEqual([])
  })
})

describe('claude pane 의 OSC 알림', () => {
  it('hook 을 받은 적 없는 pty 의 OSC 알림은 리더를 재지 않고 보인다', async () => {
    const t = setup()
    await t.osc('a')
    expect(t.shown).toEqual([{ title: '', body: 'a' }])
    expect(t.leader).not.toHaveBeenCalled()
  })

  it('hook 을 받은 때와 리더가 같으면 버린다 — idle_prompt 로 받았어도 같다', async () => {
    const t = setup()
    await t.hook({ type: 'idle_prompt', message: 'w' })
    await t.osc('w')
    await t.hook({ type: 'permission_prompt', message: 'p' })
    await t.osc('p')
    expect(t.shown).toEqual([])
  })

  it('리더가 바뀌면 보이고 기억을 지워, 그 뒤로는 리더를 재지 않는다', async () => {
    const t = setup()
    await t.hook({ type: 'permission_prompt', message: 'p' })
    t.leaders.set('p-1', 200)
    await t.osc('a')
    expect(t.shown).toEqual([{ title: '', body: 'a' }])
    t.leader.mockClear()
    await t.osc('b')
    expect(t.shown).toHaveLength(2)
    expect(t.leader).not.toHaveBeenCalled()
  })

  it('리더를 재는 동안 온 OSC 알림은 앞의 것을 앞지르지 않고 온 순서대로 보인다', async () => {
    const t = setup()
    await t.hook({ type: 'permission_prompt', message: 'p' })
    t.leaders.set('p-1', 200)
    let answer!: (pid: number) => void
    t.leader.mockImplementationOnce(() => new Promise((r) => (answer = r)))
    const first = t.osc('first')
    const second = t.osc('second')
    const third = t.osc('third')
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    answer(200)
    await Promise.all([first, second, third])
    expect(t.shown.map((n) => n.body)).toEqual(['first', 'second', 'third'])
  })

  it('OSC 를 받을 때 리더를 재지 못하면 보이되 기억은 둔다', async () => {
    const t = setup()
    await t.hook({ type: 'permission_prompt', message: 'p' })
    t.leader.mockRejectedValueOnce(new Error('cannot read'))
    await t.osc('a')
    await t.osc('b')
    expect(t.shown).toEqual([{ title: '', body: 'a' }])
  })

  it('hook 을 받을 때 리더를 재지 못하면 알림은 넣고 OSC 는 버리지 않는다', async () => {
    const t = setup()
    await t.hook({ type: 'permission_prompt', message: 'p' }, 'p-2')
    expect(t.notified).toEqual([['p-2', { title: '', body: 'p' }]])
    await t.osc('p', 'p-2')
    expect(t.shown).toEqual([{ title: '', body: 'p' }])
  })

  it('기억은 pty 마다 따로이고, forget 하면 지운다', async () => {
    const t = setup()
    t.leaders.set('p-2', 100)
    await t.hook({ type: 'permission_prompt', message: 'p' })
    await t.osc('other', 'p-2')
    t.c.forget('p-1')
    await t.osc('again')
    expect(t.shown.map((n) => n.body)).toEqual(['other', 'again'])
  })
})

describe('lineText', () => {
  it('줄바꿈·탭은 공백으로, 그 밖의 C0·DEL·C1 은 지우고 앞뒤 공백을 뗀다', () => {
    expect(lineText('\u0000 x\ny\tz\u007f\u0085 ')).toBe('x y z')
  })
})
