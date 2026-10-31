import type { CellNewRequest, PaneNewRequest, PaneReply } from '../shared/pane'
import { isCellId, isPtyId } from '../shared/pty'
import {
  CliError,
  InvalidParams,
  optionalBoolean,
  requireCommand,
  requireCwd,
  type Handlers
} from './cli-server'
import { WINDOW_WAIT_MS, type WindowReady } from './window-ready'

export type PaneChannel = 'pane:new' | 'pane:close' | 'cell:new' | 'pane:cancel'

const optionalCommand = (v: unknown): string[] | undefined =>
  v === undefined ? undefined : requireCommand(v)

/**
 * pane 은 renderer 가 들고 있다. `createPanes` 는 pane 요청을 창에 넘기고 `reply` 로 받은 답을 돌려준다.
 * `cellOf` 는 pty(pane 이나 job)의 cell id 를 돌려준다.
 */
export function createPanes(
  send: (channel: PaneChannel, id: number, arg: unknown) => boolean,
  cellOf: (pty: string) => string | undefined,
  windowReady: WindowReady,
  // pty 띄우기는 5초(`SPAWN_TIMEOUT_MS`) 안에 끝나거나 실패하므로 `replyMs` 는 그보다 길게 둔다.
  replyMs = WINDOW_WAIT_MS
): {
  handlers: Handlers
  reply: (id: number, reply: PaneReply) => void
} {
  let nextId = 0
  const pending = new Map<number, (reply: PaneReply) => void>()

  // 되살린 pane 의 cell 은 그 터미널이 `pty:open` 을 보낸 뒤에야 main 이 안다. 그래서 `arg` 는 쌓을
  // 때가 아니라 창에 넘길 때 만든다.
  async function request(channel: PaneChannel, arg: () => unknown): Promise<PaneReply> {
    const id = nextId++
    let sent = false
    let timer: NodeJS.Timeout | undefined
    let unqueue = (): void => {}
    try {
      return await new Promise<PaneReply>((resolve, reject) => {
        pending.set(id, resolve)
        timer = setTimeout(
          () => reject(new Error(`the window did not answer within ${replyMs / 1000}s`)),
          replyMs
        )
        const deliver = (): void => {
          try {
            sent = send(channel, id, arg())
          } catch (err) {
            return reject(err)
          }
          if (!sent) reject(new Error('no window to send the request to'))
        }
        unqueue = windowReady.whenReady(deliver)
      })
    } catch (err) {
      // 보낸 뒤의 실패는 시간 초과뿐이다(docs/architecture.md 의 "시간 초과한 pane 요청은 창이 취소한다").
      if (sent) send('pane:cancel', id, null)
      throw err
    } finally {
      clearTimeout(timer)
      pending.delete(id)
      unqueue()
    }
  }

  async function ask(channel: PaneChannel, arg: () => unknown): Promise<PaneReply> {
    const reply = await request(channel, arg)
    if (reply && 'error' in reply) {
      if (reply.error === 'no_pane' || reply.error === 'no_cell' || reply.error === 'bad_place')
        throw new InvalidParams(reply.message)
      if (reply.error === 'no_space') throw new CliError(-32001, 'no_space', reply.message)
      throw new Error(reply.message)
    }
    return reply
  }

  async function askPty(channel: PaneChannel, arg: () => unknown): Promise<{ pty: string }> {
    const reply = await ask(channel, arg)
    if (!reply || !('pty' in reply)) throw new Error('the window answered without a pty')
    return { pty: reply.pty }
  }

  const handlers: Handlers = {
    'pane.new': async (params, pty) => {
      const cwd = requireCwd(params.cwd)
      const { direction } = params
      if (direction !== 'right' && direction !== 'down') {
        throw new InvalidParams('params.direction must be "right" or "down"')
      }
      const command = optionalCommand(params.command)
      const full = optionalBoolean(params.full, 'full')
      const { cell } = params
      if (cell !== undefined && !isCellId(cell)) {
        throw new InvalidParams('params.cell must be a cell id, e.g. c-1a2b3c4d')
      }
      const req: PaneNewRequest = {
        pty,
        cwd,
        direction,
        full,
        ...(command && { command }),
        ...(cell !== undefined && { cell })
      }
      return askPty('pane:new', () => req)
    },
    'pane.close': async ({ target }) => {
      if (!isPtyId(target)) throw new InvalidParams('params.target must be a pty id')
      await ask('pane:close', () => target)
      return null
    },
    'cell.new': async (params, pty) => {
      const cwd = requireCwd(params.cwd)
      const command = optionalCommand(params.command)
      if (params.after !== undefined && params.before !== undefined) {
        throw new InvalidParams('params.after and params.before cannot be used together')
      }
      const key = params.after !== undefined ? 'after' : 'before'
      const target = params[key]
      if (target !== undefined && !isPtyId(target)) {
        throw new InvalidParams(`params.${key} must be a pty id`)
      }
      const placeOf = (by: string): CellNewRequest['place'] => {
        const cell = cellOf(by)
        if (!cell) throw new InvalidParams(`no cell for pty ${by}`)
        return { cell, before: key === 'before' }
      }
      const reply = await ask('cell:new', (): CellNewRequest => {
        const cell = cellOf(pty)
        const place = target === undefined ? undefined : placeOf(target)
        return { cwd, ...(cell && { cell }), ...(command && { command }), ...(place && { place }) }
      })
      if (!reply || !('pty' in reply)) throw new Error('the window answered without a pty')
      if (!reply.cell) throw new Error('the window answered without a cell')
      return { pty: reply.pty, cell: reply.cell }
    }
  }

  return {
    handlers,
    reply: (id, reply) => pending.get(id)?.(reply)
  }
}
