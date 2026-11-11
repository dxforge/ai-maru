import type { PtyNotification } from '../shared/pty-state'
import { InvalidParams, optionalString, type Handlers } from './cli-server'

/** idle 인 것은 상태 레코드의 아이콘이 이미 보이므로, 이 종류의 알림은 보이지 않는다. */
const IDLE = 'idle_prompt'

/** maru-pty 가 OSC 알림의 텍스트를 다듬는 규칙(`line_text`)과 같게 한 줄로 다듬는다. */
export function lineText(text: string): string {
  return (
    text
      .replace(/[\n\t]/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
      .trim()
  )
}

export type ClaudeNotificationDeps = {
  /** pty 의 foreground 프로세스 그룹 리더 pid */
  leader(pty: string): Promise<number>
  notify(pty: string, notification: PtyNotification): void
}

/**
 * 앱 plugin 의 Notification hook 이 보낸 claude 알림을 받고, 그 claude 가 같은 알림을 OSC 9/777 로도 쓴 것을 버린다.
 *
 * hook 을 받을 때 그 pty 의 foreground 리더를 기억하고, 리더가 같은 동안 온 OSC 알림을 버린다. shim 이 claude 를 exec 하므로
 * claude 가 도는 동안 리더는 claude 이고, claude 가 끝나면 리더가 바뀌어 그 pty 의 OSC 알림을 다시 보인다. plugin 없이 뜬
 * claude 는 hook 을 보내지 않으므로 OSC 알림이 그대로 보인다.
 */
export function createClaudeNotifications(deps: ClaudeNotificationDeps) {
  const leaders = new Map<string, number>()
  const pending = new Map<string, Promise<void>>()

  async function leaderOf(pty: string): Promise<number | null> {
    try {
      return await deps.leader(pty)
    } catch {
      return null
    }
  }

  async function decide(
    pty: string,
    notification: PtyNotification,
    show: (n: PtyNotification) => void
  ): Promise<void> {
    const remembered = leaders.get(pty)
    if (remembered === undefined) return show(notification)
    const leader = await leaderOf(pty)
    if (leader === remembered) return
    // 재지 못한 것은 claude 가 끝났다는 뜻이 아니므로 기억은 둔다. 알림은 잃지 않게 보인다.
    if (leader !== null && leaders.get(pty) === remembered) leaders.delete(pty)
    show(notification)
  }

  const handlers: Handlers = {
    // claude 는 hook 이 끝난 뒤 OSC 를 쓰고 CLI 는 이 답을 기다리므로, 리더를 기억한 뒤 답해야 첫 알림의 OSC 도 버린다.
    'claude.notification': async (params, pty) => {
      const message = optionalString(params.message, 'message')
      if (message === undefined) throw new InvalidParams('params.message must be a string')
      const type = optionalString(params.type, 'type')
      const title = optionalString(params.title, 'title')
      const n = { title: lineText(title ?? ''), body: lineText(message) }
      if (type !== IDLE && (n.title || n.body)) deps.notify(pty, n)
      const leader = await leaderOf(pty)
      if (leader !== null) leaders.set(pty, leader)
      return null
    }
  }

  return {
    handlers,
    terminal(
      pty: string,
      notification: PtyNotification,
      show: (n: PtyNotification) => void
    ): Promise<void> {
      const before = pending.get(pty)
      if (!before && !leaders.has(pty)) {
        show(notification)
        return Promise.resolve()
      }
      // 리더를 재는 동안 온 알림이 앞지르지 않게, 그 pty 의 알림은 온 순서대로 보인다.
      const run = (before ?? Promise.resolve()).then(() => decide(pty, notification, show))
      pending.set(pty, run)
      void run.finally(() => {
        if (pending.get(pty) === run) pending.delete(pty)
      })
      return run
    },
    forget(pty: string): void {
      leaders.delete(pty)
    }
  }
}
