// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyPng, diagramPng } from './copyImage'
import { drawDiagrams, errorLine, hasDiagram, naturalSize, type DiagramCache } from './diagrams'
import { prepareMarkdown, renderPart } from './markdown'
import { PINCH_SPAN, WHEEL_SPAN } from './zoom'

const doc = (text: string): HTMLElement => {
  const el = document.createElement('div')
  el.innerHTML = prepareMarkdown(text).parts.map(renderPart).join('')
  document.body.append(el)
  return el
}
const block = (source: string): string => '```mermaid\n' + source + '\n```'

// jsdom 의 canvas 는 그리지 못하므로 PNG 를 만드는 함수는 mock 한다. 만든 PNG 는 e2e(`e2e/canvas.spec.ts`)가 잰다.
vi.mock('./copyImage', async (original) => ({
  ...(await original<typeof import('./copyImage')>()),
  diagramPng: vi.fn(),
  copyPng: vi.fn()
}))

// 원문과 밝기를 SVG 에 적어, 어느 블록을 어느 밝기로 그렸는지 보이게 한다. `bad` 로 시작하면 문법 오류다.
function renderer() {
  const render = vi.fn(async (source: string, dark: boolean) => {
    if (source.startsWith('bad'))
      throw new Error(`Parse error on line 1:\n${source}\n^\nExpecting 'X'`)
    return `<svg data-source="${source.trim()}" data-dark="${dark}" width="200" height="100"></svg>`
  })
  const load = vi.fn(async () => render)
  return { render, load }
}

const svgs = (el: Element) =>
  [...el.querySelectorAll('.diagram .zoom-view > svg')].map((s) => [
    s.getAttribute('data-source'),
    s.getAttribute('data-dark')
  ])

afterEach(() => document.body.replaceChildren())

