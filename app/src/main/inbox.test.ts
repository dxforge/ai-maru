import { describe, expect, it } from 'vitest'
import { InvalidParams } from './cli-server'
import { createInbox, PREVIEW_CHARS, type InboxLimits } from './inbox'

const A = 's-0000000a'
const B = 's-0000000b'
const C = 's-0000000c'
const DAY = 24 * 60 * 60 * 1000

type Read = { messages: { from: string; text: string }[] }

function setup(o: { dead?: string[]; listening?: string[]; limits?: Partial<InboxLimits> } = {}) {
  let t = 1_000_000
  const dead = o.dead ?? []
  const listening = o.listening ?? []
  const sent: { session: string; event: object }[] = []
  const handlers = createInbox({
    isLive: async (s) => !dead.includes(s),
    emit: (session, event) => {
      if (!listening.includes(session)) return false
      sent.push({ session, event })
      return true
    },
    now: () => t,
    limits: { perSession: 500, total: 5000, ttlMs: DAY, ...o.limits }
  })
  const push = (from: string, to: unknown, text: unknown) =>
    handlers['inbox.push']({ to, text }, from)
  const read = async (s: string) => ((await handlers['inbox.read']({}, s)) as Read).messages
  return { push, read, sent, tick: (ms: number) => (t += ms) }
}

describe('inbox.push', () => {
  it.each([['s-1'], ['../x'], ['s-0000000A'], [7]])(
    'to 가 세션 id 가 아니면 거절한다 (%j)',
    async (to) => {
      const { push } = setup()
      await expect(push(A, to, 'hi')).rejects.toThrow(InvalidParams)
    }
  )

  it.each([[''], [' \n'], [3], [undefined]])(
    'text 가 공백만이 아닌 문자열이 아니면 거절한다 (%j)',
    async (text) => {
      const { push } = setup()
      await expect(push(A, B, text)).rejects.toThrow(InvalidParams)
    }
  )

  it('끝난 세션이면 거절한다', async () => {
    const { push } = setup({ dead: [B] })
    await expect(push(A, B, 'hi')).rejects.toThrow(`session ${B} has ended`)
  })

  it('구독자가 없으면 저장하고, read 가 오래된 것부터 돌려준 뒤 지운다', async () => {
    const { push, read } = setup()
    await push(A, B, 'one')
    await push(C, B, 'two\nlines')
    expect(await read(B)).toEqual([
      { from: A, text: 'one' },
      { from: C, text: 'two\nlines' }
    ])
    expect(await read(B)).toEqual([])
  })

  it('read 는 자기 세션 것만 돌려준다', async () => {
    const { push, read } = setup()
    await push(A, B, 'x')
    expect(await read(C)).toEqual([])
    expect(await read(B)).toHaveLength(1)
  })

  it('구독자가 있고 본문이 다 실리면 — 여러 줄이어도 — 알림만 보내고 저장하지 않는다', async () => {
    const { push, read, sent } = setup({ listening: [B] })
    await push(A, B, 'a\nb')
    expect(sent).toEqual([{ session: B, event: { event: 'inbox', from: A, body: 'a\nb' } }])
    expect(await read(B)).toEqual([])
  })

  it('정확히 240자는 자르지 않는다 — 코드 포인트로 세므로 이모지여도', async () => {
    const { push, sent } = setup({ listening: [B] })
    const text = '😀'.repeat(PREVIEW_CHARS)
    await push(A, B, text)
    expect(sent.map((s) => s.event)).toEqual([{ event: 'inbox', from: A, body: text }])
  })

  it('240자를 넘으면 코드 포인트로 세어 앞 240자만 싣고 저장한다', async () => {
    const { push, read, sent } = setup({ listening: [B] })
    const text = '😀'.repeat(PREVIEW_CHARS + 1)
    await push(A, B, text)
    expect(sent.map((s) => s.event)).toEqual([
      {
        event: 'inbox',
        from: A,
        body: '😀'.repeat(PREVIEW_CHARS),
        truncated: true,
        note: 'run `maru inbox read` for the full message'
      }
    ])
    expect(await read(B)).toEqual([{ from: A, text }])
  })

  it('세션별 한도를 넘으면 그 세션의 가장 오래된 것부터 지운다', async () => {
    const { push, read } = setup({ limits: { perSession: 2 } })
    await push(A, C, 'c1')
    for (const t of ['1', '2', '3']) await push(A, B, t)
    expect((await read(B)).map((m) => m.text)).toEqual(['2', '3'])
    expect(await read(C)).toHaveLength(1)
  })

  it('전체 한도를 넘으면 세션을 가리지 않고 가장 오래된 것부터 지운다', async () => {
    const { push, read } = setup({ limits: { total: 2 } })
    await push(A, B, 'b1')
    await push(A, C, 'c1')
    await push(A, B, 'b2')
    expect(await read(B)).toEqual([{ from: A, text: 'b2' }])
    expect(await read(C)).toEqual([{ from: A, text: 'c1' }])
  })

  it('24시간이 지난 메시지는 지운다', async () => {
    const { push, read, tick } = setup()
    await push(A, B, 'old')
    tick(DAY)
    await push(A, B, 'new')
    expect((await read(B)).map((m) => m.text)).toEqual(['new'])
  })

  it('read 도 24시간이 지난 메시지는 돌려주지 않는다', async () => {
    const { push, read, tick } = setup()
    await push(A, B, 'old')
    tick(DAY)
    expect(await read(B)).toEqual([])
  })

  it('push 할 때 끝난 세션의 메시지를 버린다', async () => {
    const dead: string[] = []
    const { push, read } = setup({ dead })
    await push(A, C, 'for c')
    dead.push(C)
    await push(A, B, 'for b')
    dead.length = 0
    expect(await read(C)).toEqual([])
    expect(await read(B)).toHaveLength(1)
  })
})
