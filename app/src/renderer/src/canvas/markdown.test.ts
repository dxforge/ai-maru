// @vitest-environment jsdom
// DOMPurify 는 DOM 이 없으면 입력을 거르지 않고 그대로 돌려주므로, 이 파일만 DOM 환경에서 돌린다.
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

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

  it('스크립트와 이벤트 처리기를 지운다', () => {
    const el = render(
      'before',
      '<img src="x" onerror="window.pwned = 1">',
      '<script>window.pwned = 2</script>',
      '<a href="javascript:alert(1)" onclick="alert(2)">link</a>',
      'after'
    )
    expect(el.querySelectorAll('script, [onerror], [onclick]')).toHaveLength(0)
    expect(el.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(el.textContent).toContain('after')
  })

  it('이미지는 띄우지 않고 대체 텍스트만 남긴다', () => {
    const el = render(
      '<img src="https://example.com/raw.png">',
      '![원격 그림](https://example.com/a.png) ![상대 그림](./a.png)'
    )
    expect(el.querySelectorAll('img')).toHaveLength(0)
    expect(el.textContent).toContain('원격 그림 상대 그림')
  })

  it('style 요소와 style 속성을 지운다', () => {
    const el = render(
      '<style>.xterm { visibility: hidden }</style>',
      '<div style="position: fixed; inset: 0">overlay</div>'
    )
    expect(el.querySelectorAll('style, [style]')).toHaveLength(0)
    expect(el.textContent).toContain('overlay')
  })

  it('dialog 와 popover 를 지우고 글자는 남긴다', () => {
    const el = render(
      '<dialog open>dialog-body</dialog>',
      '<button popovertarget="p">show</button><div id="p" popover>popover-body</div>'
    )
    expect(el.querySelectorAll('dialog, [popover], [popovertarget]')).toHaveLength(0)
    expect(el.textContent).toContain('dialog-body')
    expect(el.textContent).toContain('popover-body')
  })
})
