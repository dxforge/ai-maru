import { InvalidParams, type Handlers } from './cli-server'
import { isSessionId } from './session'

/** 알림 한 줄에 싣는 본문의 길이(코드 포인트). 넘는 본문은 `maru inbox read` 로 읽는다. */
export const PREVIEW_CHARS = 240
const NOTE = 'run `maru inbox read` for the full message'

export type InboxLimits = { perSession: number; total: number; ttlMs: number }
const LIMITS: InboxLimits = { perSession: 500, total: 5000, ttlMs: 24 * 60 * 60 * 1000 }

type Message = { to: string; from: string; text: string; at: number }

function preview(text: string): string | null {
  if (text.length <= PREVIEW_CHARS) return null
  let count = 0
  let end = 0
  for (const ch of text) {
    if (count === PREVIEW_CHARS) return text.slice(0, end)
    count++
    end += ch.length
  }
  return null
}

export function createInbox({
  isLive,
  emit,
  now = Date.now,
  limits = LIMITS
}: {
  isLive: (session: string) => Promise<boolean>
  emit: (session: string, event: object) => boolean
  now?: () => number
  limits?: InboxLimits
}): Handlers {
  // 받은 순서대로다.
  let messages: Message[] = []

  function expire(): void {
    const cutoff = now() - limits.ttlMs
    if (messages.length && messages[0].at <= cutoff) {
      messages = messages.filter((m) => m.at > cutoff)
    }
  }

  // 앱은 세션이 끝났다는 알림을 받지 않는다.
  async function dropEnded(): Promise<void> {
    const owners = [...new Set(messages.map((m) => m.to))]
    const live = await Promise.all(owners.map(isLive))
    const ended = new Set(owners.filter((_, i) => !live[i]))
    if (ended.size) messages = messages.filter((m) => !ended.has(m.to))
  }

  function store(m: Message): void {
    messages.push(m)
    if (messages.filter((o) => o.to === m.to).length > limits.perSession) {
      messages.splice(
        messages.findIndex((o) => o.to === m.to),
        1
      )
    }
    if (messages.length > limits.total) messages.splice(0, messages.length - limits.total)
  }

  return {
    'inbox.push': async (params, from) => {
      const { to, text } = params
      if (!isSessionId(to)) throw new InvalidParams('params.to must be a session id')
      if (typeof text !== 'string' || text.trim() === '') {
        throw new InvalidParams('params.text must be a string that is not blank')
      }
      const [live] = await Promise.all([isLive(to), dropEnded()])
      if (!live) throw new InvalidParams(`session ${to} has ended`)
      expire()
      const cut = preview(text)
      const event = {
        event: 'inbox',
        from,
        body: cut ?? text,
        ...(cut !== null && { truncated: true, note: NOTE })
      }
      if (emit(to, event) && cut === null) return null
      store({ to, from, text, at: now() })
      return null
    },
    'inbox.read': (_params, session) => {
      expire()
      const mine = messages.filter((m) => m.to === session)
      messages = messages.filter((m) => m.to !== session)
      return { messages: mine.map(({ from, text }) => ({ from, text })) }
    }
  }
}
