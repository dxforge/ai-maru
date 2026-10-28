import type { Terminal } from '@xterm/xterm'

// xterm 은 조합 중인 글자를 renderer 가 아니라 DOM 의 `.composition-view` 로 그린다. WebGL renderer 는 글자를
// `char.top + char.height`(device px, char.top 은 반올림·char.height 는 올림)에 ideographic 기준선을 두고 그린다.
// 조합창은 CSS half-leading 으로 기준선을 정한다. 두 쪽의 반올림은 폰트·크기·lineHeight·DPR 마다 다르다.
// 그래서 조합 중인 글자가 확정된 글자보다 위나 아래에 그려진다. 이 모듈은 두 기준선을 재서 맞춘다.

export interface BaselineInput {
  dpr: number
  /** `dimensions.device.char.top`: renderer 가 글자 칸 안에 글자 상자를 놓는 위치. */
  charTop: number
  /** `dimensions.device.char.height`: renderer 는 이 상자의 아래 끝에 ideographic 기준선을 둔다. */
  charHeight: number
  /** device 크기 폰트에서 잰 alphabetic 기준선부터 ideographic 기준선까지의 거리. 아래쪽이라 음수다. */
  ideographicBaseline: number
  /** 조합창 위 끝부터 alphabetic 기준선까지(CSS px). */
  domBaseline: number
  /**
   * WebGL 캔버스의 backing 높이에서 `dimensions.device.canvas.height` 를 뺀 값. xterm 은 캔버스의 CSS 높이를
   * `round(device / dpr)` 로 둔다. DPR 2 에서 device 높이가 홀수면 backing 이 1px 커지고, 모든 줄의 글자가
   * 1 device px 내려간다.
   */
  canvasOverflow: number
}

/** 조합창 글자를 renderer 의 기준선에 맞추려고 내릴 거리(CSS px). renderer 의 글자가 device px 격자에 있으므로 거기에 맞춘다. */
export function baselineOffset(input: BaselineInput): number {
  const { dpr } = input
  const alphabetic =
    input.charTop + input.charHeight + input.ideographicBaseline + input.canvasOverflow
  return Math.round(alphabetic - input.domBaseline * dpr) / dpr
}

let measureCtx: CanvasRenderingContext2D | null = null

function ideographicBaseline(term: Terminal, dpr: number): number | undefined {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return undefined
  const { fontFamily, fontSize } = term.options
  measureCtx.font = `${fontSize! * dpr}px ${fontFamily}`
  measureCtx.textBaseline = 'alphabetic'
  const value = measureCtx.measureText('한').ideographicBaseline
  return Number.isFinite(value) ? value : undefined
}

function domBaseline(view: HTMLElement): number {
  // 빈 inline-block 의 아래 끝은 그 줄의 alphabetic 기준선에 놓인다.
  const probe = document.createElement('span')
  probe.style.cssText = 'display:inline-block;width:0;height:0'
  view.appendChild(probe)
  const baseline = probe.getBoundingClientRect().bottom - view.getBoundingClientRect().top
  probe.remove()
  return baseline
}

/**
 * 확정되면 차지할 글자 칸 수. xterm 이 공개하지 않는 `_core.unicodeService` 를 쓴다. 이 API 가 없어지면 `undefined` 를
 * 돌려주고, 호출하는 쪽은 조합창 폭을 정하지 않는다.
 */
function cellCount(term: Terminal, text: string): number | undefined {
  const unicode = (
    term as unknown as {
      _core?: { unicodeService?: { getStringCellWidth?: (s: string) => number } }
    }
  )._core?.unicodeService
  return unicode?.getStringCellWidth?.(text)
}

const FITS = 'composition-fits'

const LRM = '\u200E'
let graphemes: Intl.Segmenter | undefined

/**
 * 조합창 글자를 grapheme 마다 span 으로 나누고, 각 span 이 확정되면 차지할 글자 칸 폭만큼 나아가게 `letter-spacing` 을 준다.
 * 글자 폭과 글자 칸 폭은 따로 정해진다. 그래서 글자를 span 으로 나누지 않고 그리면 글자마다 차이가 쌓여, 뒤의 글자일수록 확정되면
 * 그려질 자리에서 멀어진다. 조합한 글자가 확정되면 차지할 글자 칸 수를 돌려준다. 칸 수를 셀 수 없으면 글자를 나누지 않고 0 을
 * 돌려준다.
 */
function spaceGlyphs(term: Terminal, view: HTMLElement, data: string, cellWidth: number): number {
  graphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const parts = Array.from(graphemes.segment(data), (s) => ({
    text: s.segment,
    cells: cellCount(term, s.segment)
  }))
  if (parts.length === 0 || parts.some((p) => p.cells === undefined)) return 0
  const spans = parts.map((p) => {
    const span = document.createElement('span')
    span.textContent = p.text
    return span
  })
  // `replaceChildren` 이 지운 U+200E 를 xterm 처럼 글자 양쪽에 다시 넣는다. xterm 이 rtl 인 조합창에서도 글자를 ltr 순서로
  // 그리려고 붙이는 표시다.
  view.replaceChildren(LRM, ...spans, LRM)
  const advances = spans.map((span) => span.getBoundingClientRect().width)
  spans.forEach((span, i) => {
    span.style.letterSpacing = `${parts[i].cells! * cellWidth - advances[i]}px`
  })
  return parts.reduce((sum, p) => sum + p.cells!, 0)
}

