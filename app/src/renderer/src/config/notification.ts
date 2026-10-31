/**
 * `seenMs` 는 들어온 pane 에 머물러야 그 전에 와 있던 알림과 done 을 지우는 시간(ms)이다. null 이면 지우지 않고, 보고 있는
 * pane 에 온 알림과 done 도 남긴다.
 */
export type NotificationConfig = { seenMs: number | null }

export const DEFAULT_NOTIFICATION: NotificationConfig = { seenMs: 500 }

// setTimeout 은 지연을 32비트 정수로 받아, 넘치는 값은 바로 실행한다. 그만큼 머무는 일은 없으니 지우지 않는 것으로 친다.
const MAX_TIMEOUT = 2 ** 31 - 1

export const NOTIFICATION_KEYS: readonly string[] = ['seen-ms']

export function parseNotification(
  notification: Record<string, unknown>,
  warnings: string[]
): NotificationConfig {
  const value = notification['seen-ms']
  const fallback = DEFAULT_NOTIFICATION.seenMs
  if (value === undefined) return DEFAULT_NOTIFICATION
  if (value === false) return { seenMs: null }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    warnings.push(`notification.seen-ms must be an integer or false, using ${fallback}.`)
    return DEFAULT_NOTIFICATION
  }
  if (value < 0) {
    warnings.push(`notification.seen-ms = ${value} is less than 0, using 0.`)
    return { seenMs: 0 }
  }
  return { seenMs: value > MAX_TIMEOUT ? null : value }
}
