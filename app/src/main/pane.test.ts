import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaneReply } from '../shared/pane'
import { CliError, InvalidParams } from './cli-server'
import { createPanes, type PaneChannel } from './pane'

const A = 'p-0000000a'
const B = 'p-0000000b'

function setup({ window = true, ready = true } = {}) {
  const sent: { channel: PaneChannel; id: number; arg: unknown }[] = []
  const cells = new Map([[A, 'c-0000000a']])
  const panes = createPanes(
    (channel, id, arg) => {
      if (!window) return false
      sent.push({ channel, id, arg })
      return true
    },
    (pty) => cells.get(pty),
    1000
  )
  if (ready) panes.ready()
  const answer = (reply: PaneReply) => panes.reply(sent.at(-1)!.id, reply)
  return { ...panes, sent, answer, cells }
}

afterEach(() => vi.useRealTimers())

describe('pane.new', () => {
  it('부른 pty 와 함께 창에 넘기고, 창이 알려 준 새 pty 를 돌려준다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['pane.new']({ cwd: '/a b', direction: 'down', command: ['x', ''] }, A)
    expect(sent).toEqual([
      {
        channel: 'pane:new',
        id: 0,
        arg: { pty: A, cwd: '/a b', direction: 'down', full: false, command: ['x', ''] }
      }
    ])
    answer({ pty: B })
    await expect(done).resolves.toEqual({ pty: B })
  })

  it('명령이 없으면 창에도 넘기지 않는다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['pane.new']({ cwd: '/', direction: 'right' }, A) as Promise<unknown>
    expect(sent[0].arg).toEqual({ pty: A, cwd: '/', direction: 'right', full: false })
    answer({ pty: B })
    await done
  })

  it('full 을 창에 넘기고, 없으면 false 로 넘긴다', async () => {
    const { handlers, sent, answer } = setup()
    for (const params of [{ full: true }, {}]) {
      const done = handlers['pane.new'](
        { cwd: '/', direction: 'down', ...params },
        A
      ) as Promise<unknown>
      answer({ pty: B })
      await done
    }
    expect(sent.map((s) => (s.arg as { full: boolean }).full)).toEqual([true, false])
  })

  it.each([
    [{ cwd: 'rel', direction: 'right' }],
    [{ cwd: '/', direction: 'right', full: 'yes' }],
    [{ cwd: '/', direction: 'right', full: 1 }],
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

  it('부른 pty 의 pane 이 없으면 invalid_params, pty 를 띄우지 못하면 그 이유로 실패한다', async () => {
    const { handlers, answer } = setup()
    const missing = handlers['pane.new']({ cwd: '/', direction: 'right' }, A)
    answer({ error: 'no_pane', message: 'no pane for p-0000000a' })
    await expect(missing).rejects.toThrow(InvalidParams)
    const failed = handlers['pane.new']({ cwd: '/', direction: 'right' }, A) as Promise<unknown>
    answer({ error: 'open_failed', message: 'cannot spawn' })
    const err = await failed.catch((e: Error) => e)
    expect(err).not.toBeInstanceOf(InvalidParams)
    expect((err as Error).message).toBe('cannot spawn')
  })

  it('나눌 자리가 없으면 no_space 로 실패한다', async () => {
    const { handlers, answer } = setup()
    const cramped = handlers['pane.new']({ cwd: '/', direction: 'right' }, A) as Promise<unknown>
    answer({ error: 'no_space', message: 'no space for a new pane' })
    const err = await cramped.catch((e: Error) => e)
    expect(err).toBeInstanceOf(CliError)
    expect(err).toMatchObject({
      code: -32001,
      reason: 'no_space',
      message: 'no space for a new pane'
    })
  })

  it('창이 없으면 바로 실패한다', async () => {
    const { handlers } = setup({ window: false })
    await expect(handlers['pane.new']({ cwd: '/', direction: 'right' }, A)).rejects.toThrow(
      'no window'
    )
  })

  it('창이 답하지 않으면 기다리기를 그만두고 창에 취소를 보내며, 늦게 온 답은 버린다', async () => {
    vi.useFakeTimers()
    const { handlers, sent, reply } = setup()
    const done = handlers['pane.new']({ cwd: '/', direction: 'right' }, A) as Promise<unknown>
    const caught = done.catch((e: Error) => e.message)
    vi.advanceTimersByTime(1000)
    expect(await caught).toMatch('did not answer')
    expect(sent.map(({ channel, id }) => [channel, id])).toEqual([
      ['pane:new', 0],
      ['pane:cancel', 0]
    ])
    expect(() => reply(0, { pty: B })).not.toThrow()
  })

  it('창이 실패로 답하면 취소를 보내지 않는다', async () => {
    const { handlers, sent, answer } = setup()
    const failed = handlers['pane.new']({ cwd: '/', direction: 'right' }, A)
    answer({ error: 'open_failed', message: 'cannot spawn' })
    await expect(failed).rejects.toThrow('cannot spawn')
    expect(sent.map((s) => s.channel)).toEqual(['pane:new'])
  })
})

