/**
 * 사이드바의 끌어 놓기. 끌어 옮기는 대상(`Dragged`)과 놓을 곳(`Drop`)을 따로 둔다. `dropAt` 은 사이드바가 잰 세로
 * 범위(`SidebarSpans`)와 포인터의 y 로 놓을 곳을 고른다. `dropAt`·`scrollStep` 은 DOM 을 읽지 않으므로 unit 테스트로 잰다.
 */

/** 끄는 것. `index` 는 끌기 전 목록에서의 자리다(cell 은 그 workspace 안, workspace 는 목록 안). */
export type Dragged =
  | { kind: 'cell'; cell: number; workspace: number; index: number }
  | { kind: 'workspace'; workspace: number; index: number }

/** 놓을 곳. `index` 는 옮기기 전 목록의 틈이다 — 그 번째 것의 앞, 길이와 같으면 끝. */
export type Drop =
  | { kind: 'cell'; workspace: number; index: number }
  | { kind: 'new-workspace' }
  | { kind: 'workspace'; index: number }

export type Span = { top: number; bottom: number }

export type WorkspaceSpan = Span & {
  key: number
  head: Span
  /** 접힌 workspace 는 `cells` 가 비어 있어 cell 수를 따로 싣는다. */
  count: number
  cells: Span[]
}

export type SidebarSpans = { workspaces: WorkspaceSpan[]; newWorkspace?: Span }

/** 놓을 곳과 그 자리를 보일 선의 y. 새 workspace 칸에는 선 대신 그 칸을 밝히므로 `line` 이 없다. */
export type DropAt = { drop: Drop; line?: number }

const mid = (s: Span): number => (s.top + s.bottom) / 2

// `HALF_GAP` 은 사이드바의 cell 사이 틈(6px)의 반이다.
const HALF_GAP = 3
function gapLine(spans: Span[], index: number, before: number): number {
  if (index === 0) return before
  if (index === spans.length) return spans[index - 1].bottom + HALF_GAP
  return (spans[index - 1].bottom + spans[index].top) / 2
}

const before = (spans: Span[], y: number): number => spans.filter((s) => mid(s) < y).length

function cellDrop(
  d: Extract<Dragged, { kind: 'cell' }>,
  s: SidebarSpans,
  y: number
): DropAt | undefined {
  if (s.newWorkspace && y >= s.newWorkspace.top) return { drop: { kind: 'new-workspace' } }
  const ws = s.workspaces
  const i = ws.findIndex((w, j) => j === ws.length - 1 || y < (w.bottom + ws[j + 1].top) / 2)
  const w = ws[i]
  if (!w) return undefined
  const folded = w.cells.length === 0
  const index = folded ? w.count : y < w.head.bottom ? 0 : before(w.cells, y)
  if (w.key === d.workspace && (index === d.index || index === d.index + 1)) return undefined
  const line = folded ? w.head.bottom + HALF_GAP : gapLine(w.cells, index, w.head.bottom - HALF_GAP)
  return { drop: { kind: 'cell', workspace: w.key, index }, line }
}

function workspaceDrop(
  d: Extract<Dragged, { kind: 'workspace' }>,
  s: SidebarSpans,
  y: number
): DropAt | undefined {
  const index = before(s.workspaces, y)
  if (index === d.index || index === d.index + 1) return undefined
  return {
    drop: { kind: 'workspace', index },
    line: gapLine(s.workspaces, index, (s.workspaces[0]?.top ?? 0) - HALF_GAP)
  }
}

/** 놓아도 순서가 그대로인 곳이면 `dropAt` 은 아무것도 주지 않는다. */
export function dropAt(d: Dragged, s: SidebarSpans, y: number): DropAt | undefined {
  return d.kind === 'cell' ? cellDrop(d, s, y) : workspaceDrop(d, s, y)
}

/**
 * 목록의 위·아래 끝에서 이만큼 안쪽에 포인터가 들어오면 목록을 스크롤한다. 값은 사이드바 행 높이(`WorkspaceSidebar.vue` 의
 * `button` `height: 26px`)다.
 */
