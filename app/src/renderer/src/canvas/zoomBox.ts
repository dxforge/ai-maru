import { Check, Copy, Maximize } from '@lucide/vue'
import { h, render, type Component } from 'vue'
import { listenWindowPointer } from '../windowPointer'
import { copyPng, imagePng } from './copyImage'
import { fitScale, PINCH_SPAN, stepZoom, WHEEL_SPAN, wheelZoom, zoomLabel } from './zoom'

/** 배율. `null` 은 맞춤이다 — 그림의 크기를 CSS 에 맡겨, 카드보다 큰 그림을 카드 너비로 줄인다. */
export type Scale = number | null

export type ZoomOptions = {
  scale: Scale
  /** 맞춤이 아닌 배율에서 고정할 블록 높이. 없으면 100% 일 때 높이다. */
  height?: number
  changed?: (scale: Scale, height: number | undefined) => void
  /** 클립보드에 실을 그림의 PNG 를 만든다. 복사 버튼이 부른다. */
  png: () => Promise<Blob>
}

const COPIED_MS = 1500

/**
 * `out` 블록에 확대·축소·fit·복사 버튼과 ⌘+휠·핀치 확대·축소를 붙인다. `view` 는 `content` 를 담고 넘치면 스크롤하는
 * 요소다. `size` 는 100% 일 때 `content` 의 크기다. 배율 표시는 이 크기에 대한 비율이다. 배율 버튼은 100% 로 간다. 맞춤이
 * 아닌 배율에서는 `view` 의 높이를 고정하므로 확대·축소해도 아래 글이 밀리지 않는다. 고정하는 높이는 맞춤에서 벗어났으면
 * 벗어나기 직전 높이, fit 을 눌렀으면 맞춘 그림의 높이, 그 밖에는 `height` 다.
 */
export function attachZoom(
  out: HTMLElement,
  view: HTMLElement,
  content: HTMLElement | SVGElement,
  size: { width: number; height: number },
  { scale, height, changed, png }: ZoomOptions
): void {
  const bar = document.createElement('div')
  bar.className = 'zoom-bar'
  // Canvas 의 다른 버튼처럼 눌러도 터미널 등 포커스를 가진 요소를 blur 하지 않는다.
  bar.addEventListener('mousedown', (e) => e.preventDefault())
  const button = (
    label: string,
    click: () => void,
    face: string | Component,
    className = 'icon-button'
  ): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = className
    if (typeof face === 'string') b.textContent = face
    else render(h(face), b)
    b.setAttribute('aria-label', label)
    b.addEventListener('click', click)
    bar.append(b)
    return b
  }
  button('Zoom out', () => zoomTo(stepZoom(current(), -1)), '−')
  const reset = button('Reset zoom', () => zoomTo(1), '', 'icon-button zoom-reset')
  button('Zoom in', () => zoomTo(stepZoom(current(), 1)), '+')
  bar.append(Object.assign(document.createElement('span'), { className: 'zoom-sep' }))
  button('Fit', () => fit(), Maximize)
  const copyButton = button('Copy image', () => void copied(), Copy)
  out.append(bar)

  let shown: ReturnType<typeof setTimeout> | undefined
  const copied = async (): Promise<void> => {
    try {
      await copyPng(await png())
    } catch (e) {
      console.error('maru: cannot copy the image:', e)
      return
    }
    clearTimeout(shown)
    render(h(Check), copyButton)
    copyButton.classList.add('copied')
    shown = setTimeout(() => {
      render(h(Copy), copyButton)
      copyButton.classList.remove('copied')
    }, COPIED_MS)
  }

  const fit = (): void => {
    const scroller = scrollParent(out)
    const margin = scrollMargins(out)
    const room = scroller ? scroller.clientHeight - margin.top - margin.bottom : Infinity
    const next = fitScale(size, { width: view.clientWidth, height: room })
    scale = next
    height = size.height * next
    apply()
    view.scrollLeft = 0
    view.scrollTop = 0
    markPannable(view, content)
    if (scroller) reveal(out, scroller, margin)
  }

  const current = (): number => scale ?? content.getBoundingClientRect().width / size.width
  const apply = (): void => {
    if (scale === null) {
      height = undefined
      for (const p of ['width', 'height', 'maxWidth'] as const) content.style[p] = ''
      view.style.height = ''
    } else {
      height ??= size.height
      content.style.width = `${size.width * scale}px`
      content.style.height = `${size.height * scale}px`
      content.style.maxWidth = 'none'
      view.style.height = `${height}px`
    }
    reset.textContent = zoomLabel(current())
    changed?.(scale, height)
  }
  // `at` 에 있던 그림의 점을 그 자리에 둔다. 버튼은 블록에 보이는 영역의 가운데를 쓴다.
  const zoomTo = (next: Scale, at?: { x: number; y: number }): void => {
    const before = content.getBoundingClientRect()
    const box = view.getBoundingClientRect()
    const x = at?.x ?? box.left + box.width / 2
    const y = at?.y ?? box.top + box.height / 2
    const from = current()
    // 범위 끝에 막혀 배율이 그대로면 맞춤을 떠나지 않는다.
    if (scale === null && next === from) return
    if (scale === null && next !== null) height = view.clientHeight
    scale = next
    apply()
    const by = anchorScroll(before, content.getBoundingClientRect(), { x, y }, current() / from)
    view.scrollLeft += by.x
    view.scrollTop += by.y
    markPannable(view, content)
  }
  // 카드 너비가 바뀌면 맞춤의 배율도 바뀌므로, 포인터가 블록에 들어올 때 배율 표시를 다시 쓴다.
  out.addEventListener('pointerenter', () => {
    if (scale === null) reset.textContent = zoomLabel(current())
  })
  out.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // 핀치는 `ctrlKey` 만 켜진 wheel 로 온다.
      const span = e.metaKey ? WHEEL_SPAN : PINCH_SPAN
      zoomTo(wheelZoom(current(), e.deltaY, span), { x: e.clientX, y: e.clientY })
    },
    { passive: false }
  )
  dragToScroll(view, content)
  apply()
}

