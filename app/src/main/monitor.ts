import { InvalidParams, Subscription, type Handlers } from './cli-server'
import { isSessionId } from './session'

type Notify = (event: object) => boolean

export type Monitor = {
  handlers: Handlers
  /** 그 세션을 구독하는 monitor 모두에게 보낸다. 하나에라도 보냈으면 true 다. */
  emit(session: string, event: object): boolean
}

export function createMonitor({
  shellPidOf
}: {
  shellPidOf: (session: string) => Promise<number | null>
}): Monitor {
  const listeners = new Map<string, Set<Notify>>()

  const handlers: Handlers = {
    'monitor.subscribe': async (params, session) => {
      const { ancestors } = params
      if (!Array.isArray(ancestors) || !ancestors.every((p) => Number.isInteger(p) && p > 0)) {
        throw new InvalidParams('params.ancestors must be an array of process ids')
      }
      // `/exit` 로 앱 터미널 밖에 옮겨진 claude 는 그 터미널의 알림을 받지 않는다.
      const shell = isSessionId(session) ? await shellPidOf(session) : null
      if (shell === null || !ancestors.includes(shell)) {
        throw new InvalidParams(`not running under session ${session}'s shell`)
      }
      return new Subscription('monitor.event', (notify) => {
        const subs = listeners.get(session) ?? new Set<Notify>()
        subs.add(notify)
        listeners.set(session, subs)
        return () => {
          subs.delete(notify)
          // 두 번 불려도 그 사이 새로 만든 집합을 지우지 않게.
          if (!subs.size && listeners.get(session) === subs) listeners.delete(session)
        }
      })
    }
  }

  return {
    handlers,
    emit: (session, event) => {
      let sent = false
      for (const notify of listeners.get(session) ?? []) sent = notify(event) || sent
      return sent
    }
  }
}
