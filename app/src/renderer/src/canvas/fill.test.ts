// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fillBody, fullHtml } from './fill'

const body = (n: number) => ({ length: n, html: vi.fn((i: number) => `<p>${i}</p>`) })
const parts = (el: HTMLElement) => [...el.children].slice(1).map((p) => [p.className, p.innerHTML])

// jsdom 에는 ResizeObserver 가 없다.
class FakeResizeObserver {
  static last: FakeResizeObserver | undefined
  targets: Element[] = []
  constructor(readonly callback: (entries: { contentRect: { height: number } }[]) => void) {
    FakeResizeObserver.last = this
  }
  observe(el: Element): void {
    this.targets.push(el)
  }
  disconnect(): void {
    this.targets = []
  }
  resize(height: number): void {
    this.callback([{ contentRect: { height } }])
  }
}
beforeEach(() => {
  FakeResizeObserver.last = undefined
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function withFirst(): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = '<div><p>0</p></div>'
  return el
}

describe('fillBody', () => {
  it('첫 묶음 뒤의 묶음을 task 마다 하나씩 `.part` 로 감싸 차례로 붙인다', async () => {
    const el = withFirst()
    const b = body(4)
    fillBody(el, b)
    expect(el.childElementCount).toBe(1)
    await vi.waitFor(() => expect(el.childElementCount).toBe(4))
    expect(el.firstElementChild!.outerHTML).toBe('<div><p>0</p></div>')
    expect(parts(el)).toEqual([1, 2, 3].map((i) => ['part', `<p>${i}</p>`]))
    expect(b.html.mock.calls.map(([i]) => i)).toEqual([0, 1, 2, 3])
  })

  it('첫 묶음의 높이가 바뀔 때마다 글자당 높이를 본문 요소의 CSS 변수로 단다', () => {
    const el = withFirst()
    fillBody(el, { length: 2, html: () => '<p>0</p>' })
    const resize = FakeResizeObserver.last!
    expect(resize.targets).toEqual([el.firstElementChild])
    // 첫 묶음의 HTML `<p>0</p>` 는 8글자다.
    resize.resize(80)
    expect(el.style.getPropertyValue('--char-height')).toBe('10px')
    resize.resize(40)
    expect(el.style.getPropertyValue('--char-height')).toBe('5px')
    // 보이지 않아 높이가 0 이면 앞서 잰 값을 둔다.
    resize.resize(0)
    expect(el.style.getPropertyValue('--char-height')).toBe('5px')
  })

  it('붙인 묶음은 화면 밖이면 그리지 않고, 그 높이를 글자당 높이에 그 묶음의 글자 수를 곱해 어림한다', async () => {
    const el = withFirst()
    const b = { length: 3, html: (i: number) => `<p>${'x'.repeat(i * 4)}</p>` }
    fillBody(el, b)
    await vi.waitFor(() => expect(el.childElementCount).toBe(3))
    const style = [...el.querySelectorAll<HTMLElement>('.part')].map((p) => [
      p.style.getPropertyValue('content-visibility'),
      p.style.containIntrinsicSize
    ])
    expect(style).toEqual([
      ['auto', 'auto calc(var(--char-height) * 11)'],
      ['auto', 'auto calc(var(--char-height) * 15)']
    ])
  })

  it('멈추면 그 뒤의 묶음은 렌더하지도 붙이지도 않고, 첫 묶음도 더 지켜보지 않는다', async () => {
    const el = withFirst()
    const b = body(4)
    // 붙일 첫 묶음을 렌더하는 자리에서 멈춰, 묶음 사이의 task 경계와 상관없이 멈춘 뒤를 본다.
    b.html.mockImplementation((i) => {
      if (i === 1) stop()
      return `<p>${i}</p>`
    })
    const stop = fillBody(el, b)
    const resize = FakeResizeObserver.last!
    const other = withFirst()
    fillBody(other, body(3))
    await vi.waitFor(() => expect(other.childElementCount).toBe(3))
    expect(parts(el)).toEqual([['part', '<p>1</p>']])
    expect(b.html.mock.calls.map(([i]) => i)).toEqual([0, 1])
    expect(resize.targets).toEqual([])
  })

  it('첫 묶음의 HTML 이 비면 어림할 기준이 없으므로 화면 밖 묶음도 그리고 첫 묶음을 지켜보지 않는다', async () => {
    const el = withFirst()
    fillBody(el, { length: 3, html: (i: number) => (i ? `<p>${i}</p>` : '') })
    expect(FakeResizeObserver.last!.targets).toEqual([])
    await vi.waitFor(() => expect(el.childElementCount).toBe(3))
    expect(parts(el)).toEqual([
      ['part', '<p>1</p>'],
      ['part', '<p>2</p>']
    ])
    expect([...el.querySelectorAll<HTMLElement>('.part')].map((p) => p.style.cssText)).toEqual([
      '',
      ''
    ])
  })

  it('묶음을 붙일 때마다 붙인 HTML 로 알린다. 알릴 때는 그 묶음이 이미 들어 있다', async () => {
    const el = withFirst()
    const added: [string, number][] = []
    fillBody(el, body(3), (html) => added.push([html, el.childElementCount]))
    await vi.waitFor(() => expect(added).toHaveLength(2))
    expect(added).toEqual([
      ['<p>1</p>', 2],
      ['<p>2</p>', 3]
    ])
  })

  it('묶음이 하나뿐이면 붙이지 않고 첫 묶음도 지켜보지 않는다', async () => {
    const el = withFirst()
    const b = body(1)
    fillBody(el, b)
    expect(FakeResizeObserver.last!.targets).toEqual([])
    const other = withFirst()
    fillBody(other, body(2))
    await vi.waitFor(() => expect(other.childElementCount).toBe(2))
    expect(el.childElementCount).toBe(1)
    expect(b.html).not.toHaveBeenCalled()
  })
})

describe('fullHtml', () => {
  it('묶음을 차례로 모두 잇고, 첫 묶음 뒤로는 묶음마다 다른 task 에 메인 스레드를 내준다', async () => {
    const b = body(3)
    const html = fullHtml(b)
    expect(b.html).toHaveBeenCalledTimes(1)
    expect(await html).toBe('<p>0</p><p>1</p><p>2</p>')
    expect(b.html).toHaveBeenCalledTimes(3)
  })
})
