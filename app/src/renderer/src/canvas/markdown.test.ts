// @vitest-environment jsdom
// DOMPurify 는 DOM 이 없으면 입력을 거르지 않고 그대로 돌려주므로, 이 파일만 DOM 환경에서 돌린다.
import { describe, expect, it } from 'vitest'
import { firstHeading, renderMarkdown } from './markdown'

function render(...blocks: string[]): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = renderMarkdown(blocks.join('\n\n'))
  return el
}

describe('renderMarkdown', () => {
  it('markdown 을 HTML 로 그린다', () => {
    const el = render('# Title', 'some **bold** text')
    expect(el.querySelector('h1')?.textContent).toBe('Title')
    expect(el.querySelector('strong')?.textContent).toBe('bold')
  })

  it('블록 HTML 은 요소로 만들지 않고 글자 그대로 보인다', () => {
    const block =
      '<div class="palette-backdrop">\n<style>.xterm { visibility: hidden }</style>\n</div>'
    const el = render('before', block, '<dialog open>dialog-body</dialog>', 'after')
    expect(el.querySelectorAll('div, style, dialog')).toHaveLength(0)
    expect(el.textContent).toContain('<div class="palette-backdrop">')
    expect(el.textContent).toContain('<dialog open>dialog-body</dialog>')
    expect(el.textContent).toContain('after')
  })

  it('인라인 HTML 은 요소로 만들지 않고 글자 그대로 보인다', () => {
    const el = render(
      'a <form><input name="q"><button popovertarget="p">go</button></form> b',
      'c <span style="position: fixed; inset: 0">overlay</span> d'
    )
    expect(el.querySelectorAll('form, input, button, span')).toHaveLength(0)
    expect(el.querySelector('p')?.textContent).toBe(
      'a <form><input name="q"><button popovertarget="p">go</button></form> b'
    )
    expect(el.textContent).toContain('<span style="position: fixed; inset: 0">overlay</span>')
  })

  it('kbd·code·pre·script 태그 뒤의 글자와 태그도 글자 그대로 보인다', () => {
    const el = render(
      'x <kbd><div/class="palette-backdrop"><input/placeholder="fake">',
      'x <code><dialog/open>over',
      'x <pre><img/src="x">',
      'x <script><div/style="position:fixed;inset:0">cover',
      '| a |\n| - |\n| <kbd><dialog/open>d |',
      '# T <kbd><b/x>bold',
      '[<code><input/x>](https://x)'
    )
    expect(
      el.querySelectorAll('div, input, dialog, img, b, kbd, code, pre, script, [style]')
    ).toHaveLength(0)
    expect(el.textContent).toContain(
      'x <kbd><div/class="palette-backdrop"><input/placeholder="fake">'
    )
    expect(el.querySelector('td')?.textContent).toBe('<kbd><dialog/open>d')
    expect(el.querySelector('a')?.textContent).toBe('<code><input/x>')
  })

  it('a 태그 뒤의 주소도 보통 글자처럼 링크가 된다', () => {
    const el = render('<a href="x"> https://example.com')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })

  it('HTML 블록과 태그 안의 문자 참조는 풀지 않고 적힌 그대로 보인다', () => {
    const el = render('<p>&amp; &lt;</p>', 'x <a title="&copy;">&copy;</a>')
    expect(el.textContent).toContain('<p>&amp; &lt;</p>')
    expect(el.textContent).toContain('<a title="&copy;">©</a>')
  })

  it('스크립트·이벤트 처리기·javascript 링크를 실행할 수 없게 둔다', () => {
    const el = render(
      '<img src="x" onerror="window.pwned = 1">',
      '<script>window.pwned = 2</script>',
      '[link](javascript:alert(1))',
      'after'
    )
    expect(el.querySelectorAll('script, img, [onerror]')).toHaveLength(0)
    expect(el.querySelector('a')?.getAttribute('href')).toBeNull()
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
    '# T <kbd><b/x>bold &amp;',
    '# [<a href="https://x">in</a>](https://y)'
  ])('본문 heading 과 같은 글자다: %s', (src) => {
    expect(firstHeading(src)).toBe(render(src).querySelector('h1')?.textContent)
  })
})
