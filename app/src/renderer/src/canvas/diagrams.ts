import { PINCH_SPAN, stepZoom, WHEEL_SPAN, wheelZoom, zoomLabel } from './zoom'

/** mermaid 가 그린 SVG, 또는 그리지 못한 까닭 한 줄. */
export type Diagram = { svg: string } | { error: string }

/** mermaid 원문을 SVG 로 그린다. 문법이 틀리면 reject 한다. */
export type RenderDiagram = (source: string, dark: boolean) => Promise<string>

/** 블록 순서와 밝기마다 그린 결과. 문서 하나의 본문에 하나씩 두어, 본문을 다시 그릴 때 mermaid 를 다시 돌리지 않는다. */
export type DiagramCache = Map<string, Promise<Diagram>>

// `renderPart` 가 거른 HTML 에서 mermaid 블록이 남는 꼴이다. sanitize 가 `code` 의 `class` 말고는 속성을 모두 지운다.
const BLOCK = '<code class="language-mermaid">'

/** `renderPart` 가 낸 HTML 에 mermaid 블록이 있는지 본다. 없으면 본문의 DOM 을 뒤지지 않는다. */
export function hasDiagram(html: string): boolean {
  return html.includes(BLOCK)
}

// 블록(`pre`)마다 지금 그리고 있거나 그린 밝기와, 그 결과를 넣은 요소.
const drawn = new WeakMap<Element, { dark: boolean; out?: Element }>()

/**
 * `el` 안의 mermaid 블록을 `dark` 밝기의 다이어그램으로 바꾼다. 그린 블록은 숨기고 바로 뒤에 SVG 를 넣는다. 문법이 틀린
 * 블록은 코드를 그대로 두고 뒤에 오류 한 줄을 넣는다. 이미 이 밝기로 그린 블록은 건너뛰므로, 묶음을 붙이거나 밝기가
 * 바뀔 때마다 다시 불러도 된다. mermaid 는 처음 그릴 블록이 생겼을 때 `load` 로 읽는다.
 */
export function drawDiagrams(
  el: Element,
  cache: DiagramCache,
  dark: boolean,
  load: () => Promise<RenderDiagram>
): Promise<void> {
  const blocks = [...el.querySelectorAll('pre > code.language-mermaid')]
  return Promise.all(
    blocks.map(async (code, i) => {
      const pre = code.parentElement!
      const was = drawn.get(pre)
      if (was?.dark === dark) return
      const claim = { dark, out: was?.out }
      drawn.set(pre, claim)
      const key = `${dark ? 'dark' : 'light'}:${i}`
      let diagram = cache.get(key)
      if (!diagram) {
        const source = code.textContent ?? ''
        diagram = load()
          .then((render) => render(source, dark))
          .then(
            (svg) => ({ svg }),
            (e: unknown) => ({ error: errorLine(e) })
          )
        cache.set(key, diagram)
      }
      const d = await diagram
      // 그리는 동안 밝기가 다시 바뀌었거나 본문이 떨어져 나갔으면 넣지 않는다.
      if (drawn.get(pre) !== claim || !el.isConnected) return
      let out: HTMLElement
      if ('svg' in d) {
        out = diagramBox(d.svg, (claim.out && zooms.get(claim.out)) ?? 1)
      } else {
        out = document.createElement('div')
        out.className = 'diagram-error'
        out.textContent = d.error
      }
      pre.hidden = 'svg' in d
      if (claim.out) claim.out.replaceWith(out)
      else pre.after(out)
      claim.out = out
    })
  ).then(() => undefined)
}

// 다이어그램(`.diagram`)마다 지금 배율. 밝기가 바뀌어 다시 그린 다이어그램이 앞 배율을 잇는 데 쓴다.
const zooms = new WeakMap<Element, number>()

/**
 * SVG 를 mermaid 가 정한 크기로 담는 블록을 만든다. 블록의 높이는 100% 일 때의 다이어그램 높이로 고정해, 확대·축소해도
 * 아래 글이 밀리지 않는다. 블록보다 큰 다이어그램은 블록 안에서 가로·세로로 스크롤하거나 끌어서 옮긴다. 블록 위에
 * 포인터를 올리면 오른쪽 위에 확대·축소 버튼이 보이고, 블록 위의 ⌘+휠·트랙패드 핀치도 확대·축소한다. 크기를 알 수 없는
 * SVG 는 그대로 넣고 버튼을 두지 않는다.
 */
