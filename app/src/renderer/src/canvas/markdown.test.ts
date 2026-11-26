// @vitest-environment jsdom
// DOMPurify 는 DOM 이 없으면 입력을 거르지 않고 그대로 돌려주므로, 이 파일만 DOM 환경에서 돌린다.
import fc from 'fast-check'
import { Marked } from 'marked'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownBody, prepareMarkdown, renderPart, type Part } from './markdown'

const html = (parts: Part[]): string => parts.map(renderPart).join('')

function render(...blocks: string[]): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html(prepareMarkdown(blocks.join('\n\n')).parts)
  return el
}

// 앱 CSS 가 걸리거나 창 위에 뜨거나 앱 UI 처럼 보일 수 있는 요소·속성
const UNSAFE = [
  'div, span, style, script, dialog, form, button, textarea, select, img, iframe',
  'input:not([type="checkbox"][disabled])',
  '[style], [id], [popover], [popovertarget], [class]:not(code[class^="language-"])'
].join(', ')

function unsafe(el: HTMLElement): string[] {
  return [...el.querySelectorAll('*')]
    .filter(
      (e) => e.matches(UNSAFE) || e.getAttributeNames().some((n) => /^(on|data-|aria-)/.test(n))
    )
    .map((e) => e.outerHTML)
}

