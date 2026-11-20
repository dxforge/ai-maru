import type { CellNewRequest, PaneNewRequest, PaneReply, PaneTarget } from '../shared/pane'
import { isCellId, isPaneId, isPtyId } from '../shared/pty'
import {
  CliError,
  InvalidParams,
  optionalBoolean,
  requireCommand,
  REFUSED,
  requireCwd,
  type Handlers
} from './cli-server'
import { WINDOW_WAIT_MS, type WindowReady } from './window-ready'

export type PaneChannel = 'pane:new' | 'pane:close' | 'cell:new' | 'pane:cancel'

const optionalCommand = (v: unknown): string[] | undefined =>
  v === undefined ? undefined : requireCommand(v)

/**
 * pane 은 renderer 가 들고 있다. `createPanes` 는 pane 요청을 창에 넘기고 `reply` 로 받은 답을 돌려준다.
 * `cellOf` 는 pty(pane 이나 job)의 cell id 를 돌려준다. `paneOfPty` 는 화면 snapshot 에서 pty 를 보이는 pane id 를
 * 찾는다. pane id 를 받는 인자에 pty id 가 오면 오류 메시지에 그 pane id 를 적는 데만 쓴다.
 */
export function createPanes(
  send: (channel: PaneChannel, id: number, arg: unknown) => boolean,
  cellOf: (pty: string) => string | undefined,
  paneOfPty: (pty: string) => string | undefined,
  windowReady: WindowReady,
  // pane 의 pty 띄우기에는 시간 제한이 없다. `replyMs` 안에 pty 가 뜨지 않으면 요청이 시간 초과로 실패하고 창이 그 pane 을 닫는다.
  replyMs = WINDOW_WAIT_MS
): {
  handlers: Handlers
  closePty: (pty: string) => Promise<void>
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
      if (reply.error === 'no_space') throw new CliError(REFUSED, 'no_space', reply.message)
      throw new Error(reply.message)
    }
    return reply
  }

  async function askPane(
    channel: PaneChannel,
    arg: () => unknown
  ): Promise<{ pane: string; pty: string; cell?: string }> {
    const reply = await ask(channel, arg)
    if (!reply || !('pty' in reply)) throw new Error('the window answered without a pty')
    return reply
  }

  function requirePane(v: unknown, name: string): string {
    if (isPaneId(v)) return v
    if (isPtyId(v)) {
      const pane = paneOfPty(v)
      const hint = pane ? `its pane is ${pane}` : 'see the PANE column of `maru pane list`'
      throw new InvalidParams(`${v} is a pty, not a pane; ${hint}`)
    }
    throw new InvalidParams(`params.${name} must be a pane id, e.g. n-1a2b3c4d`)
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
      const hidden = optionalBoolean(params.hidden, 'hidden')
      const { cell, pane } = params
      if (cell !== undefined && !isCellId(cell)) {
        throw new InvalidParams('params.cell must be a cell id, e.g. c-1a2b3c4d')
      }
      const split = pane === undefined ? undefined : requirePane(pane, 'pane')
      if (split !== undefined && (full || cell !== undefined)) {
        throw new InvalidParams(
          'params.pane cannot be used when params.full is true or params.cell is given'
        )
      }
      const req: PaneNewRequest = {
        ...(split !== undefined ? { pane: split } : { pty }),
        cwd,
        direction,
        full,
        ...(command && { command }),
        ...(cell !== undefined && { cell }),
        ...(hidden && { hidden })
      }
      return askPane('pane:new', () => req)
    },
    'pane.close': async ({ target }) => {
      const pane = requirePane(target, 'target')
      await ask('pane:close', (): PaneTarget => ({ pane }))
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
      const reply = await askPane('cell:new', (): CellNewRequest => {
        const cell = cellOf(pty)
        const place = target === undefined ? undefined : placeOf(target)
        return { cwd, ...(cell && { cell }), ...(command && { command }), ...(place && { place }) }
      })
      if (!reply.cell) throw new Error('the window answered without a cell')
      return { pane: reply.pane, pty: reply.pty, cell: reply.cell }
    }
  }

  return {
    handlers,
    closePty: async (pty) => {
      try {
        await ask('pane:close', (): PaneTarget => ({ pty }))
      } catch (err) {
        // 창이 그 pty 의 pane 을 못 찾았으면 `pty.kill` 의 다른 갈래처럼 그런 pty 가 없다고 답한다.
        if (err instanceof InvalidParams) throw new InvalidParams(`no pty ${pty}`)
        throw err
      }
    },
    reply: (id, reply) => pending.get(id)?.(reply)
  }
}
