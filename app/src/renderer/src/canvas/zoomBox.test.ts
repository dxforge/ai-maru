// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WHEEL_SPAN } from './zoom'
import { anchorScroll, zoomImage } from './zoomBox'

afterEach(() => document.body.replaceChildren())

// jsdom 은 레이아웃이 없으므로, 맞춤에서 그려진 너비와 블록 높이는 테스트가 정해 준다.
function image(natural: { width: number; height: number }, layout = { width: 430, height: 258 }) {
  const box = document.body.appendChild(document.createElement('div'))
  const view = box.appendChild(document.createElement('div'))
  const img = view.appendChild(document.createElement('img'))
  Object.defineProperties(img, {
    naturalWidth: { value: natural.width },
    naturalHeight: { value: natural.height }
  })
  img.getBoundingClientRect = () => {
    const width = img.style.width ? parseFloat(img.style.width) : layout.width
    return new DOMRect(0, 0, width, 0)
  }
  Object.defineProperty(view, 'clientHeight', { get: () => layout.height })
  zoomImage(img)
  const buttons = [...box.querySelectorAll<HTMLButtonElement>('.zoom-bar button')]
  const [out, reset, into] = buttons
  const state = () => [img.style.width, img.style.height, view.style.height, reset?.textContent]
  return { box, view, img, layout, out: out!, reset: reset!, into: into!, buttons, state }
}

describe('이미지 확대·축소', () => {
  it('카드 너비에 맞춘 크기에서 시작하고, 배율은 원본 픽셀에 대한 비율로 보인다', () => {
    const { img, buttons, state } = image({ width: 1000, height: 600 })
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Zoom out',
      'Reset zoom',
      'Zoom in'
    ])
    expect(state()).toEqual(['', '', '', '43%'])
    expect(img.style.maxWidth).toBe('')
  })

  it('맞춤에서 한 단계 확대·축소하면 맞춘 배율의 이웃 단계로 가고, 블록 높이는 맞춤일 때의 높이로 고정한다', () => {
    const { img, out, reset, into, state } = image({ width: 1000, height: 600 })
    into.click()
    expect(state()).toEqual(['500px', '300px', '258px', '50%'])
    expect(img.style.maxWidth).toBe('none')
    into.click()
    expect(state()).toEqual(['666.667px', '400px', '258px', '67%'])
    out.click()
    out.click()
    expect(state()).toEqual(['333.333px', '200px', '258px', '33%'])
    reset.click()
    reset.click()
    out.click()
    expect(state()).toEqual(['333.333px', '200px', '258px', '33%'])
  })

  it('배율 버튼은 100% 로 가고, 100% 에서 누르면 맞춤으로 돌아가 크기와 블록 높이를 CSS 에 맡긴다', () => {
    const { img, into, reset, state } = image({ width: 1000, height: 600 })
    reset.click()
    expect(state()).toEqual(['1000px', '600px', '258px', '100%'])
    reset.click()
    expect(state()).toEqual(['', '', '', '43%'])
    expect(img.style.maxWidth).toBe('')
    into.click()
    reset.click()
    expect(state()).toEqual(['1000px', '600px', '258px', '100%'])
  })

  it('맞춤으로 돌아간 뒤 다시 확대하면 그때의 블록 높이로 고정한다', () => {
    const { layout, into, reset, view } = image({ width: 1000, height: 600 })
    into.click()
    reset.click()
    reset.click()
    layout.height = 180
    into.click()
    expect(view.style.height).toBe('180px')
  })

  it('맞춤에서 ⌘+휠은 맞춘 배율에서 deltaY 만큼 확대한다', () => {
    const { img, state } = image({ width: 1000, height: 600 })
    const e = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      deltaY: -WHEEL_SPAN * Math.log(2)
    })
    img.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(state()).toEqual(['860px', '516px', '258px', '86%'])
  })

  it('맞춤에서 카드 너비가 바뀌면 포인터가 들어올 때 배율 표시를 다시 쓴다', () => {
    const { box, layout, state } = image({ width: 1000, height: 600 })
    layout.width = 600
    box.dispatchEvent(new Event('pointerenter'))
    expect(state()[3]).toBe('60%')
  })

  it('카드보다 작은 이미지는 맞춤이 100% 라, 맞춤에서 배율 버튼을 눌러도 그대로다', () => {
    const { into, reset, state } = image({ width: 200, height: 100 }, { width: 200, height: 100 })
    expect(state()[3]).toBe('100%')
    reset.click()
    expect(state()).toEqual(['', '', '', '100%'])
    into.click()
    expect(state()).toEqual(['220px', '110px', '100px', '110%'])
    reset.click()
    expect(state()).toEqual(['200px', '100px', '100px', '100%'])
    reset.click()
    expect(state()).toEqual(['', '', '', '100%'])
  })

  it('크기가 0 인 그림에는 버튼을 두지 않는다', () => {
    const { buttons, img } = image({ width: 0, height: 0 })
    expect(buttons).toEqual([])
    expect(img.getAttribute('style')).toBeNull()
  })

  it('끄는 동안에만 이미지를 끌어 놓기로 집어 들지 않는다', () => {
    const { view, img } = image({ width: 1000, height: 600 })
    const dragstart = () => {
      const e = new Event('dragstart', { bubbles: true, cancelable: true })
      img.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(dragstart()).toBe(false)
    Object.defineProperties(view, {
      scrollWidth: { value: 400 },
      clientWidth: { value: 200 },
      scrollHeight: { value: 100 }
    })
    view.setPointerCapture = vi.fn()
    img.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(dragstart()).toBe(true)
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(dragstart()).toBe(false)
  })
})

describe('anchorScroll', () => {
  it('배율을 바꾼 뒤에도 at 에 있던 그림의 점이 at 에 오도록 옮길 양을 낸다', () => {
    // 그림이 (100, 50) 에 있고 (150, 70) 을 기준으로 두 배 했더니, 레이아웃이 그림을 (90, 40) 으로 옮겼다.
    const by = anchorScroll({ left: 100, top: 50 }, { left: 90, top: 40 }, { x: 150, y: 70 }, 2)
    // 그 점은 그림 안 (50, 20) 이었고 두 배 뒤에는 (100, 40), 화면으로 (190, 80) 이다.
    expect(by).toEqual({ x: 40, y: 10 })
    expect(anchorScroll({ left: 0, top: 0 }, { left: 0, top: 0 }, { x: 30, y: 30 }, 1)).toEqual({
      x: 0,
      y: 0
    })
  })
})
