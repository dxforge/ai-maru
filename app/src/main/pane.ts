import type { PaneNewRequest, PaneReply, WorkspaceNewRequest } from '../shared/pane'
import { isSessionId } from '../shared/session'
import {
  CliError,
  InvalidParams,
  optionalBoolean,
  requireCommand,
  requireCwd,
  type Handlers
} from './cli-server'

// `maru` 의 `TIMEOUT`(main.rs)이 10초이므로 이 오류가 그 안에 닿게 한다. 세션 띄우기는 5초(`SPAWN_TIMEOUT_MS`)
// 안에 끝나거나 실패하므로 그보다는 길다.
const REPLY_MS = 8_000

export type PaneChannel = 'pane:new' | 'pane:close' | 'workspace:new' | 'pane:cancel'

const optionalCommand = (v: unknown): string[] | undefined =>
  v === undefined ? undefined : requireCommand(v)

/**
 * pane 은 renderer 가 들고 있다. `createPanes` 는 요청을 창에 넘기고 `reply` 로 받은 답을 돌려준다.
 * `workspaceOf` 는 세션(pane 이나 job)의 workspace id 를 돌려준다.
 *
 * 호출하는 쪽은 창이 준비됐다고 알리면 `ready` 를, 창이 새 문서로 바뀌면 `unready` 를 부른다. `ready` 를 부르기
 * 전이나 `unready` 를 부른 뒤에 온 요청은 쌓아 두었다가 다음 `ready` 때 넘긴다(`docs/architecture.md` 의 "pane 요청은 창이 준비된 뒤에 넘긴다").
 */
export function createPanes(
  send: (channel: PaneChannel, id: number, arg: unknown) => boolean,
  workspaceOf: (session: string) => string | undefined,
  replyMs = REPLY_MS
): {
  handlers: Handlers
  reply: (id: number, reply: PaneReply) => void
  ready: () => void
  unready: () => void
} {
  let nextId = 0
  let isReady = false
  const pending = new Map<number, (reply: PaneReply) => void>()
  const waiting = new Map<number, () => void>()

  // 되살린 pane 의 workspace 는 그 터미널이 `session:open` 을 보낸 뒤에야 main 이 안다. 그래서 `arg` 는 쌓을
  // 때가 아니라 창에 넘길 때 만든다.
  async function request(channel: PaneChannel, arg: () => unknown): Promise<PaneReply> {
    const id = nextId++
    let sent = false
    let timer: NodeJS.Timeout | undefined
    try {
      return await new Promise<PaneReply>((resolve, reject) => {
        pending.set(id, resolve)
        timer = setTimeout(
          () => reject(new Error(`the window did not answer within ${replyMs / 1000}s`)),
          replyMs
        )
        const deliver = (): void => {
          waiting.delete(id)
          try {
            sent = send(channel, id, arg())
          } catch (err) {
            return reject(err)
          }
          if (!sent) reject(new Error('no window to open the pane in'))
        }
        if (isReady) deliver()
        else waiting.set(id, deliver)
      })
    } catch (err) {
      // 보낸 뒤의 실패는 시간 초과뿐이다(docs/architecture.md 의 "시간 초과한 pane 요청은 창이 취소한다").
      if (sent) send('pane:cancel', id, null)
      throw err
    } finally {
      clearTimeout(timer)
      pending.delete(id)
      waiting.delete(id)
    }
  }

  async function ask(channel: PaneChannel, arg: () => unknown): Promise<PaneReply> {
    const reply = await request(channel, arg)
    if (reply && 'error' in reply) {
      if (reply.error === 'no_pane') throw new InvalidParams(reply.message)
      if (reply.error === 'no_space') throw new CliError(-32001, 'no_space', reply.message)
      throw new Error(reply.message)
    }
    return reply
  }

  async function askSession(
    channel: PaneChannel,
    arg: () => unknown
  ): Promise<{ session: string }> {
    const reply = await ask(channel, arg)
    if (!reply || !('session' in reply)) throw new Error('the window answered without a session')
    return { session: reply.session }
  }

  const handlers: Handlers = {
    'pane.new': async (params, session) => {
      const cwd = requireCwd(params.cwd)
      const { direction } = params
      if (direction !== 'right' && direction !== 'down') {
        throw new InvalidParams('params.direction must be "right" or "down"')
      }
      const command = optionalCommand(params.command)
      const full = optionalBoolean(params.full, 'full')
      const req: PaneNewRequest = { session, cwd, direction, full, ...(command && { command }) }
      return askSession('pane:new', () => req)
    },
    'pane.close': async ({ target }) => {
      if (!isSessionId(target)) throw new InvalidParams('params.target must be a session id')
      await ask('pane:close', () => target)
      return null
    },
    'workspace.new': async (params, session) => {
      const cwd = requireCwd(params.cwd)
      const command = optionalCommand(params.command)
      return askSession('workspace:new', (): WorkspaceNewRequest => {
        const workspace = workspaceOf(session)
        return { cwd, ...(workspace && { workspace }), ...(command && { command }) }
      })
    }
  }

  return {
    handlers,
    reply: (id, reply) => pending.get(id)?.(reply),
    ready: () => {
      isReady = true
      for (const deliver of [...waiting.values()]) deliver()
    },
    unready: () => void (isReady = false)
  }
}