describe('drawDiagrams', () => {
  it('mermaid 블록을 숨기고 바로 뒤에 SVG 를 넣는다. 다른 코드 블록은 그대로 둔다', async () => {
    const el = doc(
      ['# t', block('graph TD; A-->B'), '```ts\nconst a = 1\n```', block('graph LR; C')].join(
        '\n\n'
      )
    )
    const { render, load } = renderer()
    await drawDiagrams(el, new Map(), false, load)
    expect(svgs(el)).toEqual([
      ['graph TD; A-->B', 'false'],
      ['graph LR; C', 'false']
    ])
    const pres = [...el.querySelectorAll('pre')]
    expect(pres.map((p) => p.hidden)).toEqual([true, false, true])
    expect(pres[0]!.nextElementSibling!.classList.contains('diagram')).toBe(true)
    expect(pres[1]!.nextElementSibling!.tagName).toBe('PRE')
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('mermaid 블록이 없으면 mermaid 를 읽지 않는다', async () => {
    const el = doc('```ts\nconst a = 1\n```\n\n`mermaid`')
    const { load } = renderer()
    await drawDiagrams(el, new Map(), false, load)
    expect(load).not.toHaveBeenCalled()
    expect(el.querySelector('.diagram, .diagram-error')).toBeNull()
  })

  it('문법이 틀린 블록은 코드를 보인 채 바로 뒤에 오류 한 줄을 넣는다', async () => {
    const el = doc(block('bad graph'))
    await drawDiagrams(el, new Map(), false, renderer().load)
    const pre = el.querySelector('pre')!
    expect(pre.hidden).toBe(false)
    expect(pre.nextElementSibling!.className).toBe('diagram-error')
    expect(pre.nextElementSibling!.textContent).toBe("Parse error on line 1: Expecting 'X'")
  })

  it('mermaid 를 읽지 못하면 블록마다 그 오류를 보인다', async () => {
    const el = doc(block('graph TD'))
    await drawDiagrams(el, new Map(), false, () => Promise.reject(new Error('load failed')))
    expect(el.querySelector('.diagram-error')!.textContent).toBe('load failed')
  })

  it('같은 캐시로 새로 만든 본문을 그리면 mermaid 를 다시 돌리지 않고 같은 SVG 를 넣는다', async () => {
    const text = [block('graph A'), block('bad'), block('graph B')].join('\n\n')
    const cache: DiagramCache = new Map()
    const { render, load } = renderer()
    const a = doc(text)
    await drawDiagrams(a, cache, false, load)
    a.remove()
    const b = doc(text)
    await drawDiagrams(b, cache, false, load)
    expect(render).toHaveBeenCalledTimes(3)
    expect(b.innerHTML).toBe(a.innerHTML)
  })

  it('그리는 동안 다시 불러도 블록마다 한 번만 그리고 한 번만 넣는다', async () => {
    const el = doc(block('graph A'))
    const { render, load } = renderer()
    const cache: DiagramCache = new Map()
    await Promise.all([drawDiagrams(el, cache, false, load), drawDiagrams(el, cache, false, load)])
    await drawDiagrams(el, cache, false, load)
    expect(render).toHaveBeenCalledTimes(1)
    expect(el.querySelectorAll('.diagram')).toHaveLength(1)
  })

  it('밝기가 바뀌면 그 밝기로 다시 그려 앞 결과를 바꾸고, 앞 밝기로 돌아오면 캐시를 쓴다', async () => {
    const el = doc([block('graph A'), block('bad')].join('\n\n'))
    const { render, load } = renderer()
    const cache: DiagramCache = new Map()
    await drawDiagrams(el, cache, false, load)
    await drawDiagrams(el, cache, true, load)
    expect(svgs(el)).toEqual([['graph A', 'true']])
    expect(el.querySelectorAll('.diagram-error')).toHaveLength(1)
    expect(el.children).toHaveLength(4)
    await drawDiagrams(el, cache, false, load)
    expect(svgs(el)).toEqual([['graph A', 'false']])
    expect(render).toHaveBeenCalledTimes(4)
  })

  it('나중에 붙인 블록만 새로 그린다', async () => {
    const el = doc(block('graph A'))
    const { render, load } = renderer()
    const cache: DiagramCache = new Map()
    await drawDiagrams(el, cache, false, load)
    el.insertAdjacentHTML(
      'beforeend',
      prepareMarkdown(block('graph B')).parts.map(renderPart).join('')
    )
    await drawDiagrams(el, cache, false, load)
    expect(svgs(el)).toEqual([
      ['graph A', 'false'],
      ['graph B', 'false']
    ])
    expect(render.mock.calls.map(([s]) => s.trim())).toEqual(['graph A', 'graph B'])
  })

  it('그리는 동안 밝기가 다시 바뀌면 앞 밝기의 결과는 넣지 않는다', async () => {
    const el = doc(block('graph A'))
    const { load } = renderer()
    const cache: DiagramCache = new Map()
    const light = drawDiagrams(el, cache, false, load)
    const dark = drawDiagrams(el, cache, true, load)
    await Promise.all([light, dark])
    expect(svgs(el)).toEqual([['graph A', 'true']])
  })

  it('떨어져 나간 본문에는 넣지 않는다', async () => {
    const el = doc(block('graph A'))
    const { load } = renderer()
    const drawing = drawDiagrams(el, new Map(), false, load)
    el.remove()
    await drawing
    expect(el.querySelector('.diagram')).toBeNull()
    expect(el.querySelector('pre')!.hidden).toBe(false)
  })

  it('SVG 안의 popover 속성과 dialog 는 지우고, class·style·id 는 남긴다', async () => {
    const el = doc(block('graph A'))
    const label =
      '<button popovertarget=p popovertargetaction=show class=icon-button style=color:red>open</button>' +
      '<div id=p popover>fake</div><dialog open>modal</dialog>'
    const svg = `<svg width="200" height="100"><foreignObject><div>${label}</div></foreignObject></svg>`
    await drawDiagrams(el, new Map(), false, async () => async () => svg)
    const view = el.querySelector('.diagram .zoom-view > svg')!
    expect(
      view.querySelector('[popover], [popovertarget], [popovertargetaction], dialog')
    ).toBeNull()
    const button = view.querySelector('button')!
    expect([button.className, button.getAttribute('style')]).toEqual(['icon-button', 'color:red'])
    expect(view.querySelector('#p')!.textContent).toBe('fake')
  })
})

describe('다이어그램 확대·축소', () => {
  const drawn = async (text = block('graph A')) => {
    const el = doc(text)
    const cache: DiagramCache = new Map()
    const { load } = renderer()
    await drawDiagrams(el, cache, false, load)
    const box = el.querySelector<HTMLElement>('.diagram')!
    const svg = box.querySelector<SVGElement>('svg')!
    const [out, reset, into, fit, copy] = [
      ...box.querySelectorAll<HTMLButtonElement>('.zoom-bar button')
    ]
    const size = () => [svg.style.width, svg.style.height, reset!.textContent]
    return {
      el,
      cache,
      load,
      box,
      svg,
      out: out!,
      reset: reset!,
      into: into!,
      fit: fit!,
      copy: copy!,
      size
    }
  }
  const wheel = (target: Element, init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(e)
    return e
  }

  it('mermaid 가 정한 크기로 넣고, 축소·배율·확대·fit·복사 버튼을 둔다', async () => {
    const { svg, out, reset, into, fit, copy, size } = await drawn()
    expect(size()).toEqual(['200px', '100px', '100%'])
    expect(svg.style.maxWidth).toBe('none')
    expect([out, reset, into, fit, copy].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Zoom out',
      'Reset zoom',
      'Zoom in',
      'Fit',
      'Copy image'
    ])
  })

  it('버튼으로 한 단계씩 확대·축소하고, 배율 버튼은 100% 로 되돌린다', async () => {
    const { out, reset, into, size } = await drawn()
    into.click()
    into.click()
    expect(size()).toEqual(['250px', '125px', '125%'])
    reset.click()
    expect(size()).toEqual(['200px', '100px', '100%'])
    out.click()
    expect(size()).toEqual(['180px', '90px', '90%'])
  })

  it('⌘ 나 ctrl(트랙패드 핀치)을 누른 휠만 deltaY 에 비례해 확대·축소하고 페이지 스크롤을 막는다', async () => {
    const { svg, size } = await drawn()
    const plain = wheel(svg, { deltaY: -WHEEL_SPAN * Math.log(2) })
    expect(plain.defaultPrevented).toBe(false)
    expect(size()).toEqual(['200px', '100px', '100%'])
    const meta = wheel(svg, { deltaY: -WHEEL_SPAN * Math.log(2), metaKey: true })
    expect(meta.defaultPrevented).toBe(true)
    expect(size()).toEqual(['400px', '200px', '200%'])
    wheel(svg, { deltaY: -PINCH_SPAN * Math.log(0.5), ctrlKey: true })
    expect(size()).toEqual(['200px', '100px', '100%'])
    // 한 단계(110%)보다 작게 움직인 이벤트는 단계로 올리지 않고 그만큼만 키운다.
    wheel(svg, { deltaY: -WHEEL_SPAN * Math.log(1.02), metaKey: true })
    expect(size()).toEqual(['204px', '102px', '102%'])
  })

  it('확대·축소해도 블록 높이는 100% 일 때의 다이어그램 높이 그대로다', async () => {
    const { box, into, out, size } = await drawn()
    const view = box.querySelector<HTMLElement>('.zoom-view')!
    expect(view.style.height).toBe('100px')
    into.click()
    into.click()
    expect(size()[1]).toBe('125px')
    expect(view.style.height).toBe('100px')
    out.click()
    out.click()
    out.click()
    expect(view.style.height).toBe('100px')
  })

  it('밝기가 바뀌어 다시 그린 다이어그램은 앞 배율을 잇는다', async () => {
    const { el, cache, load, into } = await drawn()
    into.click()
    await drawDiagrams(el, cache, true, load)
    const svg = el.querySelector<SVGElement>('.diagram .zoom-view > svg')!
    expect(svg.getAttribute('data-dark')).toBe('true')
    expect(svg.style.width).toBe('220px')
    expect(el.querySelector('.zoom-reset')!.textContent).toBe('110%')
  })

  it('fit 을 누르면 블록 높이는 맞춘 다이어그램의 높이가 되고, 밝기가 바뀌어 다시 그려도 그 높이를 잇는다', async () => {
    const { el, cache, load, box, fit, into, size } = await drawn()
    const view = box.querySelector<HTMLElement>('.zoom-view')!
    Object.defineProperty(view, 'clientWidth', { value: 300 })
    fit.click()
    expect(size()).toEqual(['300px', '150px', '150%'])
    expect(view.style.height).toBe('150px')
    into.click()
    await drawDiagrams(el, cache, true, load)
    const again = el.querySelector<HTMLElement>('.diagram .zoom-view')!
    expect(again.querySelector('svg')!.style.width).toBe('350px')
    expect(again.style.height).toBe('150px')
  })

  it('복사 버튼은 다이어그램을 100% 크기의 화면 배율 배 PNG 로 만들어 클립보드에 싣는다', async () => {
    const png = new Blob()
    vi.mocked(diagramPng).mockResolvedValue(png)
    vi.mocked(copyPng).mockResolvedValue()
    const { el, svg, into, copy } = await drawn()
    el.style.background = 'rgb(1, 2, 3)'
    into.click()
    copy.click()
    await vi.waitFor(() => expect(copyPng).toHaveBeenCalledWith(png))
    expect(diagramPng).toHaveBeenCalledWith(
      svg,
      { width: 200, height: 100 },
      'rgb(1, 2, 3)',
      devicePixelRatio
    )
  })

  describe('끌어서 스크롤', () => {
    // jsdom 은 레이아웃이 없어 넘치는지를 크기로 정해 준다.
    const pannable = async (overflows: boolean) => {
      const { box } = await drawn()
      const view = box.querySelector<HTMLElement>('.zoom-view')!
      Object.defineProperties(view, {
        clientWidth: { value: 200 },
        clientHeight: { value: 100 }
      })
      view.querySelector('svg')!.getBoundingClientRect = () =>
        new DOMRect(0, 0, overflows ? 400 : 200, 100)
      view.setPointerCapture = vi.fn()
      return view
    }
    const pointer = (target: Element, type: string, init: MouseEventInit = {}) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
      target.dispatchEvent(e)
      return e
    }

    it('넘치는 다이어그램을 왼쪽 버튼으로 끌면 끈 만큼 반대로 스크롤하고, 떼면 멈춘다', async () => {
      const view = await pannable(true)
      const down = pointer(view.querySelector('svg')!, 'pointerdown', { clientX: 100 })
      expect(down.defaultPrevented).toBe(true)
      expect(view.classList.contains('dragging')).toBe(true)
      pointer(window as unknown as Element, 'pointermove', { clientX: 70 })
      expect(view.scrollLeft).toBe(30)
      pointer(window as unknown as Element, 'pointerup')
      expect(view.classList.contains('dragging')).toBe(false)
      pointer(window as unknown as Element, 'pointermove', { clientX: 0 })
      expect(view.scrollLeft).toBe(30)
    })

    it('넘치지 않거나, 왼쪽 버튼이 아니거나, 블록에 씌운 스크롤바를 누르면 끌지 않는다', async () => {
      const fits = await pannable(false)
      expect(pointer(fits, 'pointerdown').defaultPrevented).toBe(false)
      expect(fits.classList.contains('pannable')).toBe(false)

      const view = await pannable(true)
      expect(pointer(view, 'pointerdown', { button: 2 }).defaultPrevented).toBe(false)
      const bar = document.createElement('div')
      bar.className = 'os-scrollbar'
      const handle = bar.appendChild(document.createElement('div'))
      view.append(bar)
      expect(pointer(handle, 'pointerdown').defaultPrevented).toBe(false)
      expect(view.classList.contains('dragging')).toBe(false)
      expect(view.setPointerCapture).not.toHaveBeenCalled()
    })
  })

  it('크기를 알 수 없는 SVG 는 그대로 넣고 버튼을 두지 않는다', async () => {
    const el = doc(block('graph A'))
    await drawDiagrams(el, new Map(), false, async () => async () => '<svg width="100%"></svg>')
    expect(el.querySelector('.diagram .zoom-view > svg')!.getAttribute('style')).toBeNull()
    expect(el.querySelector('.zoom-bar')).toBeNull()
  })
})

