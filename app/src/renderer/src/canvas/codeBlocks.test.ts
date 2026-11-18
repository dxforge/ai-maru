// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockHighlighter, hasCodeBlock, type HighlightCache } from './codeBlocks'
import { prepareMarkdown, renderPart } from './markdown'

const html = (text: string): string => prepareMarkdown(text).parts.map(renderPart).join('')
const doc = (text: string): HTMLElement => {
  const el = document.createElement('div')
  el.innerHTML = html(text)
  document.body.append(el)
  return el
}
const fence = (lang: string, code: string): string => '```' + lang + '\n' + code + '\n```'

function highlighter() {
  return vi.fn(async (code: string, lang: string) =>
    lang === 'plain' ? null : `<span data-lang="${lang}">${code}</span>`
  )
}
const langs = (el: Element) =>
  [...el.querySelectorAll('pre > code')].map((c) => c.querySelector('span')?.dataset.lang ?? null)

// jsdom 에는 `IntersectionObserver` 가 없다. 테스트가 `show` 로 블록이 화면에 들어왔다고 알린다.
const observers = new Set<{ targets: Set<Element>; callback: IntersectionObserverCallback }>()
class FakeObserver {
  readonly targets = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.add(this)
  }
  observe(el: Element): void {
    this.targets.add(el)
  }
  unobserve(el: Element): void {
    this.targets.delete(el)
  }
  disconnect(): void {
    this.targets.clear()
  }
}
const watched = (): Element[] => [...observers].flatMap((o) => [...o.targets])
const settle = () => new Promise((r) => setTimeout(r))
async function show(...els: Element[]): Promise<void> {
  for (const o of observers) {
    const entries = els
      .filter((el) => o.targets.has(el))
      .map((target) => ({ target, isIntersecting: true }))
    if (entries.length)
      o.callback(entries as IntersectionObserverEntry[], o as unknown as IntersectionObserver)
  }
  await settle()
}

beforeEach(() => vi.stubGlobal('IntersectionObserver', FakeObserver))
afterEach(() => {
  document.body.replaceChildren()
  observers.clear()
  vi.unstubAllGlobals()
})

describe('hasCodeBlock', () => {
  it('언어를 적은 코드 블록이 있을 때만 true 다', () => {
    expect(hasCodeBlock(html(fence('ts', 'let a = 1')))).toBe(true)
    expect(hasCodeBlock(html(fence('mermaid', 'flowchart LR') + '\n\n' + fence('js', 'x')))).toBe(
      true
    )
    expect(hasCodeBlock(html(fence('mermaid', 'flowchart LR')))).toBe(false)
    expect(hasCodeBlock(html(fence('', 'plain')))).toBe(false)
    expect(hasCodeBlock(html('inline `code` only'))).toBe(false)
  })

  it('마크다운에 직접 쓴 `<code>` 는 `class` 앞에 다른 속성이 있어도 찾는다', () => {
    const raw = html('<pre><code title="x" class="language-ts">let a = 1</code></pre>')
    expect(raw).toContain('title="x"')
    expect(hasCodeBlock(raw)).toBe(true)
  })
})

