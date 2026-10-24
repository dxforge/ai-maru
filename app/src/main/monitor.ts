import { InvalidParams, Subscription, type Handlers } from './cli-server'
import { isPtyId } from '../shared/pty'

type Notify = (event: object) => boolean

export type Monitor = {
  handlers: Handlers
  /** 그 pty 를 구독하는 monitor 모두에게 보낸다. 하나에라도 보냈으면 true 다. */
  emit(pty: string, event: object): boolean
}

/**
 * `monitor.subscribe` 는 구독을 넣은 뒤에 `onSubscribe` 를 부른다. 그래서 그 안에서 `emit` 한 알림이 새
 * 구독에 닿는다.
 */
export function createMonitor({
  shellPidOf,
  onSubscribe = () => {}
}: {
  shellPidOf: (pty: string) => Promise<number | null>
  onSubscribe?: (pty: string) => void
}): Monitor {
  const listeners = new Map<string, Set<Notify>>()

  const handlers: Handlers = {
    'monitor.subscribe': async (params, pty) => {
      const { ancestors } = params
      if (!Array.isArray(ancestors) || !ancestors.every((p) => Number.isInteger(p) && p > 0)) {
        throw new InvalidParams('params.ancestors must be an array of process ids')
      }
      // `/exit` 로 앱 터미널 밖에 옮겨진 claude 는 그 터미널의 알림을 받지 않는다.
      const shell = isPtyId(pty) ? await shellPidOf(pty) : null
      if (shell === null || !ancestors.includes(shell)) {
        throw new InvalidParams(`not running under pty ${pty}'s shell`)
      }
      return new Subscription('monitor.event', (notify) => {
        const subs = listeners.get(pty) ?? new Set<Notify>()
        subs.add(notify)
        listeners.set(pty, subs)
        onSubscribe(pty)
        return () => {
          subs.delete(notify)
          // 두 번 불려도 그 사이 새로 만든 집합을 지우지 않게.
          if (!subs.size && listeners.get(pty) === subs) listeners.delete(pty)
        }
      })
    }
  }

  return {
    handlers,
    emit: (pty, event) => {
      let sent = false
      for (const notify of listeners.get(pty) ?? []) sent = notify(event) || sent
      return sent
    }
  }
}