/**
 * 로드가 끝난 이미지 문서의 `img` 에 확대·축소를 붙인다. 카드 너비에 맞춘 크기에서 시작한다. `img` 는 `.zoom-view` 안에,
 * `.zoom-view` 는 블록 안에 있다.
 */
export function zoomImage(img: HTMLImageElement): void {
  const view = img.parentElement!
  if (!img.naturalWidth || !img.naturalHeight) return
  const size = { width: img.naturalWidth, height: img.naturalHeight }
  attachZoom(view.parentElement!, view, img, size, {
    scale: null,
    png: () => imagePng(img)
  })
}

/**
 * 그림이 블록보다 클 때 끌어서 블록 안을 스크롤한다. 끄는 동안 글자를 선택하거나 포커스를 옮기지 않는다. 끌 수 있는
 * 동안은 `pannable` 을 붙여 포인터 모양으로 알린다. 넘치는지는 포인터가 들어올 때와 배율을 바꾼 뒤(`markPannable`)에 잰다.
 */
function dragToScroll(view: HTMLElement, content: HTMLElement | SVGElement): void {
  view.addEventListener('pointerenter', () => markPannable(view, content))
  view.addEventListener('pointerdown', (e) => {
    // 고전 스크롤바 설정에서 블록에 씌운 스크롤바(`.os-scrollbar`)를 누르면 그림을 끌지 않고 스크롤바가 받게 둔다.
    if (
      e.button !== 0 ||
      (e.target as Element).closest('.os-scrollbar') ||
      !markPannable(view, content)
    )
      return
    e.preventDefault()
    view.setPointerCapture(e.pointerId)
    view.classList.add('dragging')
    let { clientX: x, clientY: y } = e
    const off = listenWindowPointer(
      (m) => {
        view.scrollLeft -= m.clientX - x
        view.scrollTop -= m.clientY - y
        x = m.clientX
        y = m.clientY
      },
      () => {
        view.classList.remove('dragging')
        off()
      }
    )
  })
  // 끄는 동안 브라우저가 `img` 의 기본 drag and drop 을 시작하지 않게 한다.
  view.addEventListener('dragstart', (e) => {
    if (view.classList.contains('dragging')) e.preventDefault()
  })
}

/**
 * 배율을 `ratio` 배 바꿔 그림의 화면 위치가 `before` 에서 `after` 로 옮겨졌을 때, 화면 좌표 `at` 에 있던 그림의 점을
 * 다시 그 자리에 두려면 스크롤을 얼마나 옮겨야 하는지.
 */
export function anchorScroll(
  before: { left: number; top: number },
  after: { left: number; top: number },
  at: { x: number; y: number },
  ratio: number
): { x: number; y: number } {
  return {
    x: after.left + (at.x - before.left) * ratio - at.x,
    y: after.top + (at.y - before.top) * ratio - at.y
  }
}

// 그림이 `view` 보다 크면 넘친다고 본다. `view.scrollWidth` 는 쓰지 않는다. 블록에 씌운 OverlayScrollbars 스크롤바 요소까지
// 세는데, 배율을 바꾼 직후에는 그 요소가 앞 스크롤 위치에 남아 `scrollWidth` 를 늘리기 때문이다. 1px 여유는 `clientWidth` 가
// 소수점을 버려, 맞춘 그림이 `clientWidth` 보다 넓게 재어지는 만큼이다.
function markPannable(view: HTMLElement, content: HTMLElement | SVGElement): boolean {
  const { width, height } = content.getBoundingClientRect()
  const overflows = width > view.clientWidth + 1 || height > view.clientHeight + 1
  view.classList.toggle('pannable', overflows)
  return overflows
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}

function scrollMargins(el: HTMLElement): { top: number; bottom: number } {
  const { scrollMarginTop, scrollMarginBottom } = getComputedStyle(el)
  return { top: parseFloat(scrollMarginTop) || 0, bottom: parseFloat(scrollMarginBottom) || 0 }
}

// `scrollIntoView` 는 쓰지 않는다. overflow 가 hidden 인 조상까지 스크롤할 수 있어 보이기 때문이다(확인하지 않았다).
function reveal(
  out: HTMLElement,
  scroller: HTMLElement,
  margin: { top: number; bottom: number }
): void {
  const box = out.getBoundingClientRect()
  const area = scroller.getBoundingClientRect()
  const above = box.top - margin.top - area.top
  const below = box.bottom + margin.bottom - area.bottom
  if (above < 0) scroller.scrollTop += above
  else if (below > 0) scroller.scrollTop += Math.min(below, above)
}