function shift(view: HTMLElement, offset: number): void {
  // 조합창을 통째로 옮기면 비켜난 만큼 그 아래의 커서가 드러난다. 그래서 배경은 글자 칸을 덮은 채 여백으로 글자만 옮긴다.
  view.style.paddingTop = offset > 0 ? `${offset}px` : ''
  view.style.marginTop = offset < 0 ? `${offset}px` : ''
  view.style.paddingBottom = offset < 0 ? `${-offset}px` : ''
}

/**
 * `term.open()` 뒤에 부른다. xterm 이 open 에서 거는 조합 listener 와 `onRender` listener 보다 뒤에 돌아야 한다. xterm 의
 * listener 가 조합창의 글자·글꼴·줄 높이·위치를 정한 뒤에 재야 하기 때문이다.
 * `webglCanvas` 는 WebGL 로 그리는 동안 그 캔버스를 돌려준다. DOM renderer 는 조합창과 같은 CSS 로 줄을
 * 그려 기준선이 이미 같다.
 */
export function alignComposition(
  term: Terminal,
  webglCanvas: () => HTMLCanvasElement | undefined
): void {
  let key = ''
  let offset = 0
  let data = ''
  let spacedKey = ''

  const align = (view: HTMLElement, dims: NonNullable<Terminal['dimensions']>): void => {
    const dpr = devicePixelRatio
    const canvas = webglCanvas()
    const overflow = canvas ? canvas.height - dims.device.canvas.height : 0
    // xterm 이 조합창의 줄 높이를 글자 칸 높이로 정하므로 `view.style.lineHeight` 가 lineHeight·fontSize 변화를 반영한다.
    const next = [dpr, term.options.fontFamily, term.options.fontSize, view.style.lineHeight]
      .concat(canvas ? [dims.device.char.top, dims.device.char.height, overflow] : [])
      .join('|')
    if (next !== key) {
      key = next
      shift(view, 0)
      const ideographic = canvas && ideographicBaseline(term, dpr)
      offset =
        ideographic === undefined
          ? 0
          : baselineOffset({
              dpr,
              charTop: dims.device.char.top,
              charHeight: dims.device.char.height,
              ideographicBaseline: ideographic,
              domBaseline: domBaseline(view),
              canvasOverflow: overflow
            })
    }
    shift(view, offset)

    // xterm 이 조합창을 두는 열과 같게 센다. 커서가 마지막 열 뒤에 있으면 xterm 은 마지막 열에 둔다.
    const room = term.cols - Math.min(term.buffer.active.cursorX, term.cols - 1)
    const cellWidth = dims.css.cell.width
    const spacing = [data, cellWidth, term.options.fontFamily, term.options.fontSize, room].join(
      '|'
    )
    if (spacing === spacedKey) return
    spacedKey = spacing
    // xterm 이 커서 뒤 남은 폭으로 둔 `maxWidth` 가 `width` 보다 앞서므로, 마지막 열에서도 조합창이 터미널 밖으로 넘치지 않는다.
    const cells = spaceGlyphs(term, view, data, cellWidth)
    view.style.width = cells ? `${cells * cellWidth}px` : ''
    // xterm 은 긴 조합의 끝을 보이려고 조합창을 `direction: rtl`·`overflow: hidden` 으로 둔다. 남은 폭 안에 들어가는 조합은
    // ltr 로 두고, 글자 칸보다 넓은 마지막 글자의 끝이 잘리지 않게 넘친 것을 보인다.
    view.classList.toggle(FITS, cells > 0 && cells <= room)
  }

  term.textarea!.addEventListener('compositionstart', () => {
    data = ''
  })
  term.textarea!.addEventListener('compositionupdate', (e) => {
    const view = term.element!.querySelector<HTMLElement>('.composition-view')
    const dims = term.dimensions
    if (!view || !dims) return
    // xterm 이 조합창의 글자를 `e.data` 로 다시 넣었으므로 글자를 다시 나눈다.
    data = e.data
    spacedKey = ''
    align(view, dims)
  })
  // 조합 중에 커서가 옮겨지거나 터미널 크기·글꼴 크기가 바뀌면 xterm 은 다시 그린 뒤 조합창의 위치·글꼴·`maxWidth` 를 고친다.
  // 그때 남은 폭과 글자 칸 폭이 바뀌므로 다시 맞춘다.
  term.onRender(() => {
    const view = term.element?.querySelector<HTMLElement>('.composition-view.active')
    const dims = term.dimensions
    if (!view || !dims || !data) return
    align(view, dims)
  })
}