describe('BlockHighlighter', () => {
  it('언어를 적은 블록을 화면에 들어올 때 그 언어로 강조하고, 언어가 없거나 모르는 블록과 mermaid 블록은 그대로 둔다', async () => {
    const el = doc(
      [
        fence('js', 'const a = 1'),
        fence('', 'no language'),
        fence('mermaid', 'flowchart LR'),
        fence('plain', 'unknown'),
        fence('rust', 'fn main() {}')
      ].join('\n\n')
    )
    const run = highlighter()
    new BlockHighlighter(el, new Map(), run).scan()
    expect(watched().map((c) => c.className)).toEqual([
      'language-js',
      'language-plain',
      'language-rust'
    ])
    expect(run).not.toHaveBeenCalled()
    await show(...watched())
    expect(langs(el)).toEqual(['js', null, null, null, 'rust'])
    expect(run.mock.calls).toEqual([
      ['const a = 1\n', 'js'],
      ['unknown\n', 'plain'],
      ['fn main() {}\n', 'rust']
    ])
    expect(el.querySelector('code.language-plain')!.innerHTML).toBe('unknown\n')
  })

  it('화면에 들어온 블록만 맡긴다', async () => {
    const el = doc(fence('js', 'a') + '\n\n' + fence('rust', 'b'))
    const run = highlighter()
    new BlockHighlighter(el, new Map(), run).scan()
    await show(el.querySelector('code.language-rust')!)
    expect(run.mock.calls.map(([, lang]) => lang)).toEqual(['rust'])
    expect(langs(el)).toEqual([null, 'rust'])
    expect(watched()).toEqual([el.querySelector('code.language-js')])
  })

  it('강조를 받기 전에도 블록의 글자는 그대로 보인다', async () => {
    const el = doc(fence('ts', 'let a = 1'))
    let resolve!: (html: string) => void
    new BlockHighlighter(el, new Map(), () => new Promise((r) => (resolve = r))).scan()
    await show(...watched())
    expect(el.querySelector('code')!.textContent).toBe('let a = 1\n')
    resolve('<span>let a = 1</span>\n')
    await settle()
    expect(el.querySelector('code span')!.textContent).toBe('let a = 1')
  })

  it('묶음을 붙인 뒤 다시 scan 하면 새 블록만 지켜본다', async () => {
    const el = doc(fence('js', 'a'))
    const run = highlighter()
    const blocks = new BlockHighlighter(el, new Map(), run)
    blocks.scan()
    await show(...watched())
    el.insertAdjacentHTML('beforeend', html(fence('ts', 'b')))
    blocks.scan()
    expect(watched()).toEqual([el.querySelector('code.language-ts')])
    await show(...watched())
    expect(run.mock.calls.map(([, lang]) => lang)).toEqual(['js', 'ts'])
    expect(langs(el)).toEqual(['js', 'ts'])
  })

  it('같은 본문을 새 요소에 다시 그리면 받아 둔 강조를 쓰고 다시 맡기지 않는다', async () => {
    const cache: HighlightCache = new Map()
    const run = highlighter()
    const text = fence('js', 'a') + '\n\n' + fence('rust', 'b')
    new BlockHighlighter(doc(text), cache, run).scan()
    await show(...watched())
    const again = doc(text)
    new BlockHighlighter(again, cache, run).scan()
    await show(...watched())
    expect(run).toHaveBeenCalledTimes(2)
    expect(langs(again)).toEqual(['js', 'rust'])
  })

  it('다이어그램 라벨 안의 코드 블록은 지켜보지 않아, 다이어그램이 먼저 붙은 렌더에서도 블록 순서가 같다', async () => {
    const cache: HighlightCache = new Map()
    const run = highlighter()
    const text = [fence('mermaid', 'flowchart LR'), fence('ts', 'a'), fence('rust', 'b')].join(
      '\n\n'
    )
    new BlockHighlighter(doc(text), cache, run).scan()
    await show(...watched())
    const again = doc(text)
    const diagram = document.createElement('div')
    diagram.className = 'diagram'
    diagram.innerHTML = '<pre><code class="language-js">label</code></pre>'
    again.querySelector('pre')!.replaceWith(diagram)
    new BlockHighlighter(again, cache, run).scan()
    expect(watched().map((c) => c.className)).toEqual(['language-ts', 'language-rust'])
    await show(...watched())
    expect(run).toHaveBeenCalledTimes(2)
    expect(langs(again)).toEqual([null, 'ts', 'rust'])
  })

  it('마크다운에 직접 쓴 `<code>` 안에 링크 같은 태그가 있으면 그대로 둔다', async () => {
    const el = doc(
      '<pre><code class="language-ts">let <a href="https://example.com">a</a> = 1</code></pre>'
    )
    const run = highlighter()
    new BlockHighlighter(el, new Map(), run).scan()
    await show(...watched())
    expect(run).not.toHaveBeenCalled()
    expect(el.querySelector('code a')!.textContent).toBe('a')
  })

  it('stop 한 뒤에는 지켜보지 않는다', () => {
    const blocks = new BlockHighlighter(doc(fence('js', 'a')), new Map(), highlighter())
    blocks.scan()
    blocks.stop()
    expect(watched()).toEqual([])
  })
})