describe('naturalSize', () => {
  const svg = (attrs: string) => {
    const host = document.createElement('div')
    host.innerHTML = `<svg ${attrs}></svg>`
    return host.firstElementChild!
  }
  it('수로 적힌 width·height 를 먼저 쓰고, 없으면 viewBox 의 크기를 쓴다', () => {
    expect(naturalSize(svg('width="120.5" height="40" viewBox="0 0 10 10"'))).toEqual({
      width: 120.5,
      height: 40
    })
    expect(naturalSize(svg('width="100%" viewBox="-8 -8 300,90"'))).toEqual({
      width: 300,
      height: 90
    })
    expect(naturalSize(svg('width="100%"'))).toBeNull()
    expect(naturalSize(svg('viewBox="0 0 0 10"'))).toBeNull()
  })
})

describe('hasDiagram', () => {
  it('거른 HTML 에 mermaid 블록이 있을 때만 참이다', () => {
    const html = (text: string) => prepareMarkdown(text).parts.map(renderPart).join('')
    expect(hasDiagram(html(block('graph A')))).toBe(true)
    expect(hasDiagram(html('```Mermaid\ngraph A\n```'))).toBe(false)
    expect(hasDiagram(html('`<code class="language-mermaid">`'))).toBe(false)
    expect(hasDiagram(html('```ts\nmermaid\n```'))).toBe(false)
  })
})

