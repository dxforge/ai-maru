/**
 * 이만큼 머물러야 본 것으로 친다. 이보다 짧게 지나간 pane 은 pane 사이를 옮겨 다니는 중일 수 있다.
 */
export const SEEN_MS = 1000

export type SeenDeps = {
  now(): number
  /** 사용자가 `pty` 의 pane 을 `SEEN_MS` 이상 보고 떠났다. */
  seen(pty: string): void
}

/**
 * 입력 focus 를 가진 pane 에 머문 시간을 잰다. 시간은 focus 가 들어온 때부터 재고, 떠나는 순간 한 번 판정한다 — 타이머는 두지
 * 않는다. 그 pane 에 done 이 언제 왔는지는 보지 않는다.
 */
export function createSeenTracker(deps: SeenDeps) {
  let current: { pty: string; since: number } | null = null
  return {
    /** 지금 입력 focus 를 가진 pane 의 pty. 없으면 null 이다. */
    view(pty: string | null): void {
      if (current?.pty === pty) return
      const now = deps.now()
      if (current && now - current.since >= SEEN_MS) deps.seen(current.pty)
      current = pty === null ? null : { pty, since: now }
    }
  }
}
