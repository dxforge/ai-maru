type View = {
  c: { key: number }
  width?: string
  panes: readonly { p: { key: number }; style: Record<string, string> }[]
}

/**
 * cell 과 pane 이 놓인 자리만 떼어 낸 문자열이다. `views` 는 자리와 상관없는 값(포커스 표시 등)이 바뀌어도 다시
 * 계산되므로, `App.vue` 는 이 값이 바뀔 때만 포커스된 pane 이 보이게 스크롤한다.
 */
export function arrangementKey(views: readonly View[]): string {
  return JSON.stringify(
    views.map((v) => [v.c.key, v.width, v.panes.map((p) => [p.p.key, p.style])])
  )
}

/**
 * 포커스된 pane 을 보이려고 `from` 에서 `to` 로 가는 스크롤을 부드럽게 움직일지. 아니면 바로 그 자리에 선다.
 * `settled` 는 앱이 뜬 뒤 되살린 cell 을 다 쟀는지다. 그 전에는 화면이 처음 그려지는 중이다.
 */
export function smoothReveal(o: {
  smooth: boolean
  settled: boolean
  reducedMotion: boolean
  from: number
  to: number
}): boolean {
  return o.smooth && o.settled && !o.reducedMotion && o.to !== o.from
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}