describe('errorLine', () => {
  it('원문과 위치 표시를 빼고 첫 줄과 마지막 줄을 잇고, 한 줄이면 그대로 쓴다', () => {
    expect(
      errorLine(new Error('Parse error on line 2:\n...A-->\n---^\nExpecting X, got Y\n'))
    ).toBe('Parse error on line 2: Expecting X, got Y')
    expect(errorLine(new Error('No diagram type detected'))).toBe('No diagram type detected')
    // lexical error 는 위치 표시로 끝나므로 위치 표시와 원문을 빼면 첫 줄만 남는다.
    expect(
      errorLine(
        new Error(
          'Lexical error on line 2. Unrecognized text.\n...graph TD  A-->B\n----------------------^'
        )
      )
    ).toBe('Lexical error on line 2. Unrecognized text.')
    // gitGraph 등 langium 으로 읽는 다이어그램은 원문·위치 표시 없이 한 줄로 온다.
    expect(
      errorLine(
        new Error(
          'Parsing failed: unexpected character: ->x<- at offset: 12, skipped 1 characters.'
        )
      )
    ).toBe('Parsing failed: unexpected character: ->x<- at offset: 12, skipped 1 characters.')
    expect(errorLine('plain')).toBe('plain')
    expect(errorLine(new Error(''))).toBe('Unable to render the diagram')
  })
})