describe('창이 준비되기 전', () => {
  it('요청을 쌓아 두었다가 준비되면 온 순서대로 넘긴다', async () => {
    const { handlers, sent, ready, reply } = setup({ ready: false })
    const first = handlers['pane.new']({ cwd: '/', direction: 'right' }, A)
    const second = handlers['pane.close']({ target: B }, A)
    expect(sent).toEqual([])
    ready()
    expect(sent.map(({ channel, id }) => [channel, id])).toEqual([
      ['pane:new', 0],
      ['pane:close', 1]
    ])
    reply(0, { pty: B })
    reply(1, null)
    await expect(first).resolves.toEqual({ pty: B })
    await expect(second).resolves.toBeNull()
  })

  it('cell 은 쌓을 때가 아니라 넘길 때 정한다', async () => {
    const { handlers, sent, ready, answer, cells } = setup({ ready: false })
    const done = handlers['cell.new']({ cwd: '/' }, B)
    cells.set(B, 'c-0000000b')
    ready()
    expect(sent[0].arg).toEqual({ cell: 'c-0000000b', cwd: '/' })
    answer({ pty: A })
    await done
  })

  it('기다리는 시간도 시간 초과에 들고, 시간 초과한 요청은 준비돼도 넘기지 않으며 취소도 보내지 않는다', async () => {
    vi.useFakeTimers()
    const { handlers, sent, ready } = setup({ ready: false })
    const caught = (
      handlers['pane.new']({ cwd: '/', direction: 'right' }, A) as Promise<unknown>
    ).catch((e: Error) => e.message)
    vi.advanceTimersByTime(1000)
    expect(await caught).toMatch('did not answer')
    ready()
    expect(sent).toEqual([])
  })

  it('준비된 뒤 창이 없으면 쌓인 요청은 실패한다', async () => {
    const { handlers, ready } = setup({ window: false, ready: false })
    const done = handlers['pane.new']({ cwd: '/', direction: 'right' }, A)
    ready()
    await expect(done).rejects.toThrow('no window')
  })

  it('넘기다 던지면 그 요청만 실패하고 나머지는 넘긴다', async () => {
    const sent: number[] = []
    const panes = createPanes(
      (_channel, id) => {
        if (id === 0) throw new Error('boom')
        sent.push(id)
        return true
      },
      () => undefined,
      1000
    )
    const first = panes.handlers['pane.close']({ target: B }, A)
    const second = panes.handlers['pane.close']({ target: B }, A)
    panes.ready()
    await expect(first).rejects.toThrow('boom')
    expect(sent).toEqual([1])
    panes.reply(1, null)
    await expect(second).resolves.toBeNull()
  })

  it('새 문서로 바뀌면 다시 준비될 때까지 쌓는다', async () => {
    const { handlers, sent, ready, unready, reply } = setup()
    unready()
    const done = handlers['pane.close']({ target: B }, A)
    expect(sent).toEqual([])
    ready()
    ready()
    expect(sent).toHaveLength(1)
    reply(0, null)
    await done
  })
})

