import type { PaneNewRequest, PaneReply } from '../shared/pane'
import { isSessionId } from '../shared/session'
import {
  InvalidParams,
  optionalBoolean,
  requireCommand,
  requireCwd,
  type Handlers
} from './cli-server'

// `maru` 의 `TIMEOUT`(main.rs)이 10초이므로 이 오류가 그 안에 닿게 한다. 세션 띄우기는 5초(`SPAWN_TIMEOUT_MS`)
// 안에 끝나거나 실패하므로 그보다는 길다.
const REPLY_MS = 8_000

export type PaneChannel = 'pane:new' | 'pane:close'

/** pane 은 renderer 가 들고 있다. `createPanes` 는 요청을 창에 넘기고 `reply` 로 받은 답을 돌려준다. */
export function createPanes(
  send: (channel: PaneChannel, id: number, arg: unknown) => boolean,
  replyMs = REPLY_MS
): { handlers: Handlers; reply: (id: number, reply: PaneReply) => void } {
  let nextId = 0
  const pending = new Map<number, (reply: PaneReply) => void>()

  async function request(channel: PaneChannel, arg: unknown): Promise<PaneReply> {
    const id = nextId++
    // 답은 IPC 로 나중에 오므로 보낸 뒤에 기다려도 놓치지 않는다.
    if (!send(channel, id, arg)) throw new Error('no window to open the pane in')
    let timer: NodeJS.Timeout | undefined
    try {
      return await new Promise<PaneReply>((resolve, reject) => {
        pending.set(id, resolve)
        timer = setTimeout(
          () => reject(new Error(`the window did not answer within ${replyMs / 1000}s`)),
          replyMs
        )
      })
    } finally {
      clearTimeout(timer)
      pending.delete(id)
    }
  }

  async function ask(channel: PaneChannel, arg: unknown): Promise<PaneReply> {
    const reply = await request(channel, arg)
    if (reply && 'error' in reply) {
      throw reply.error === 'no_pane' ? new InvalidParams(reply.message) : new Error(reply.message)
    }
    return reply
  }

  const handlers: Handlers = {
    'pane.new': async (params, session) => {
      const cwd = requireCwd(params.cwd)
      const { direction } = params
      if (direction !== 'right' && direction !== 'down') {
        throw new InvalidParams('params.direction must be "right" or "down"')
      }
      const command = params.command === undefined ? undefined : requireCommand(params.command)
      const full = optionalBoolean(params.full, 'full')
      const req: PaneNewRequest = { session, cwd, direction, full, ...(command && { command }) }
      const reply = await ask('pane:new', req)
      if (!reply || !('session' in reply)) throw new Error('the window answered without a session')
      return { session: reply.session }
    },
    'pane.close': async ({ target }) => {
      if (!isSessionId(target)) throw new InvalidParams('params.target must be a session id')
      await ask('pane:close', target)
      return null
    }
  }

  return { handlers, reply: (id, reply) => pending.get(id)?.(reply) }
}
