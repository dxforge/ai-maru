// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fillBody } from './fill'

const body = (n: number) => ({ length: n, html: vi.fn((i: number) => `<p>${i}</p>`) })

describe('fillBody', () => {
  it('첫 묶음 뒤의 묶음을 task 마다 하나씩 차례로 붙인다', async () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>0</p>'
    const b = body(4)
    fillBody(el, b)
    expect(el.innerHTML).toBe('<p>0</p>')
    await vi.waitFor(() => expect(el.innerHTML).toBe('<p>0</p><p>1</p><p>2</p><p>3</p>'))
    expect(b.html.mock.calls.map(([i]) => i)).toEqual([1, 2, 3])
  })

  it('멈추면 그 뒤의 묶음은 렌더하지도 붙이지도 않는다', async () => {
    const el = document.createElement('div')
    const b = body(4)
    // 첫 묶음을 렌더하는 자리에서 멈춰, 묶음 사이의 task 경계와 상관없이 멈춘 뒤를 본다.
    b.html.mockImplementationOnce((i) => {
      stop()
      return `<p>${i}</p>`
    })
    const stop = fillBody(el, b)
    const other = document.createElement('div')
    fillBody(other, body(3))
    await vi.waitFor(() => expect(other.childElementCount).toBe(2))
    expect(el.innerHTML).toBe('<p>1</p>')
    expect(b.html).toHaveBeenCalledTimes(1)
  })

  it('묶음이 하나뿐이면 붙이지 않는다', async () => {
    const el = document.createElement('div')
    const b = body(1)
    fillBody(el, b)
    const other = document.createElement('div')
    fillBody(other, body(2))
    await vi.waitFor(() => expect(other.childElementCount).toBe(1))
    expect(el.childElementCount).toBe(0)
    expect(b.html).not.toHaveBeenCalled()
  })
})
