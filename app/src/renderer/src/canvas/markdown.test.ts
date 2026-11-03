// @vitest-environment jsdom
// DOMPurify 는 DOM 이 없으면 입력을 거르지 않고 그대로 돌려주므로, 이 파일만 DOM 환경에서 돌린다.
import { describe, expect, it } from 'vitest'
import { firstHeading, renderMarkdown } from './markdown'

function render(...blocks: string[]): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = renderMarkdown(blocks.join('\n\n'))
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

describe('renderMarkdown', () => {
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

describe('firstHeading', () => {
  it.each([
    '# Tom &amp; *J &lt;3&gt;* [&copy;](https://x) &#38; `&amp;` \\&amp;',
    '# <em>e</em> &amp; *<b>굵게</b>*',
    '# T <kbd>⌘ &amp;</kbd> &amp;',
    '# [<a href="https://x">in</a>](https://y)',
    '# a <!-- c --> b'
  ])('본문 heading 과 같은 글자다: %s', (src) => {
    expect(firstHeading(src)).toBe(render(src).querySelector('h1')?.textContent)
  })
})
