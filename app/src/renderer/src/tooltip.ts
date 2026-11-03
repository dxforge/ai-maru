import type { Directive } from 'vue'

export const SHOW_DELAY = 350
/** 떠 있던 tooltip 이 닫힌 뒤 이 시간(ms) 안에 다른 요소에 들어가면 기다리지 않고 띄운다. */
export const WARM_WINDOW = 300
export const GAP = 6
/** tooltip 이 창 가장자리에서 떨어지는 최소 거리(px). */
export const EDGE = 4

export const TOOLTIP_ID = 'app-tooltip'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Anchor {
  rect: Rect
  align: 'start' | 'center'
}

/**
 * `anchor` 아래에 tooltip 을 둘 자리를 고른다. 아래에 들어갈 자리가 없으면 위로 뒤집고, 둘 다 없으면 자리가 넓은 쪽에 두고
 * 창 안으로 민다. 가로는 창 밖으로 나가지 않게 안으로 민다.
 */
export function placeTooltip(
  { rect, align }: Anchor,
  tip: { width: number; height: number },
  view: { width: number; height: number }
): { left: number; top: number; side: 'top' | 'bottom' } {
  const above = rect.top - GAP - tip.height
  const below = rect.top + rect.height + GAP
  const roomAbove = rect.top - GAP - EDGE
  const roomBelow = view.height - EDGE - below
  const side =
    below + tip.height <= view.height - EDGE || (above < EDGE && roomBelow >= roomAbove)
      ? 'bottom'
      : 'top'
  const top = clamp(side === 'top' ? above : below, EDGE, view.height - EDGE - tip.height)
  const left = clamp(
    align === 'start' ? rect.left : rect.left + rect.width / 2 - tip.width / 2,
    EDGE,
    view.width - EDGE - tip.width
  )
  return { left, top, side }
}

// 창보다 큰 tooltip 은 왼쪽·위 가장자리에 붙인다.
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, max))

let box: HTMLDivElement | undefined
/** tooltip 을 띄웠거나 띄우려고 기다리는 요소. */
let current: HTMLElement | undefined
let shown = false
let pointerX = 0
/** 띄울 때 잰 tooltip 상자의 크기. 커서를 따라 옮길 때는 내용이 그대로라 다시 재지 않는다. */
let size = { width: 0, height: 0 }
let showTimer: ReturnType<typeof setTimeout> | undefined
let warmUntil = 0
/** 마우스가 올라가 있는 요소. 바깥 요소가 앞이다. */
const hovered: HTMLElement[] = []
/** 키보드로 포커스한 요소. */
let focused: HTMLElement | undefined
/**
 * tooltip 을 닫을 때(키·누르기·창이 포커스를 잃음·요소를 담은 영역의 스크롤) 마우스가 올라가 있거나 포커스가 있던 요소. 마우스가 새 요소에 들어갈 때까지 띄우지 않는다.
 * 포커스가 옮겨 가면 새로 포커스한 요소만 띄운다.
 */
const muted = new Set<HTMLElement>()

const textOf = (el: HTMLElement): string => el.dataset.tooltip ?? ''
const keysOf = (el: HTMLElement): string => el.dataset.tooltipKeys ?? ''

function ensureBox(): HTMLDivElement {
  if (box?.isConnected) return box
  box = document.createElement('div')
  box.id = TOOLTIP_ID
  box.className = 'tooltip'
  box.setAttribute('role', 'tooltip')
  // popover 로 띄워 top layer 에 그린다. 페이지의 z-index·`overflow` 와 열린 dialog 에 가리지 않는다.
  // `manual` 이라 브라우저가 Esc·바깥 클릭으로 따로 닫지 않고, 닫는 것은 이 모듈이 정한다.
  box.setAttribute('popover', 'manual')
  document.body.append(box)
  return box
}