describe('renderPart', () => {
  it('markdown 을 HTML 로 그린다', () => {
    const el = render('# Title', 'some **bold** text')
    expect(el.querySelector('h1')?.textContent).toBe('Title')
    expect(el.querySelector('strong')?.textContent).toBe('bold')
  })

  it('앱 class·popover·dialog·입력창·style 은 요소나 속성으로 남지 않는다', () => {
    const el = render(
      '<div class="palette-backdrop">\n<style>.xterm { visibility: hidden }</style>\n</div>',
      '<dialog open>dialog-body</dialog>',
      'a <form><input name="q"><button popovertarget="p">go</button></form> b',
      'c <span style="position: fixed; inset: 0">overlay</span> <b popover id="x">pop</b> d',
      '<p class="palette-backdrop" data-x="1" aria-hidden="true">p</p>',
      '<input type="checkbox"> <input type="checkbox" disabled class="x">',
      'after'
    )
    expect(unsafe(el)).toEqual([])
    expect(el.querySelectorAll('input')).toHaveLength(1)
    expect(el.textContent).not.toContain('visibility')
    expect(el.textContent).toContain('dialog-body')
    expect(el.textContent).toContain('overlay')
    expect(el.querySelector('b')?.textContent).toBe('pop')
    expect(el.textContent).toContain('after')
  })

  it.each([
    ['textarea 블록의 빈 줄', '<textarea>\n\n<div class="palette-backdrop">x</div>\n</textarea>'],
    ['script 블록의 빈 줄', '<script>\n\n<div class="palette-backdrop">x</div>\n</script>'],
    ['pre 블록의 빈 줄', '<pre>\n\n<dialog open>x</dialog>\n</pre>'],
    ['div 블록', '<div class="palette-backdrop">\n\n**x**\n\n</div>'],
    ['여러 줄 주석', '<!--\n-->\n<dialog open>x</dialog>'],
    ['목록 안', '- <div class="palette-backdrop">x</div>'],
    ['인용 안', '> <dialog open>x</dialog>'],
    ['표 머리 칸', '| <form><button>x</button></form> |\n| - |\n| c |'],
    ['setext heading', '<span style="position: fixed">x</span>\n==='],
    ['kbd 뒤의 heading', 'x <kbd>\n# <div class="palette-backdrop">x</div>'],
    ['pre 뒤의 블록', 'x <pre>\n\n<input placeholder="fake">'],
    ['a 닫는 태그 뒤', '<a href="x">a</a> <dialog open>x</dialog>'],
    [
      '링크 글자 안의 a',
      '[<a href="javascript:alert(1)" class="palette-backdrop">in</a>](https://x)'
    ],
    ['코드 블록 info string', '```palette-backdrop popover\nx\n```'],
    ['title 속성의 따옴표', '[t](https://x "a\\" onmouseover=\\"alert(1)")']
  ])('%s 에서도 막는다', (_, src) => {
    const el = render(src)
    expect(unsafe(el)).toEqual([])
    expect(el.querySelector('.palette-backdrop')).toBeNull()
  })

  it('javascript·data·vbscript 링크는 주소를 지운다', () => {
    const el = render(
      '[j](javascript:alert(1)) [d](data:text/html,x) [v](vbscript:x) <a href="javascript:alert(2)">r</a>'
    )
    expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      null,
      null,
      null,
      null
    ])
  })

  it('글자 꾸밈·접기 태그는 요소로 그린다', () => {
    const el = render(
      '<kbd>⌘</kbd> H<sub>2</sub>O x<sup>2</sup> <mark>m</mark> <s>s</s> <ins>n</ins> <b>b</b> <i>i</i><br>next',
      '<details open>\n<summary>요약</summary>\n\n**본문**\n\n</details>'
    )
    for (const tag of ['kbd', 'sub', 'sup', 'mark', 's', 'ins', 'b', 'i', 'br']) {
      expect(el.querySelector(tag), tag).not.toBeNull()
    }
    expect(el.querySelector('details')?.hasAttribute('open')).toBe(true)
    expect(el.querySelector('details summary')?.textContent).toBe('요약')
    expect(el.querySelector('details strong')?.textContent).toBe('본문')
  })

  it('markdown 이 만드는 class·속성은 남는다', () => {
    const el = render(
      '```ts\nconst x = 1\n```',
      '3. three',
      '| a |\n| :-: |\n| b |',
      '- [x] done\n- [ ] todo',
      '[t](https://x "title")'
    )
    expect(el.querySelector('pre code')?.className).toBe('language-ts')
    expect(el.querySelector('ol')?.getAttribute('start')).toBe('3')
    expect(el.querySelector('td')?.getAttribute('align')).toBe('center')
    const boxes = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"][disabled]')]
    expect(boxes.map((b) => b.checked)).toEqual([true, false])
    expect(el.querySelector('a')?.getAttribute('title')).toBe('title')
  })

  it('code 의 language- class 말고는 class 를 지운다', () => {
    const el = render('<code class="language-js">a</code> <code class="language-js x">b</code>')
    expect([...el.querySelectorAll('code')].map((c) => c.getAttribute('class'))).toEqual([
      'language-js',
      null
    ])
  })

  it('HTML 주석은 보이지 않는다', () => {
    const el = render('before <!-- inline --> after', '<!--\nblock\n-->', 'end')
    expect(el.textContent).not.toMatch(/inline|block|<!--/)
    expect(el.innerHTML).not.toContain('<!--')
    expect(el.textContent).toContain('before')
    expect(el.textContent).toContain('end')
  })

  it('스크립트·이벤트 처리기를 실행할 수 없게 둔다', () => {
    const el = render(
      '<img src="x" onerror="window.pwned = 1">',
      '<script>window.pwned = 2</script>',
      'after'
    )
    expect(el.querySelectorAll('script, img, [onerror]')).toHaveLength(0)
    expect(el.textContent).not.toContain('pwned')
    expect(el.textContent).toContain('after')
  })

  it('이미지는 띄우지 않고 대체 텍스트만 남긴다', () => {
    const el = render('![원격 그림](https://example.com/a.png) ![상대 그림](./a.png)')
    expect(el.querySelectorAll('img')).toHaveLength(0)
    expect(el.textContent).toContain('원격 그림 상대 그림')
  })
})

describe('prepareMarkdown 의 heading', () => {
  it.each([
    '# Tom &amp; *J &lt;3&gt;* [&copy;](https://x) &#38; `&amp;` \\&amp;',
    '# <em>e</em> &amp; *<b>굵게</b>*',
    '# T <kbd>⌘ &amp;</kbd> &amp;',
    '# [<a href="https://x">in</a>](https://y)',
    '# a <!-- c --> b'
  ])('본문 heading 과 같은 글자다: %s', (src) => {
    expect(prepareMarkdown(src).heading).toBe(render(src).querySelector('h1')?.textContent)
  })
})

