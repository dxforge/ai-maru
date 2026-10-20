import type { Terminal } from '@xterm/xterm'

// xterm 은 조합 중인 글자를 renderer 가 아니라 DOM 의 `.composition-view` 로 그린다. WebGL renderer 는 글자를
// `char.top + char.height`(device px, char.top 은 반올림·char.height 는 올림)에 ideographic 기준선을 두고 그린다.
// 조합창은 CSS half-leading 으로 기준선을 정한다. 두 쪽의 반올림은 폰트·크기·lineHeight·DPR 마다 다르다.
// 그래서 조합 중인 글자가 확정된 글자보다 위나 아래에 그려진다. 이 모듈은 두 기준선을 재서 맞춘다.

export interface BaselineInput {
  dpr: number
  /** `dimensions.device.char.top`: renderer 가 셀 안에 글자 상자를 놓는 위치. */
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

/** 확정되면 차지할 칸 수. xterm 이 공개하지 않는 폭 계산이라, xterm 이 이 내부 API 를 없애면 `undefined` 를 돌려주고, 호출하는 쪽은 조합창 폭을 정하지 않는다. */
function cellCount(term: Terminal, text: string): number | undefined {
  const unicode = (
    term as unknown as {
      _core?: { unicodeService?: { getStringCellWidth?: (s: string) => number } }
    }
  )._core?.unicodeService
  return unicode?.getStringCellWidth?.(text)
}

function shift(view: HTMLElement, offset: number): void {
  // 조합창을 통째로 옮기면 비켜난 만큼 그 아래의 커서가 드러난다. 배경은 셀을 덮은 채 글자만 옮기도록
  // 내릴 때는 위 여백을 넣고, 올릴 때는 상자를 올리고 아래 여백으로 셀 아래 끝까지 덮는다.
  view.style.paddingTop = offset > 0 ? `${offset}px` : ''
  view.style.marginTop = offset < 0 ? `${offset}px` : ''
  view.style.paddingBottom = offset < 0 ? `${-offset}px` : ''
}

/**
 * `term.open()` 뒤에 부른다. xterm 이 open 에서 거는 조합 listener 보다 뒤에 돌아야 한다.
 * `webglCanvas` 는 WebGL 로 그리는 동안 그 캔버스를 돌려준다. DOM renderer 는 조합창과 같은 CSS 로 줄을
 * 그려 기준선이 이미 같다.
 */
export function alignComposition(
  term: Terminal,
  webglCanvas: () => HTMLCanvasElement | undefined
): void {
  let key = ''
  let offset = 0
  // xterm 은 compositionupdate 에서야 조합창의 글꼴·줄 높이를 정하므로 compositionstart 에서 재면 틀린다.
  term.textarea!.addEventListener('compositionupdate', (e) => {
    const view = term.element!.querySelector<HTMLElement>('.composition-view')
    const dims = term.dimensions
    if (!view || !dims) return
    const dpr = devicePixelRatio
    const canvas = webglCanvas()
    const overflow = canvas ? canvas.height - dims.device.canvas.height : 0
    // xterm 이 조합창의 줄 높이를 셀 높이로 정하므로 `view.style.lineHeight` 가 lineHeight·fontSize 변화를 반영한다.
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
    // 조합창은 글자 폭만큼만 넓다. 한글이 두 칸보다 좁으면 두 번째 칸이 비어 반쪽 상자처럼 보인다.
    // xterm 은 조합창 글자 양쪽에 U+200E 를 붙이고, `UnicodeGraphemesAddon` 은 이 글자를 1칸으로 센다. 그래서
    // `textContent` 가 아니라 `e.data` 를 센다.
    const cells = cellCount(term, e.data)
    view.style.minWidth = cells ? `${cells * dims.css.cell.width}px` : ''
  })
}
