import { isBodyless, type PtyNotification } from '../shared/pty-state'

/** 데스크톱 알림은 이 간격에 하나만 띄운다. ghostty 의 값이다. */
export const NOTIFICATION_INTERVAL_MS = 1_000
/** 마지막으로 띄운 알림과 pty·제목·본문이 같으면 이 간격 안에는 띄우지 않는다. ghostty 의 값이다. */
export const SAME_NOTIFICATION_INTERVAL_MS = 5_000

export type DesktopNotice = { title: string; subtitle: string; body: string }

export type DesktopNotificationDeps = {
  now(): number
  /** 앱의 창 가운데 하나라도 포커스되어 있다. */
  focused(): boolean
  /** 그 pty 의 pane 헤더 이름(job 이면 job 이름). 모르면 undefined 다. */
  label(pty: string): string | undefined
  /** 그 pty 의 상태 레코드(`shownRecord`)의 메시지, 없으면 상태 이름. 레코드가 없으면 undefined 다. */
  status(pty: string): string | undefined
  /** `pty` 의 알림을 띄운다. 사용자가 그 알림을 누르면 `clicked` 를 부른다. */
  show(pty: string, notice: DesktopNotice, clicked: () => void): void
  /** 사용자가 그 pty 의 알림을 눌렀다. */
  open(pty: string): void
}

/**
 * 앱 창이 포커스되어 있지 않을 때 프로그램의 알림을 데스크톱 알림으로 띄운다. 창을 보고 있으면 사이드바와 pane 헤더에 보이므로
 * 띄우지 않는다. ghostty 의 방식대로 제목이 없으면 pane 이름을 제목으로 쓰고, 부제에는 늘 pane 이름을 쓴다. 빈도는
 * ghostty 의 방식대로 앱 전체에서 1초에 하나, 마지막으로 띄운 것과 같은 알림은 5초에 하나로 제한한다. 제한에 걸린 알림은
 * 버린다. 같은 알림인지는 pty·제목·본문으로 가린다. 제목이 없으면 pane 이름을 제목으로 쓰므로, 이름이 같은 다른 pane 의
 * 알림을 버리지 않으려고 pty 도 비교한다.
 */
export function createDesktopNotifications(deps: DesktopNotificationDeps) {
  let last: { at: number; pty: string; title: string; body: string } | null = null
  return (pty: string, n: PtyNotification): void => {
    if (deps.focused()) return
    const now = deps.now()
    const label = deps.label(pty) ?? ''
    const title = n.title || label
    const body = isBodyless(n) ? (deps.status(pty) ?? '') : n.body
    if (last) {
      const since = now - last.at
      if (since < NOTIFICATION_INTERVAL_MS) return
      const same = last.pty === pty && last.title === title && last.body === body
      if (same && since < SAME_NOTIFICATION_INTERVAL_MS) return
    }
    last = { at: now, pty, title, body }
    deps.show(pty, { title, subtitle: label, body }, () => deps.open(pty))
  }
}