export const SCROLL_EDGE = 26
/** 한 프레임에 스크롤하는 가장 큰 폭이다. 행 높이의 반이다. */
export const SCROLL_MAX = 13

/** 한 프레임에 목록을 스크롤할 폭이다. 위로는 음수다. 끝에 가까울수록 크고, 끝을 넘으면 가장 크다. */
export function scrollStep(list: Span, y: number): number {
  const speed = (d: number): number =>
    Math.ceil((SCROLL_MAX * (SCROLL_EDGE - Math.max(0, d))) / SCROLL_EDGE)
  if (y < list.top + SCROLL_EDGE) return -speed(y - list.top)
  if (y > list.bottom - SCROLL_EDGE) return speed(list.bottom - y)
  return 0
}

/** `trackPointer` 가 끌기를 시작한 뒤 포인터 이벤트를 넘기는 곳이다. `frame` 은 끄는 동안 animation frame 마다 불린다. */
export type DragSession = {
  move(e: PointerEvent): void
  frame(): void
  drop(): void
  cancel(): void
}

/** 끌기가 끝날 때의 마우스 버튼 상태다. 떼었으면 `released`, Esc 로 끝나 아직 누르고 있으면 `held`, pointercancel 이면 `gone` 이다. */
type Ended = 'released' | 'held' | 'gone'

// 끌기를 끝낸 뒤 오는 click 을 누른 요소에 보내지 않는다. 끌기를 끝내려고 뗀 버튼이 이름 줄의 접기·펴기 같은 click 동작을
// 일으키지 않게 하기 위해서다. 떼었으면 click 이 그 pointerup 다음에 같은 task 에서 오므로 다음 task 에 풀고, 아직 누르고
// 있으면 뗄 때 오므로 그 pointerup 뒤에 푼다. pointercancel 로 끝났으면(`gone`) click 이 오지 않는다.
function swallowClick(ended: Ended): void {
  if (ended === 'gone') return
  const swallow = (c: MouseEvent): void => {
    c.stopPropagation()
    c.preventDefault()
  }
  const release = (): void =>
    void setTimeout(() => window.removeEventListener('click', swallow, true))
  window.addEventListener('click', swallow, true)
  if (ended === 'released') release()
  else window.addEventListener('pointerup', release, { once: true })
}

/**
 * pointerdown 부터 포인터를 따라간다. 누른 자리에서 `threshold` px 움직이면 `start` 를 불러 끌기를 시작한다(0 이면
 * 누르자마자). 떼면 `drop`, Esc·pointercancel 이면 `cancel` 이다. 끄는 동안의 Esc 는 터미널에 보내지 않는다. 누른 요소가
 * pointer capture 를 잡는다. 사이드바의 빈 곳은 창 드래그 영역(`-webkit-app-region: drag`)이므로, 포인터가 그 위를 지나도
 * 이 요소가 이벤트를 받게 하기 위해서다.
 */
export function trackPointer(e: PointerEvent, threshold: number, start: () => DragSession): void {
  if (e.button !== 0) return
  const el = e.currentTarget as Element | null
  el?.setPointerCapture?.(e.pointerId)
  let session: DragSession | undefined
  let raf = 0
  const tick = (): void => {
    session?.frame()
    raf = requestAnimationFrame(tick)
  }
  const begin = (m: PointerEvent): void => {
    session = start()
    raf = requestAnimationFrame(tick)
    session.move(m)
  }
  const move = (m: PointerEvent): void => {
    if (session) return session.move(m)
    if (Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) >= threshold) begin(m)
  }
  const stop = (how: 'drop' | 'cancel', ended: Ended): void => {
    const s = session
    end()
    if (!s) return
    swallowClick(ended)
    s[how]()
  }
  const up = (): void => stop('drop', 'released')
  const cancel = (): void => stop('cancel', 'gone')
  const key = (k: KeyboardEvent): void => {
    if (k.key !== 'Escape' || !session) return
    k.preventDefault()
    k.stopPropagation()
    stop('cancel', 'held')
  }
  const end = (): void => {
    cancelAnimationFrame(raf)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    session = undefined
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key, true)
  if (threshold === 0) begin(e)
}