function describe(el: HTMLElement, on: boolean): void {
  const rest = (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((id) => id && id !== TOOLTIP_ID)
  const next = on ? [...rest, TOOLTIP_ID] : rest
  if (next.length) el.setAttribute('aria-describedby', next.join(' '))
  else el.removeAttribute('aria-describedby')
}

// 세로는 요소에 붙인다. 마우스로 띄우면 가로는 커서에 맞춘다. 사이드바 줄처럼 넓은 요소에서도 커서 가까이 뜨기 때문이다.
function anchorOf(el: HTMLElement): Anchor {
  const rect = el.getBoundingClientRect()
  if (!hovered.includes(el)) return { rect, align: 'center' }
  return { rect: { left: pointerX, top: rect.top, width: 0, height: rect.height }, align: 'start' }
}

function place(b: HTMLDivElement, at: Anchor): void {
  const { left, top } = placeTooltip(at, size, {
    width: window.innerWidth,
    height: window.innerHeight
  })
  b.style.left = `${left}px`
  b.style.top = `${top}px`
}

function show(el: HTMLElement): void {
  // DOM 을 바꾸기 전에 요소를 재, layout 을 한 번만 다시 계산하게 한다.
  const at = anchorOf(el)
  const b = ensureBox()
  const keys = keysOf(el)
  b.replaceChildren(textOf(el))
  if (keys) b.append(Object.assign(document.createElement('kbd'), { textContent: keys }))
  if (!shown) b.showPopover()
  shown = true
  describe(el, true)
  // 창 오른쪽 끝에 있던 상자는 남은 폭만큼 좁아져 있으므로, 왼쪽 위로 옮겨 제 크기로 잰다.
  b.style.left = '0px'
  b.style.top = '0px'
  const { width, height } = b.getBoundingClientRect()
  size = { width, height }
  place(b, at)
}

function hide(warmUp = true): void {
  clearTimeout(showTimer)
  if (shown && current && box) {
    describe(current, false)
    if (warmUp) warmUntil = Date.now() + WARM_WINDOW
    box.hidePopover()
    box.textContent = ''
  }
  shown = false
  current = undefined
}

function wanted(): HTMLElement | undefined {
  const live = (el: HTMLElement): boolean => !!textOf(el) && !muted.has(el)
  for (let i = hovered.length - 1; i >= 0; i--) if (live(hovered[i])) return hovered[i]
  return focused && live(focused) ? focused : undefined
}

function refresh(): void {
  const el = wanted()
  if (el && el === current) return
  const wasShown = shown
  hide()
  if (!el) return
  current = el
  if (wasShown || Date.now() < warmUntil) show(el)
  else showTimer = setTimeout(() => show(el), SHOW_DELAY)
}

function dismiss(): void {
  if (!current) return
  for (const el of hovered) muted.add(el)
  if (focused) muted.add(focused)
  hide(false)
}

function onMove(e: MouseEvent): void {
  pointerX = e.clientX
  if (shown && box && current && hovered.includes(current)) place(box, anchorOf(current))
}

function onEnter(e: Event): void {
  const el = e.currentTarget as HTMLElement
  onMove(e as MouseEvent)
  if (!hovered.includes(el)) hovered.push(el)
  muted.clear()
  refresh()
}

function unhover(el: HTMLElement): void {
  const i = hovered.indexOf(el)
  if (i >= 0) hovered.splice(i, 1)
}

function onLeave(e: Event): void {
  unhover(e.currentTarget as HTMLElement)
  refresh()
}

// 마우스로 누른 요소도 포커스를 받으므로, 키보드로 옮긴 포커스(`:focus-visible`)에만 띄운다.
function onFocus(e: Event): void {
  const el = e.currentTarget as HTMLElement
  if (!el.matches(':focus-visible')) return
  focused = el
  muted.delete(el)
  refresh()
}

function onBlur(e: Event): void {
  if (focused !== e.currentTarget) return
  focused = undefined
  refresh()
}

// 브라우저 기본 tooltip 처럼 어느 키를 눌러도 닫는다. 키는 막지 않아 터미널로 그대로 간다.
function onKey(): void {
  dismiss()
}
// `App.vue` 가 chord 키(⌘J 뒤의 키)를 window 의 capture 단계에서 멈추므로, 그보다 먼저 달려고 `install` 을 기다리지 않고
// 모듈을 읽을 때 window 에 단다.
window.addEventListener('keydown', onKey, true)

// 요소를 담은 영역이 스크롤되면 tooltip 이 요소에서 떨어지므로 닫는다. 터미널처럼 상관없는 영역의 스크롤은 무시한다.
function onScroll(e: Event): void {
  if (current && e.target instanceof Node && e.target.contains(current)) dismiss()
}

let installed = false

function install(): void {
  if (installed) return
  installed = true
  document.addEventListener('scroll', onScroll, true)
  document.addEventListener('mousemove', onMove, { capture: true, passive: true })
  window.addEventListener('blur', dismiss)
}

function forget(el: HTMLElement): void {
  unhover(el)
  muted.delete(el)
  if (focused === el) focused = undefined
  if (el === current) refresh()
}

const EVENTS: [string, (e: Event) => void][] = [
  ['mouseenter', onEnter],
  ['mouseleave', onLeave],
  ['focus', onFocus],
  ['blur', onBlur],
  ['pointerdown', dismiss]
]

/** tooltip 의 값. 단축키가 있으면 `keys` 에 메뉴에 보이는 글자(`⌥⌘B`)로 넘긴다. `vTooltip` 은 단축키를 문장 오른쪽에 흐리게 그린다. */
export type TooltipValue = string | { text: string; keys?: string } | false | null | undefined

function store(el: HTMLElement, value: TooltipValue): boolean {
  const { text, keys = '' } = typeof value === 'object' && value ? value : { text: value || '' }
  if (el.dataset.tooltip === text && keysOf(el) === keys) return false
  el.dataset.tooltip = text
  if (keys) el.dataset.tooltipKeys = keys
  else delete el.dataset.tooltipKeys
  return true
}

/**
 * 요소에 마우스를 올리거나 키보드로 포커스하면 값을 tooltip 으로 띄운다. 값이 비었으면 띄우지 않는다.
 * tooltip 상자는 화면에 하나를 두고 모든 요소가 같이 쓴다. 값은 요소의 `data-tooltip`(단축키는 `data-tooltip-keys`)에도 둔다.
 */
export const vTooltip: Directive<HTMLElement, TooltipValue> = {
  mounted(el, { value }) {
    install()
    store(el, value)
    for (const [type, fn] of EVENTS) el.addEventListener(type, fn)
  },
  updated(el, { value }) {
    if (!store(el, value)) return
    // 떠 있는 요소의 값이 바뀌기만 했으면 띄울 요소는 그대로라, 내용과 자리만 바꾼다.
    if (el === current && shown && textOf(el)) show(el)
    else if (hovered.includes(el) || el === focused) refresh()
  },
  beforeUnmount(el) {
    for (const [type, fn] of EVENTS) el.removeEventListener(type, fn)
    forget(el)
  }
}
