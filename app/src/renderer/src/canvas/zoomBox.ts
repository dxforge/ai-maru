import { listenWindowPointer } from '../windowPointer'
import { PINCH_SPAN, stepZoom, WHEEL_SPAN, wheelZoom, zoomLabel } from './zoom'

/** 배율. `null` 은 맞춤이다 — 그림의 크기를 CSS 에 맡겨, 카드보다 큰 그림을 카드 너비로 줄인다. */
export type Scale = number | null

export type ZoomOptions = {
  /** 처음 배율. */
  scale: Scale
  /** 배율 버튼이 되돌리는 배율. */
  home: Scale
  /** 배율을 바꿀 때마다 새 배율로 부른다. */
  changed?: (scale: Scale) => void
}

/**
 * `out` 블록에 확대·축소 버튼과 ⌘+휠·핀치 확대·축소를 붙인다. `view` 는 `content` 를 담고 넘치면 스크롤하는 요소다.
 * `size` 는 100% 일 때 `content` 의 크기고, 배율 표시는 이 크기에 대한 비율이다. 맞춤이 아닌 배율에서는 `view` 의 높이를
 * 고정하므로 확대·축소해도 아래 글이 밀리지 않는다. 고정하는 높이는 `home` 이 맞춤이면 맞춤에서 벗어나기 직전 높이,
 * 아니면 100% 일 때 높이다.
 */
export function attachZoom(
  out: HTMLElement,
  view: HTMLElement,
  content: HTMLElement | SVGElement,
  size: { width: number; height: number },
  { scale, home, changed }: ZoomOptions
): void {
  const bar = document.createElement('div')
  bar.className = 'zoom-bar'
  // Canvas 의 다른 버튼처럼 눌러도 터미널 등 포커스를 가진 요소를 blur 하지 않는다.
  bar.addEventListener('mousedown', (e) => e.preventDefault())
  const button = (
    text: string,
    label: string,
    next: () => Scale,
    className = 'icon-button'
  ): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = className
    b.textContent = text
    b.setAttribute('aria-label', label)
    b.addEventListener('click', () => zoomTo(next()))
    bar.append(b)
    return b
  }
  button('−', 'Zoom out', () => stepZoom(current(), -1))
  const reset = button('', 'Reset zoom', () => home, 'icon-button zoom-reset')
  button('+', 'Zoom in', () => stepZoom(current(), 1))
  out.append(bar)

  // 맞춤에서는 그려진 너비로 배율을 잰다. 카드 너비가 바뀌면 배율도 바뀌므로 표시는 포인터가 들어올 때 다시 쓴다.
  const current = (): number => scale ?? content.getBoundingClientRect().width / size.width
  let height: number | undefined
  const apply = (): void => {
    if (scale === null) {
      height = undefined
      for (const p of ['width', 'height', 'maxWidth'] as const) content.style[p] = ''
      view.style.height = ''
    } else {
      height ??= home === null ? view.clientHeight : size.height
      content.style.width = `${size.width * scale}px`
      content.style.height = `${size.height * scale}px`
      content.style.maxWidth = 'none'
      view.style.height = `${height}px`
    }
    reset.textContent = zoomLabel(current())
    changed?.(scale)
  }
  // `at` 에 있던 그림의 점을 그 자리에 둔다. 버튼은 블록에 보이는 영역의 가운데를 쓴다.
  const zoomTo = (next: Scale, at?: { x: number; y: number }): void => {
    const before = content.getBoundingClientRect()
    const box = view.getBoundingClientRect()
    const x = at?.x ?? box.left + box.width / 2
    const y = at?.y ?? box.top + box.height / 2
    const from = current()
    scale = next
    apply()
    const by = anchorScroll(before, content.getBoundingClientRect(), { x, y }, current() / from)
    view.scrollLeft += by.x
    view.scrollTop += by.y
    markPannable(view)
  }
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
  dragToScroll(view)
  apply()
}

/**
 * 다 읽은 이미지 문서의 `img` 에 확대·축소를 붙인다. 카드 너비에 맞춘 크기에서 시작하고, 배율 버튼도 그 크기로 되돌린다.
 * `img` 는 `.zoom-view` 안에, `.zoom-view` 는 블록 안에 있다. 배율 표시의 기준은 `naturalWidth` 다. 크기를 적지 않은
 * SVG 는 Chromium 이 정한 기본 크기(viewBox 만 있으면 너비 300)가 기준이 된다. 크기가 0 인 그림에는 붙이지 않는다.
 */
export function zoomImage(img: HTMLImageElement): void {
  const view = img.parentElement!
  if (!img.naturalWidth || !img.naturalHeight) return
  const size = { width: img.naturalWidth, height: img.naturalHeight }
  attachZoom(view.parentElement!, view, img, size, { scale: null, home: null })
}

/**
 * 그림이 블록보다 클 때 끌어서 블록 안을 스크롤한다. 끄는 동안 글자를 선택하거나 포커스를 옮기지 않는다. 끌 수 있는
 * 동안은 `pannable` 을 붙여 포인터 모양으로 알린다. 넘치는지는 포인터가 들어올 때와 배율을 바꾼 뒤(`markPannable`)에 잰다.
 */
function dragToScroll(view: HTMLElement): void {
  view.addEventListener('pointerenter', () => markPannable(view))
  view.addEventListener('pointerdown', (e) => {
    // 고전 스크롤바 설정에서 블록에 씌운 스크롤바(`.os-scrollbar`)를 누르면 그림을 끌지 않고 스크롤바가 받게 둔다.
    if (e.button !== 0 || (e.target as Element).closest('.os-scrollbar') || !markPannable(view))
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
  // 끄는 동안 `img` 를 끌어 놓기로 집어 들지 않는다.
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

function markPannable(view: HTMLElement): boolean {
  const overflows = view.scrollWidth > view.clientWidth || view.scrollHeight > view.clientHeight
  view.classList.toggle('pannable', overflows)
  return overflows
}