function diagramBox(svg: string, scale: number): HTMLElement {
  const out = document.createElement('div')
  out.className = 'diagram'
  const view = document.createElement('div')
  view.className = 'diagram-view'
  view.innerHTML = svg
  out.append(view)
  const graphic = view.querySelector('svg')
  const size = graphic && naturalSize(graphic)
  if (!graphic || !size) return out
  view.style.height = `${size.height}px`

  const bar = document.createElement('div')
  bar.className = 'diagram-zoom'
  // Canvas 의 다른 버튼처럼 눌러도 터미널 등 포커스를 가진 요소를 blur 하지 않는다.
  bar.addEventListener('mousedown', (e) => e.preventDefault())
  const button = (text: string, label: string, next: () => number): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'icon-button'
    b.textContent = text
    b.setAttribute('aria-label', label)
    b.addEventListener('click', () => zoomTo(next()))
    bar.append(b)
    return b
  }
  button('−', 'Zoom out', () => stepZoom(scale, -1))
  const reset = button('', 'Reset zoom', () => 1)
  button('+', 'Zoom in', () => stepZoom(scale, 1))
  out.append(bar)

  const apply = (): void => {
    graphic.style.width = `${size.width * scale}px`
    graphic.style.height = `${size.height * scale}px`
    graphic.style.maxWidth = 'none'
    reset.textContent = zoomLabel(scale)
    zooms.set(out, scale)
  }
  // 화면 좌표 `at` 에 있던 다이어그램의 점이 배율을 바꾼 뒤에도 그 자리에 남도록 스크롤을 옮긴다. 버튼은 블록 가운데를 쓴다.
  const zoomTo = (next: number, at?: { x: number; y: number }): void => {
    const before = graphic.getBoundingClientRect()
    const box = view.getBoundingClientRect()
    const x = at?.x ?? box.left + box.width / 2
    const y = at?.y ?? box.top + box.height / 2
    const ratio = next / scale
    scale = next
    apply()
    const after = graphic.getBoundingClientRect()
    view.scrollLeft += after.left + (x - before.left) * ratio - x
    view.scrollTop += after.top + (y - before.top) * ratio - y
    markPannable(view)
  }
  out.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // 핀치는 `ctrlKey` 만 켜진 wheel 로 온다.
      const span = e.metaKey ? WHEEL_SPAN : PINCH_SPAN
      zoomTo(wheelZoom(scale, e.deltaY, span), { x: e.clientX, y: e.clientY })
    },
    { passive: false }
  )
  dragToScroll(view)
  apply()
  return out
}

/**
 * 다이어그램이 블록보다 클 때 끌어서 블록 안을 스크롤한다. 끄는 동안 글자를 선택하거나 포커스를 옮기지 않는다. 끌 수 있는
 * 동안은 `pannable` 을 붙여 포인터 모양으로 알린다. 넘치는지는 포인터가 들어올 때와 배율을 바꾼 뒤(`markPannable`)에 잰다.
 */
function dragToScroll(view: HTMLElement): void {
  view.addEventListener('pointerenter', () => markPannable(view))
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !markPannable(view)) return
    e.preventDefault()
    view.setPointerCapture(e.pointerId)
    view.classList.add('dragging')
    let { clientX: x, clientY: y } = e
    const move = (m: PointerEvent): void => {
      view.scrollLeft -= m.clientX - x
      view.scrollTop -= m.clientY - y
      x = m.clientX
      y = m.clientY
    }
    const end = (): void => {
      view.classList.remove('dragging')
      view.removeEventListener('pointermove', move)
      view.removeEventListener('pointerup', end)
      view.removeEventListener('pointercancel', end)
    }
    view.addEventListener('pointermove', move)
    view.addEventListener('pointerup', end)
    view.addEventListener('pointercancel', end)
  })
}

function markPannable(view: HTMLElement): boolean {
  const overflows = view.scrollWidth > view.clientWidth || view.scrollHeight > view.clientHeight
  view.classList.toggle('pannable', overflows)
  return overflows
}

/** SVG 의 `width`·`height` 속성이 수이면 그것을, 아니면 `viewBox` 의 크기를 쓴다. 둘 다 없으면 `null`. */
export function naturalSize(svg: Element): { width: number; height: number } | null {
  const width = Number(svg.getAttribute('width'))
  const height = Number(svg.getAttribute('height'))
  if (width > 0 && height > 0) return { width, height }
  const box = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (box.length === 4 && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]! }
  return null
}

/**
 * mermaid 의 오류를 한 줄로 줄인다. 문법 오류는 첫 줄에 줄 번호, 마지막 줄에 기대한 것과 받은 것을 적고 그 사이에 원문과
 * 위치 표시를 두므로, 첫 줄과 마지막 줄만 잇는다.
 */
export function errorLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return 'Unable to render the diagram'
  return lines.length > 1 ? `${lines[0]} ${lines[lines.length - 1]}` : lines[0]!
}
