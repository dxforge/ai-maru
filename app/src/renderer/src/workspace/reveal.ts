type View = {
  c: { key: number }
  width?: string
  panes: readonly { p: { key: number }; style: Record<string, string> }[]
}

/**
 * cell 과 pane 이 놓인 자리만 떼어 낸 문자열이다. `views` 는 자리와 상관없는 값(포커스 표시 등)이 바뀌어도 다시
 * 계산되므로, `App.vue` 는 포커스와 이 값이 바뀔 때만 columns 보기의 스크롤을 `scrollPlan` 대로 다시 맞춘다.
 */
export function arrangementKey(views: readonly View[]): string {
  return views.map((v) => `${v.c.key}${shapeOf(v)}`).join()
}

export function shapeOf(v: View): string {
  return JSON.stringify([v.width, v.panes.map((p) => [p.p.key, p.style])])
}

export type Focus = { cell?: number; pane?: number; shape?: string }

/**
 * 배치나 포커스가 바뀐 뒤 columns 보기의 스크롤을 어떻게 맞출지 고른다.
 * - `hold`: 포커스된 cell 을 바뀌기 전과 같은 화면 x 에 둔다. 포커스된 cell·pane 과 그 cell 의 `shape` 가 그대로인데
 *   배치가 바뀌었으면, 다른 cell 이 생겼거나 없어졌거나 폭이 바뀐 것이다.
 * - `take`: 포커스된 cell 이 없어져 다른 cell 이 포커스를 받았다. 그 cell 을 없어진 cell 이 있던 화면 x 에 둔다.
 * - `reveal`: 포커스된 pane 이 보이게 스크롤한다.
 * `beforeGone` 은 바뀌기 전에 포커스돼 있던 cell 이 지금은 없는지다. `dragging` 은 경계를 끄는 중인지다. 경계를
 * 눌러도 포커스는 옮겨 가지 않으므로, 끄는 중에 `hold` 하면 끄는 경계가 포인터를 따라가지 않고 제자리에 남는다.
 */
export function scrollPlan(o: {
  modeChanged: boolean
  settled: boolean
  dragging: boolean
  before: Focus
  after: Focus
  beforeGone: boolean
}): 'hold' | 'take' | 'reveal' {
  const { before, after } = o
  if (o.modeChanged || !o.settled || o.dragging || after.cell === undefined) return 'reveal'
  if (before.cell === after.cell) {
    return before.pane === after.pane && before.shape === after.shape ? 'hold' : 'reveal'
  }
  return before.cell !== undefined && o.beforeGone ? 'take' : 'reveal'
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

export type Scrolling = { from: number; to: number; last: number }

/**
 * 부드러운 스크롤이 도는 중에 다른 코드가 스크롤을 `by` 만큼 옮겼을 때, 출발점·도착점을 같은 만큼 옮긴 애니메이션이다.
 * `last` 는 옮긴 뒤의 `scrollLeft` 다. 애니메이션은 `scrollLeft` 가 `last` 와 다르면 사용자가 스크롤한 것으로 보고 멈춘다.
 */
export function shiftScrolling(s: Scrolling, by: number, last: number): Scrolling {
  return { from: s.from + by, to: s.to + by, last }
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}
