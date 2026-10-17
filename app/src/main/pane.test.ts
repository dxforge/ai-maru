import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaneReply } from '../shared/pane'
import { InvalidParams } from './cli-server'
import { createPanes, type PaneChannel } from './pane'

const A = 's-0000000a'
const B = 's-0000000b'

function setup({ window = true } = {}) {
  const sent: { channel: PaneChannel; id: number; arg: unknown }[] = []
  const panes = createPanes((channel, id, arg) => {
    if (!window) return false
    sent.push({ channel, id, arg })
    return true
  }, 1000)
  const answer = (reply: PaneReply) => panes.reply(sent.at(-1)!.id, reply)
  return { ...panes, sent, answer }
}

afterEach(() => vi.useRealTimers())

describe('pane.new', () => {
  it('부른 세션과 함께 창에 넘기고, 창이 알려 준 새 세션을 돌려준다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['pane.new']({ cwd: '/a b', direction: 'down', command: ['x', ''] }, A)
    expect(sent).toEqual([
      {
        channel: 'pane:new',
        id: 0,
        arg: { session: A, cwd: '/a b', direction: 'down', command: ['x', ''] }
      }
    ])
    answer({ session: B })
    await expect(done).resolves.toEqual({ session: B })
  })

  it('명령이 없으면 창에도 넘기지 않는다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['pane.new']({ cwd: '/', direction: 'right' }, A) as Promise<unknown>
    expect(sent[0].arg).toEqual({ session: A, cwd: '/', direction: 'right' })
    answer({ session: B })
    await done
  })

  it.each([
    [{ cwd: 'rel', direction: 'right' }],
    [{ direction: 'right' }],
    [{ cwd: '/', direction: 'left' }],
    [{ cwd: '/', direction: 'right', command: [] }],
    [{ cwd: '/', direction: 'right', command: 'ls' }],
    [{ cwd: '/', direction: 'right', command: ['ls', 1] }]
  ])('맞지 않는 params %j 는 창에 넘기지 않고 거절한다', async (params) => {
    const { handlers, sent } = setup()
    await expect(handlers['pane.new'](params, A)).rejects.toBeInstanceOf(InvalidParams)
    expect(sent).toEqual([])
  })

  it('부른 세션의 pane 이 없으면 invalid_params, 세션을 띄우지 못하면 그 이유로 실패한다', async () => {
    const { handlers, answer } = setup()
    const missing = handlers['pane.new']({ cwd: '/', direction: 'right' }, A)
    answer({ error: 'no_pane', message: 'no pane for s-0000000a' })
    await expect(missing).rejects.toThrow(InvalidParams)
    const failed = handlers['pane.new']({ cwd: '/', direction: 'right' }, A) as Promise<unknown>
    answer({ error: 'open_failed', message: 'cannot spawn' })
    const err = await failed.catch((e: Error) => e)
    expect(err).not.toBeInstanceOf(InvalidParams)
    expect((err as Error).message).toBe('cannot spawn')
  })

  it('창이 없으면 바로 실패한다', async () => {
    const { handlers } = setup({ window: false })
    await expect(handlers['pane.new']({ cwd: '/', direction: 'right' }, A)).rejects.toThrow(
      'no window'
    )
  })

  it('창이 답하지 않으면 기다리기를 그만두고, 늦게 온 답은 버린다', async () => {
    vi.useFakeTimers()
    const { handlers, answer } = setup()
    const done = handlers['pane.new']({ cwd: '/', direction: 'right' }, A) as Promise<unknown>
    const caught = done.catch((e: Error) => e.message)
    vi.advanceTimersByTime(1000)
    expect(await caught).toMatch('did not answer')
    expect(() => answer({ session: B })).not.toThrow()
  })
})

describe('pane.close', () => {
  it('target 을 창에 넘기고, 없는 pane 이면 invalid_params', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['pane.close']({ target: B }, A)
    expect(sent[0]).toEqual({ channel: 'pane:close', id: 0, arg: B })
    answer(null)
    await expect(done).resolves.toBeNull()
    const missing = handlers['pane.close']({ target: B }, A)
    answer({ error: 'no_pane', message: 'no pane for s-0000000b' })
    await expect(missing).rejects.toBeInstanceOf(InvalidParams)
  })

  it('세션 id 가 아닌 target 은 창에 넘기지 않는다', async () => {
    const { handlers, sent } = setup()
    await expect(handlers['pane.close']({ target: '../x' }, A)).rejects.toBeInstanceOf(
      InvalidParams
    )
    expect(sent).toEqual([])
  })
})