describe('prepareMarkdown 의 묶음', () => {
  const blocks = [
    '# Title',
    'para with [ref] and [other][o]',
    '```ts\nconst a = 1\n\nconst b = 2\n```',
    '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |',
    '> quote\n>\n> more',
    '- one\n- two\n\n  inner',
    '[ref]: https://example.com/r "R"',
    '[o]: https://example.com/o'
  ]
  const doc = Array.from({ length: 5 }, () => blocks.join('\n\n')).join('\n\n')

  function appended(parts: Part[]): string {
    const el = document.createElement('div')
    for (const p of parts) el.insertAdjacentHTML('beforeend', renderPart(p))
    return el.innerHTML
  }

  it('최상위 블록 경계에서 나눠, 코드 블록·표·인용·목록이 묶음 사이에서 잘리지 않는다', () => {
    const { parts } = prepareMarkdown(doc, 40)
    expect(parts.length).toBeGreaterThan(10)
    for (const p of parts) {
      if (!('tokens' in p)) throw new Error('lexing 하지 못했다')
      const raw = p.tokens.map((t) => t.raw).join('')
      expect((raw.match(/```/g) ?? []).length % 2).toBe(0)
      for (const t of p.tokens) expect(doc).toContain(t.raw)
    }
    expect(parts.flatMap((p) => ('tokens' in p ? p.tokens.map((t) => t.raw) : [])).join('')).toBe(
      doc
    )
  })

  it('묶음을 차례로 붙인 DOM 은 한 번에 렌더한 DOM 과 같다', () => {
    expect(appended(prepareMarkdown(doc, 40).parts)).toBe(
      appended(prepareMarkdown(doc, Infinity).parts)
    )
    expect(prepareMarkdown(doc, Infinity).parts).toHaveLength(1)
  })

  it.each([
    ['접기', '<details>\n<summary>log</summary>', 'a', 'b', 'c', '</details>', 'after'],
    [
      '빈 줄이 든 HTML 표',
      '<table>\n<tr><td>1</td></tr>',
      '<tr><td>2</td></tr>',
      '</table>',
      'after'
    ],
    ['겹친 접기', '<details>', '<details>', 'a', '</details>', 'b', '</details>', 'after'],
    ['문단 안에서 연 접기', 'x <details>', 'a', 'b', '</details>', 'after'],
    ['문단 안에서 닫는 접기', '<details>', 'a', 'b </details>', 'after'],
    [
      '굵게·링크 안에서 연 접기',
      '**x <details>**',
      'a',
      '[<details>y](u)',
      'b',
      '</details>',
      'after'
    ],
    ['문단·제목 안의 닫지 않은 태그', 'Vec<String> x', 'a', '# h <div>', 'b', '<span>s', 'c'],
    ['글자 꾸밈', 'x <b>bold', 'a', '> q', 'b</b>', 'after'],
    ['인용·목록 안의 글자 꾸밈', '> <i>q', 'a', '- <b>l', 'b', '</i></b>', 'after'],
    ['인용·목록 안의 접기', '> <details>q', 'a', '- <details>l', 'b', 'after'],
    ['주석·빈 태그', '<!-- <details> -->', '<br>', '<hr>', '<p>x', 'a', 'b']
  ])('HTML 태그가 묶음을 넘어도 DOM 은 한 번에 렌더한 것과 같다: %s', (_, ...blocks) => {
    const doc = [...blocks, ...blocks].join('\n\n')
    const whole = appended(prepareMarkdown(doc, Infinity).parts)
    for (let size = 1; size <= doc.length; size++) {
      expect(appended(prepareMarkdown(doc, size).parts), `size ${size}`).toBe(whole)
    }
  })

  it('연 HTML 태그가 닫히면 다시 묶음을 나눈다', () => {
    const doc = ['<details>', 'a', 'b', '</details>', 'c', 'd'].join('\n\n')
    const raws = prepareMarkdown(doc, 1).parts.map((p) =>
      'tokens' in p ? p.tokens.map((t) => t.raw).join('') : ''
    )
    expect(raws).toEqual(['<details>\n\na\n\nb\n\n</details>', '\n\n', 'c', '\n\n', 'd'])
  })

  it('다음 블록으로 이어지지 않는 태그는 묶음 나누기를 막지 않는다', () => {
    const blocks = [
      ...['> <details>q', '- <div>l', '<!-- <details> -->', '<br>', '<p>x'],
      ...['returns Vec<String> here', 'Option<T>', '<span>x', '**<span>y**', '# h <div>', 'a']
    ]
    expect(prepareMarkdown(blocks.join('\n\n'), 1).parts).toHaveLength(blocks.length * 2 - 1)
  })

  it('참조형 링크는 정의가 다른 묶음에 있어도 주소로 풀린다', () => {
    const { parts } = prepareMarkdown(
      '[ref] and [x][o]\n\n' + 'filler\n\n'.repeat(20) + '[ref]: https://r\n[o]: https://o',
      20
    )
    expect(parts.length).toBeGreaterThan(2)
    const el = document.createElement('div')
    el.innerHTML = renderPart(parts[0])
    expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://r',
      'https://o'
    ])
  })

  it('빈 문서도 묶음 하나다', () => {
    expect(prepareMarkdown('').parts).toHaveLength(1)
    expect(html(prepareMarkdown('').parts)).toBe('')
  })

  it('lexer 가 던지면 heading 없이 원문을 줄 경계에서 나눈 글자로 보인다', () => {
    // 8 MB 넘는 긴 문단에서 marked 의 lheading 정규식이 호출 스택을 넘기는 것을 흉내 낸다.
    const lexer = vi.spyOn(Marked.prototype, 'lexer').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded')
    })
    try {
      const text = '# big\n<b>a & b</b>\n' + 'line\n'.repeat(30)
      const { heading, parts } = prepareMarkdown(text, 20)
      expect(heading).toBeUndefined()
      expect(parts.length).toBeGreaterThan(3)
      for (const p of parts) {
        if (!('text' in p)) throw new Error('글자 묶음이 아니다')
        expect(p.text.endsWith('\n')).toBe(true)
      }
      const el = document.createElement('div')
      el.innerHTML = html(parts)
      expect(el.querySelectorAll('b, h1')).toHaveLength(0)
      expect(el.textContent).toBe(text)
    } finally {
      lexer.mockRestore()
    }
  })
})

describe('각주', () => {
  // 묶음을 따로 렌더해 붙인 본문
  function body(text: string, size?: number): HTMLElement {
    const el = document.createElement('div')
    for (const p of prepareMarkdown(text, size).parts)
      el.insertAdjacentHTML('beforeend', renderPart(p))
    return el
  }
  const refs = (el: HTMLElement): string[] =>
    [...el.querySelectorAll('sup > a')].map((a) => a.textContent!)
  const notes = (el: HTMLElement): string[] =>
    [...el.querySelectorAll('ol.footnotes > li')].map((li) => li.textContent!.trim())
  // 문서마다 다른 id 머리를 지운 HTML
  const plain = (el: HTMLElement): string => el.innerHTML.replace(/md\d+-fn/g, 'fn')

  it('참조는 위첨자 번호 링크, 정의는 문서 끝 구분선 아래 번호 목록이고 ↩ 로 참조에 돌아간다', () => {
    const el = body('# T\n\nA[^1] b.\n\n[^1]: Note.\n\nafter')
    const ref = el.querySelector('p > sup > a')!
    expect(ref.textContent).toBe('1')
    const list = el.lastElementChild!
    expect(list.matches('ol.footnotes')).toBe(true)
    expect(list.previousElementSibling!.tagName).toBe('HR')
    expect(
      el.querySelector('ol.footnotes')!.previousElementSibling!.previousElementSibling!.textContent
    ).toBe('after')
    const item = list.querySelector('li')!
    expect(ref.getAttribute('href')).toBe(`#${item.id}`)
    const back = item.querySelector('p > a')!
    expect(back.textContent).toBe('↩\uFE0E')
    expect(back.getAttribute('title')).toBe('본문으로 돌아가기')
    expect(back.getAttribute('href')).toBe(`#${ref.id}`)
    expect(item.querySelector('p')!.textContent).toBe('Note. ↩\uFE0E')
  })

  it('번호는 첫 참조 순서이고, 이름 라벨도 번호로 보이며, 라벨은 대소문자를 가리지 않는다', () => {
    const el = body('x[^b] y[^Note] z[^a] w[^B]\n\n[^a]: A\n[^note]: N\n[^b]: B')
    expect(refs(el)).toEqual(['1', '2', '3', '1'])
    expect(notes(el).map((n) => n[0])).toEqual(['B', 'N', 'A'])
  })

  it('정의 없는 참조는 글자 그대로, 참조 없는 정의는 그리지 않는다', () => {
    const el = body('x[^1] y[^none]\n\n[^1]: one\n\n[^unused]: gone')
    expect(el.querySelector('p')!.textContent).toBe('x1 y[^none]')
    expect(notes(el)).toEqual(['one ↩\uFE0E'])
    expect(el.textContent).not.toContain('gone')
  })

  it('참조가 하나도 없으면 목록도 구분선도 없다', () => {
    const el = body('text\n\n[^1]: lonely')
    expect(el.innerHTML).toBe('<p>text</p>\n')
  })

  it('같은 각주를 두 번 참조하면 ↩ 를 참조마다 달고 둘째부터 번호를 붙인다', () => {
    const el = body('a[^1] b[^1]\n\n[^1]: N')
    const [first, second] = el.querySelectorAll<HTMLAnchorElement>('sup > a')
    expect(first!.id).not.toBe(second!.id)
    const back = [...el.querySelectorAll('li a')]
    expect(back.map((a) => a.innerHTML)).toEqual(['↩\uFE0E', '↩\uFE0E<sup>2</sup>'])
    expect(back.map((a) => a.getAttribute('href'))).toEqual([`#${first!.id}`, `#${second!.id}`])
  })

  it('정의는 4칸 들여 쓴 줄로 여러 문단·코드 블록을 담는다', () => {
    const el = body('a[^1]\n\n[^1]: first\n    lazy\n\n    second\n\n        code\n\nback to body')
    const item = el.querySelector('ol.footnotes > li')!
    expect([...item.children].map((c) => c.tagName)).toEqual(['P', 'P', 'PRE', 'P'])
    expect(item.querySelector('pre')!.textContent).toBe('code\n')
    expect(item.lastElementChild!.textContent).toBe('↩\uFE0E')
    expect([...el.children].map((c) => c.tagName)).toEqual(['P', 'P', 'HR', 'OL'])
    expect(el.children[1]!.textContent).toBe('back to body')
  })

  it('정의는 빈 줄 없이 앞 문단을 끊고, 빈 줄 없이 이어진 정의도 따로 읽는다', () => {
    const el = body('a[^1] b[^2]\n[^1]: one\n[^2]: two')
    expect(el.querySelector('p')!.textContent).toBe('a1 b2')
    expect(notes(el)).toEqual(['one ↩\uFE0E', 'two ↩\uFE0E'])
  })

  it('라벨에 공백이 든 것, 주소가 붙은 것, 코드 안의 것은 각주가 아니다', () => {
    const el = body('[^a b] [^1](https://x) `[^1]`\n\n[^1]: one')
    expect(el.querySelector('sup')).toBeNull()
    expect(el.querySelector('p a')!.getAttribute('href')).toBe('https://x')
    expect(el.querySelector('p')!.textContent).toBe('[^a b] ^1 [^1]')
  })

  it('정의 안의 참조도 그 정의 자리 순서로 센다', () => {
    const el = body('a[^x]\n\n[^x]: see[^y]\n\n[^y]: Y')
    expect(refs(el)).toEqual(['1', '2'])
    expect(notes(el)).toEqual(['see2 ↩\uFE0E', 'Y ↩\uFE0E'])
  })

  it('heading 의 참조는 제목 글자에 넣지 않는다', () => {
    expect(prepareMarkdown('# T[^1] [^none]\n\n[^1]: n').heading).toBe('T [^none]')
  })

  it('참조와 정의가 다른 묶음에 있어도 번호가 맞고, 정의는 마지막 묶음에 들어간다', () => {
    const text = 'a[^p]\n\n[^p]: P\n\n' + 'filler\n\n'.repeat(20) + 'b[^q] c[^p]\n\n[^q]: Q'
    const { parts } = prepareMarkdown(text, 20)
    expect(parts.length).toBeGreaterThan(2)
    const html = parts.map(renderPart)
    expect(html.findIndex((h) => h.includes('<ol class="footnotes">'))).toBe(html.length - 1)
    const el = body(text, 20)
    expect(refs(el)).toEqual(['1', '2', '1'])
    expect(notes(el)).toEqual(['P ↩\uFE0E ↩\uFE0E2', 'Q ↩\uFE0E'])
  })

  it('sanitize 뒤에도 각주 링크마다 같은 본문에 가리키는 id 가 하나 있다', () => {
    const el = body('a[^1] b[^n] c[^1]\n\n[^1]: one\n\n[^n]: two\n\n    more')
    const links = [...el.querySelectorAll('a')]
    expect(links).toHaveLength(6)
    for (const a of links)
      expect(el.querySelectorAll(`[id="${a.getAttribute('href')!.slice(1)}"]`)).toHaveLength(1)
  })

  it('사용자 HTML 의 id 는 각주 id 모양이 아니면 지운다', () => {
    const el = body('<p id="app">x</p><a id="md1-fnref-1x">y</a>')
    expect(el.querySelectorAll('[id]')).toHaveLength(0)
  })

  it('문서마다 id 머리가 달라 같은 창에 붙어도 id 가 겹치지 않는다', () => {
    const a = body('x[^1]\n\n[^1]: n')
    const b = body('x[^1]\n\n[^1]: n')
    const ids = [...a.querySelectorAll('[id]'), ...b.querySelectorAll('[id]')].map((e) => e.id)
    expect(new Set(ids).size).toBe(4)
    expect(plain(a)).toBe(plain(b))
  })

  it('두 문서를 lexing 만 먼저 한 뒤 렌더해도 두 문서 모두 번호가 1 부터다', () => {
    const one = prepareMarkdown('a[^x] b[^y]\n\n[^x]: X\n\n[^y]: Y')
    const two = prepareMarkdown('c[^z]\n\n[^z]: Z')
    const el = document.createElement('div')
    el.innerHTML = two.parts.map(renderPart).join('')
    expect(refs(el)).toEqual(['1'])
    el.innerHTML = one.parts.map(renderPart).join('')
    expect(refs(el)).toEqual(['1', '2'])
  })

  it('묶음 크기와 상관없이, 묶음을 따로 렌더해 붙인 본문은 한 번에 렌더한 것과 같다', () => {
    const block = fc.constantFrom(
      'p[^1] q[^Two]',
      'r[^3][^1]',
      '[^1]: one[^3]',
      '[^two]: two\n    more\n\n        code',
      '[^3]: three\n[^4]: unused',
      '> quote[^4]',
      '- item[^two]',
      '[^none] text',
      '# h[^1]'
    )
    fc.assert(
      fc.property(
        fc.array(block, { maxLength: 12 }),
        fc.integer({ min: 1, max: 60 }),
        (bs, size) => {
          const text = bs.join('\n\n')
          expect(plain(body(text, size))).toBe(plain(body(text, Infinity)))
        }
      )
    )
  })
})

describe('MarkdownBody', () => {
  it('묶음마다 한 번만 렌더하고 같은 HTML 을 돌려준다', () => {
    const parser = vi.spyOn(Marked.prototype, 'parser')
    try {
      const body = new MarkdownBody(prepareMarkdown('# a\n\nb\n\nc', 3).parts)
      expect(body.length).toBe(3)
      const first = [0, 1, 2].map((i) => body.html(i))
      const again = [0, 1, 2].map((i) => body.html(i))
      expect(again).toEqual(first)
      expect(parser).toHaveBeenCalledTimes(3)
    } finally {
      parser.mockRestore()
    }
  })
})
