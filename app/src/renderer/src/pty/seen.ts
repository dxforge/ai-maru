export type SeenDeps = {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
  /**
   * 들어온 pane 에 이만큼(ms) 머물면 그 전에 와 있던 알림과 done 을 본 것으로 친다. null 이면 보지 않는 것으로 친다. 들어올
   * 때마다 다시 읽는다.
   */
  delay(): number | null
  viewed(pty: string | null): void
  /** 사용자가 `pty` 의 pane 에 들어와 `delay()` 만큼 머물렀다. */
  seen(pty: string): void
}

/**
 * 보고 있는 pane 을 main 에 알리고, 들어온 pane 에 머문 시간을 잰다. `delay()` 보다 짧게 지나간 pane 은 pane 사이를 옮겨 다니는
 * 중일 수 있어 알리지 않는다.
 */
export function createSeenTracker(deps: SeenDeps) {
  let current: { pty: string; timer: unknown } | null = null
  return {
    /** 지금 입력 focus 를 가진 pane 의 pty. 앱 창에 focus 가 없으면 null 이다. `delay()` 가 바뀌었을 때도 다시 부른다. */
    view(focused: string | null): void {
      const delay = focused === null ? null : deps.delay()
      const pty = delay === null ? null : focused
      if ((current?.pty ?? null) === pty) return
      if (current) deps.clearTimeout(current.timer)
      deps.viewed(pty)
      current =
        pty === null || delay === null
          ? null
          : { pty, timer: deps.setTimeout(() => deps.seen(pty), delay) }
    }
  }
}
