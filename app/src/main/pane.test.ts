import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaneReply } from '../shared/pane'
import { CliError, InvalidParams } from './cli-server'
import { createPanes, type PaneChannel } from './pane'
import { createWindowReady } from './window-ready'

const A = 'p-0000000a'
const B = 'p-0000000b'

function setup({ window = true, ready = true } = {}) {
  const sent: { channel: PaneChannel; id: number; arg: unknown }[] = []
  const cells = new Map([[A, 'c-0000000a']])
  const windowReady = createWindowReady()
  const panes = createPanes(
    (channel, id, arg) => {
      if (!window) return false
      sent.push({ channel, id, arg })
      return true
    },
    (pty) => cells.get(pty),
    windowReady,
    1000
  )
  if (ready) windowReady.ready()
  const answer = (reply: PaneReply) => panes.reply(sent.at(-1)!.id, reply)
  return { ...panes, ready: windowReady.ready, unready: windowReady.unready, sent, answer, cells }
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

  it('cell 을 창에 넘기고, 없으면 넘기지 않는다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['pane.new'](
      { cwd: '/', direction: 'right', cell: 'c-0000000b' },
      A
    ) as Promise<unknown>
    expect(sent[0].arg).toEqual({
      pty: A,
      cwd: '/',
      direction: 'right',
      full: false,
      cell: 'c-0000000b'
    })
    answer({ pty: B })
    await expect(done).resolves.toEqual({ pty: B })
  })

  it('가리킨 cell 이 창에 없으면 invalid_params', async () => {
    const { handlers, answer } = setup()
    const done = handlers['pane.new']({ cwd: '/', direction: 'right', cell: 'c-0000000b' }, A)
    answer({ error: 'no_cell', message: 'no cell c-0000000b' })
    await expect(done).rejects.toBeInstanceOf(InvalidParams)
    await expect(done).rejects.toThrow('no cell c-0000000b')
  })

  it.each([
    [{ cwd: 'rel', direction: 'right' }],
    [{ cwd: '/', direction: 'right', cell: 'ai-maru main' }],
    [{ cwd: '/', direction: 'right', cell: A }],
    [{ cwd: '/', direction: 'right', cell: '' }],
    [{ cwd: '/', direction: 'right', cell: null }],
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
    answer({ pty: A, cell: 'c-0000000c' })
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
    const windowReady = createWindowReady()
    const panes = createPanes(
      (_channel, id) => {
        if (id === 0) throw new Error('boom')
        sent.push(id)
        return true
      },
      () => undefined,
      windowReady,
      1000
    )
    const first = panes.handlers['pane.close']({ target: B }, A)
    const second = panes.handlers['pane.close']({ target: B }, A)
    windowReady.ready()
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
  it('부른 pty 의 cell 과 함께 창에 넘기고, 창이 알려 준 새 pty 와 cell 을 돌려준다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['cell.new']({ cwd: '/a b', command: ['x', ''] }, A)
    expect(sent).toEqual([
      {
        channel: 'cell:new',
        id: 0,
        arg: { cell: 'c-0000000a', cwd: '/a b', command: ['x', ''] }
      }
    ])
    answer({ pty: B, cell: 'c-0000000c' })
    await expect(done).resolves.toEqual({ pty: B, cell: 'c-0000000c' })
  })

  it('명령이 없거나 부른 pty 의 cell 을 모르면 창에도 넘기지 않는다', async () => {
    const { handlers, sent, answer } = setup()
    const done = handlers['cell.new']({ cwd: '/' }, B) as Promise<unknown>
    expect(sent[0].arg).toEqual({ cwd: '/' })
    answer({ pty: A, cell: 'c-0000000c' })
    await done
  })

  it('창이 cell 없이 답하면 실패한다', async () => {
    const { handlers, answer } = setup()
    const done = handlers['cell.new']({ cwd: '/' }, A)
    answer({ pty: B })
    await expect(done).rejects.toThrow('without a cell')
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

  it.each([
    ['after', false],
    ['before', true]
  ] as const)('%s 로 가리킨 pty 의 cell 을 place 로 넘긴다', async (key, before) => {
    const { handlers, sent, answer, cells } = setup()
    cells.set(B, 'c-0000000b')
    const done = handlers['cell.new']({ cwd: '/', [key]: B }, A)
    expect(sent[0].arg).toEqual({
      cell: 'c-0000000a',
      cwd: '/',
      place: { cell: 'c-0000000b', before }
    })
    answer({ pty: 'p-0000000c', cell: 'c-0000000c' })
    await done
  })

  it('가리킨 cell 도 쌓을 때가 아니라 넘길 때 정한다', async () => {
    const { handlers, sent, ready, answer, cells } = setup({ ready: false })
    const done = handlers['cell.new']({ cwd: '/', before: B }, A)
    cells.set(B, 'c-0000000b')
    ready()
    expect(sent[0].arg).toMatchObject({ place: { cell: 'c-0000000b', before: true } })
    answer({ pty: 'p-0000000c', cell: 'c-0000000c' })
    await done
  })

  it('가리킨 pty 의 cell 을 모르면 창에 넘기지 않고 invalid_params', async () => {
    const { handlers, sent } = setup()
    await expect(handlers['cell.new']({ cwd: '/', after: B }, A)).rejects.toBeInstanceOf(
      InvalidParams
    )
    expect(sent).toEqual([])
  })

  it.each([
    [{ cwd: '/', after: A, before: A }],
    [{ cwd: '/', after: 'c-0000000a' }],
    [{ cwd: '/', before: 1 }],
    [{ cwd: '/', after: null }]
  ])('맞지 않는 자리 %j 는 창에 넘기지 않고 거절한다', async (params) => {
    const { handlers, sent } = setup()
    await expect(handlers['cell.new'](params, A)).rejects.toBeInstanceOf(InvalidParams)
    expect(sent).toEqual([])
  })

  it('창이 bad_place 로 답하면 invalid_params', async () => {
    const { handlers, answer } = setup()
    const done = handlers['cell.new']({ cwd: '/', after: A }, A)
    answer({ error: 'bad_place', message: 'other workspace' })
    await expect(done).rejects.toBeInstanceOf(InvalidParams)
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
