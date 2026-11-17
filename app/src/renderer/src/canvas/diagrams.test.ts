// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drawDiagrams, errorLine, hasDiagram, naturalSize, type DiagramCache } from './diagrams'
import { prepareMarkdown, renderPart } from './markdown'

const doc = (text: string): HTMLElement => {
  const el = document.createElement('div')
  el.innerHTML = prepareMarkdown(text).parts.map(renderPart).join('')
  document.body.append(el)
  return el
}
const block = (source: string): string => '```mermaid\n' + source + '\n```'

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
  [...el.querySelectorAll('.diagram svg')].map((s) => [
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
    expect(pres[0]!.nextElementSibling!.className).toBe('diagram')
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
})

describe('다이어그램 확대·축소', () => {
  const drawn = async (text = block('graph A')) => {
    const el = doc(text)
    const cache: DiagramCache = new Map()
    const { load } = renderer()
    await drawDiagrams(el, cache, false, load)
    const box = el.querySelector<HTMLElement>('.diagram')!
    const svg = box.querySelector<SVGElement>('svg')!
    const [out, reset, into] = [...box.querySelectorAll<HTMLButtonElement>('.diagram-zoom button')]
    const size = () => [svg.style.width, svg.style.height, reset!.textContent]
    return { el, cache, load, box, svg, out: out!, reset: reset!, into: into!, size }
  }
  const wheel = (target: Element, init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(e)
    return e
  }

  it('mermaid 가 정한 크기로 넣고, 축소·배율·확대 버튼을 둔다', async () => {
    const { svg, out, reset, into, size } = await drawn()
    expect(size()).toEqual(['200px', '100px', '100%'])
    expect(svg.style.maxWidth).toBe('none')
    expect([out, reset, into].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Zoom out',
      'Reset zoom',
      'Zoom in'
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

  it('⌘ 나 ctrl(트랙패드 핀치)을 누른 휠만 확대·축소하고 페이지 스크롤을 막는다', async () => {
    const { svg, size } = await drawn()
    const plain = wheel(svg, { deltaY: -100 * Math.log(2) })
    expect(plain.defaultPrevented).toBe(false)
    expect(size()).toEqual(['200px', '100px', '100%'])
    const meta = wheel(svg, { deltaY: -100 * Math.log(2), metaKey: true })
    expect(meta.defaultPrevented).toBe(true)
    expect(size()).toEqual(['400px', '200px', '200%'])
    wheel(svg, { deltaY: -100 * Math.log(0.5), ctrlKey: true })
    expect(size()).toEqual(['200px', '100px', '100%'])
  })

  it('밝기가 바뀌어 다시 그린 다이어그램은 앞 배율을 잇는다', async () => {
    const { el, cache, load, into } = await drawn()
    into.click()
    await drawDiagrams(el, cache, true, load)
    const svg = el.querySelector<SVGElement>('.diagram svg')!
    expect(svg.getAttribute('data-dark')).toBe('true')
    expect(svg.style.width).toBe('220px')
    expect(el.querySelector('.diagram-zoom button:nth-child(2)')!.textContent).toBe('110%')
  })

  it('크기를 알 수 없는 SVG 는 그대로 넣고 버튼을 두지 않는다', async () => {
    const el = doc(block('graph A'))
    await drawDiagrams(el, new Map(), false, async () => async () => '<svg width="100%"></svg>')
    expect(el.querySelector('.diagram svg')!.getAttribute('style')).toBeNull()
    expect(el.querySelector('.diagram-zoom')).toBeNull()
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
  it('여러 줄이면 첫 줄과 마지막 줄을 잇고, 한 줄이면 그대로 쓴다', () => {
    expect(
      errorLine(new Error('Parse error on line 2:\n...A-->\n---^\nExpecting X, got Y\n'))
    ).toBe('Parse error on line 2: Expecting X, got Y')
    expect(errorLine(new Error('No diagram type detected'))).toBe('No diagram type detected')
    expect(errorLine('plain')).toBe('plain')
    expect(errorLine(new Error(''))).toBe('Unable to render the diagram')
  })
})