describe('cell.new', () => {
  it('부른 pty 의 cell 과 함께 창에 넘기고, 창이 알려 준 새 pty 를 돌려준다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['cell.new']({ cwd: '/a b', command: ['x', ''] }, A)
    expect(sent).toEqual([
      {
        channel: 'cell:new',
        id: 0,
        arg: { cell: 'c-0000000a', cwd: '/a b', command: ['x', ''] }
      }
    ])
    answer({ pty: B })
    await expect(done).resolves.toEqual({ pty: B })
  })

  it('명령이 없거나 부른 pty 의 cell 을 모르면 창에도 넘기지 않는다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['cell.new']({ cwd: '/' }, B) as Promise<unknown>
    expect(sent[0].arg).toEqual({ cwd: '/' })
    answer({ pty: A })
    await done
  })

  it.each([
    [{ cwd: 'rel' }],
    [{}],
    [{ cwd: '/', command: [] }],
    [{ cwd: '/', command: 'ls' }],
    [{ cwd: '/', command: ['ls', 1] }]
  ])('맞지 않는 params %j 는 창에 넘기지 않고 거절한다', async (params) => {
    const { handlers, sent } = setup()
    await expect(handlers['cell.new'](params, A)).rejects.toBeInstanceOf(InvalidParams)
    expect(sent).toEqual([])
  })

  it('창이 pty 없이 답하면 실패한다', async () => {
    const { handlers, answer } = setup()
    const empty = handlers['cell.new']({ cwd: '/' }, A)
    answer(null)
    await expect(empty).rejects.toThrow('without a pty')
  })
})

describe('mate.list', () => {
  const row = {
    pty: A,
    state: 'blocked' as const,
    kind: 'permission' as const,
    workspace: 'ai-maru',
    cell: 'ai-maru main',
    dir: '/r',
    message: 'Bash'
  }

  it('창에 묻고 창이 돌려준 줄을 그대로 돌려준다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['mate.list']({}, A)
    expect(sent).toEqual([{ channel: 'mate:list', id: 0, arg: null }])
    answer({ mates: [row] })
    await expect(done).resolves.toEqual({ mates: [row] })
  })

  it('창이 줄 없이 답하면 실패한다', async () => {
    const { handlers, answer } = setup()
    const done = handlers['mate.list']({}, A)
    answer(null)
    await expect(done).rejects.toThrow('without mates')
  })

  it('창이 실패로 답하면 그 이유로 실패한다', async () => {
    const { handlers, answer } = setup()
    const done = handlers['mate.list']({}, A)
    answer({ error: 'open_failed', message: 'boom' })
    await expect(done).rejects.toThrow('boom')
  })

  it('창이 답하지 않으면 시간 초과로 실패한다', async () => {
    vi.useFakeTimers()
    const { handlers } = setup()
    const caught = (handlers['mate.list']({}, A) as Promise<unknown>).catch((e: Error) => e.message)
    vi.advanceTimersByTime(1000)
    expect(await caught).toMatch('did not answer')
  })

  it('창이 준비되기 전에 온 요청은 준비된 뒤에 넘긴다', async () => {
    const { handlers, sent, ready, answer } = setup({ ready: false })
    const done = handlers['mate.list']({}, A)
    expect(sent).toEqual([])
    ready()
    answer({ mates: [] })
    await expect(done).resolves.toEqual({ mates: [] })
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
    answer({ error: 'no_pane', message: 'no pane for p-0000000b' })
    await expect(missing).rejects.toBeInstanceOf(InvalidParams)
  })

  it('pty id 가 아닌 target 은 창에 넘기지 않는다', async () => {
    const { handlers, sent } = setup()
    await expect(handlers['pane.close']({ target: '../x' }, A)).rejects.toBeInstanceOf(
      InvalidParams
    )
    expect(sent).toEqual([])
  })
})
