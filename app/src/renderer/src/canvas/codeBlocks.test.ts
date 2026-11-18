// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasCodeBlock, highlightBlocks, type HighlightCache } from './codeBlocks'
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

afterEach(() => document.body.replaceChildren())

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

describe('highlightBlocks', () => {
  it('언어를 적은 블록을 그 언어로 강조하고, 언어가 없거나 모르는 블록과 mermaid 블록은 그대로 둔다', async () => {
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
    await highlightBlocks(el, new Map(), run)
    expect(langs(el)).toEqual(['js', null, null, null, 'rust'])
    expect(run.mock.calls).toEqual([
      ['const a = 1\n', 'js'],
      ['unknown\n', 'plain'],
      ['fn main() {}\n', 'rust']
    ])
    expect(el.querySelector('code.language-plain')!.innerHTML).toBe('unknown\n')
  })

  it('강조를 받기 전에도 블록의 글자는 그대로 보인다', async () => {
    const el = doc(fence('ts', 'let a = 1'))
    let resolve!: (html: string) => void
    const done = highlightBlocks(el, new Map(), () => new Promise((r) => (resolve = r)))
    expect(el.querySelector('code')!.textContent).toBe('let a = 1\n')
    resolve('<span>let a = 1</span>\n')
    await done
    expect(el.querySelector('code span')!.textContent).toBe('let a = 1')
  })

  it('묶음을 붙인 뒤 다시 부르면 새 블록만 맡긴다', async () => {
    const el = doc(fence('js', 'a'))
    const cache: HighlightCache = new Map()
    const run = highlighter()
    await highlightBlocks(el, cache, run)
    el.insertAdjacentHTML('beforeend', html(fence('ts', 'b')))
    await highlightBlocks(el, cache, run)
    expect(run.mock.calls.map(([, lang]) => lang)).toEqual(['js', 'ts'])
    expect(langs(el)).toEqual(['js', 'ts'])
  })

  it('다이어그램 라벨 안의 코드 블록은 맡기지 않아, 다이어그램이 먼저 붙은 렌더에서도 블록 순서가 같다', async () => {
    const cache: HighlightCache = new Map()
    const run = highlighter()
    const text = [fence('mermaid', 'flowchart LR'), fence('ts', 'a'), fence('rust', 'b')].join(
      '\n\n'
    )
    await highlightBlocks(doc(text), cache, run)
    const again = doc(text)
    const diagram = document.createElement('div')
    diagram.className = 'diagram'
    diagram.innerHTML = '<pre><code class="language-js">label</code></pre>'
    again.querySelector('pre')!.replaceWith(diagram)
    await highlightBlocks(again, cache, run)
    expect(run).toHaveBeenCalledTimes(2)
    expect(langs(again)).toEqual([null, 'ts', 'rust'])
  })

  it('마크다운에 직접 쓴 `<code>` 안에 링크 같은 태그가 있으면 그대로 둔다', async () => {
    const el = doc(
      '<pre><code class="language-ts">let <a href="https://example.com">a</a> = 1</code></pre>'
    )
    const run = highlighter()
    await highlightBlocks(el, new Map(), run)
    expect(run).not.toHaveBeenCalled()
    expect(el.querySelector('code a')!.textContent).toBe('a')
  })

  it('같은 본문을 새 요소에 다시 그리면 받아 둔 강조를 쓰고 다시 맡기지 않는다', async () => {
    const cache: HighlightCache = new Map()
    const run = highlighter()
    const text = fence('js', 'a') + '\n\n' + fence('rust', 'b')
    await highlightBlocks(doc(text), cache, run)
    const again = doc(text)
    await highlightBlocks(again, cache, run)
    expect(run).toHaveBeenCalledTimes(2)
    expect(langs(again)).toEqual(['js', 'rust'])
  })
})
