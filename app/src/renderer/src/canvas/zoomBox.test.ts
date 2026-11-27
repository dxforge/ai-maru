// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyPng, imagePng } from './copyImage'
import { WHEEL_SPAN } from './zoom'
import { anchorScroll, zoomImage } from './zoomBox'

// jsdom 의 canvas 는 그리지 못하므로 PNG 를 만드는 함수는 mock 한다. 만든 PNG 는 e2e(`e2e/canvas.spec.ts`)가 잰다.
vi.mock('./copyImage', () => ({ imagePng: vi.fn(), copyPng: vi.fn() }))

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// jsdom 은 레이아웃이 없으므로, 맞춤에서 그려진 너비와 블록의 너비·높이는 테스트가 정해 준다.
function image(
  natural: { width: number; height: number },
  layout = { width: 430, height: 258 },
  parent: HTMLElement = document.body
) {
  const box = parent.appendChild(document.createElement('div'))
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
  Object.defineProperty(view, 'clientWidth', { get: () => layout.width, configurable: true })
  zoomImage(img)
  const buttons = [...box.querySelectorAll<HTMLButtonElement>('.zoom-bar button')]
  const [out, reset, into, fit, copy] = buttons
  const state = () => [img.style.width, img.style.height, view.style.height, reset?.textContent]
  return {
    box,
    view,
    img,
    layout,
    out: out!,
    reset: reset!,
    into: into!,
    fit: fit!,
    copy: copy!,
    buttons,
    state
  }
}

function scroller(height: number): HTMLElement {
  const el = document.body.appendChild(document.createElement('div'))
  el.style.overflowY = 'auto'
  Object.defineProperty(el, 'clientHeight', { value: height })
  return el
}

describe('이미지 확대·축소', () => {
  it('카드 너비에 맞춘 크기에서 시작하고, 배율은 원본 픽셀에 대한 비율로 보인다', () => {
    const { img, buttons, state } = image({ width: 1000, height: 600 })
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Zoom out',
      'Reset zoom',
      'Zoom in',
      'Fit',
      'Copy image'
    ])
    expect(state()).toEqual(['', '', '', '43%'])
    expect(img.style.maxWidth).toBe('')
  })

  it('맞춤에서 한 단계 확대·축소하면 맞춘 배율의 이웃 단계로 가고, 블록 높이는 맞춤일 때의 높이로 고정한다', () => {
    const { img, out, into, state } = image({ width: 1000, height: 600 })
    into.click()
    expect(state()).toEqual(['500px', '300px', '258px', '50%'])
    expect(img.style.maxWidth).toBe('none')
    into.click()
    expect(state()).toEqual(['666.667px', '400px', '258px', '67%'])
    out.click()
    out.click()
    expect(state()).toEqual(['333.333px', '200px', '258px', '33%'])
  })

  it('배율 버튼은 맞춤에서도, 다른 배율에서도, 100% 에서도 100% 로 간다', () => {
    const { into, reset, state } = image({ width: 1000, height: 600 })
    reset.click()
    expect(state()).toEqual(['1000px', '600px', '258px', '100%'])
    reset.click()
    expect(state()).toEqual(['1000px', '600px', '258px', '100%'])
    into.click()
    reset.click()
    expect(state()).toEqual(['1000px', '600px', '258px', '100%'])
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

  it('카드보다 작은 이미지는 맞춤이 100% 라, 맞춤에서 배율 버튼을 눌러도 크기가 그대로다', () => {
    const { into, reset, state } = image({ width: 200, height: 100 }, { width: 200, height: 100 })
    expect(state()[3]).toBe('100%')
    reset.click()
    expect(state()).toEqual(['', '', '', '100%'])
    into.click()
    expect(state()).toEqual(['220px', '110px', '100px', '110%'])
    reset.click()
    expect(state()).toEqual(['200px', '100px', '100px', '100%'])
  })

  it('맞춘 배율이 가장 작은 단계보다 작으면, 축소는 맞춤에 머물고 확대는 가장 작은 단계로 간다', () => {
    const { img, out, into, state } = image({ width: 3440, height: 2064 })
    expect(state()).toEqual(['', '', '', '13%'])
    out.click()
    const e = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      deltaY: 100
    })
    img.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(state()).toEqual(['', '', '', '13%'])
    into.click()
    expect(state()).toEqual(['860px', '516px', '258px', '25%'])
  })

  it('맞춘 배율이 가장 큰 단계보다 크면, 확대는 맞춤에 머물고 축소는 가장 큰 단계로 간다', () => {
    const { out, into, state } = image({ width: 60, height: 150 }, { width: 430, height: 1075 })
    expect(state()).toEqual(['', '', '', '717%'])
    into.click()
    expect(state()).toEqual(['', '', '', '717%'])
    out.click()
    expect(state()).toEqual(['300px', '750px', '1075px', '500%'])
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
    Object.defineProperty(view, 'clientWidth', { value: 200 })
    view.setPointerCapture = vi.fn()
    img.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(dragstart()).toBe(true)
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(dragstart()).toBe(false)
  })
})

describe('fit', () => {
  it('스크롤 영역이 없으면 블록 너비에 맞추고, 블록 높이는 맞춘 그림의 높이다', () => {
    const { into, fit, state } = image({ width: 1000, height: 600 })
    into.click()
    fit.click()
    expect(state()).toEqual(['430px', '258px', '258px', '43%'])
  })

  it('작은 그림은 블록 너비까지 키우되 500% 를 넘지 않는다', () => {
    const small = image({ width: 200, height: 100 })
    small.fit.click()
    expect(small.state()).toEqual(['430px', '215px', '215px', '215%'])
    const tiny = image({ width: 60, height: 150 })
    tiny.fit.click()
    expect(tiny.state()).toEqual(['300px', '750px', '750px', '500%'])
  })

  it('세로로 긴 그림은 스크롤 영역에 보이는 높이에서 블록의 scroll-margin 위아래를 뺀 높이에 맞춘다', () => {
    const area = scroller(300)
    const { box, fit, state } = image({ width: 1000, height: 2000 }, undefined, area)
    box.style.scrollMargin = '20px 0 40px'
    fit.click()
    expect(state()).toEqual(['120px', '240px', '240px', '12%'])
  })

  it('맞춘 뒤 확대·축소해도 블록 높이는 맞춘 그림의 높이 그대로이고, 배율 버튼은 100% 로 간다', () => {
    const { into, out, reset, fit, state } = image({ width: 200, height: 100 })
    fit.click()
    into.click()
    expect(state()).toEqual(['500px', '250px', '215px', '250%'])
    out.click()
    out.click()
    expect(state()[2]).toBe('215px')
    reset.click()
    expect(state()).toEqual(['200px', '100px', '215px', '100%'])
  })

  it('맞춘 블록이 스크롤 영역에서 가려졌으면 scroll-margin 만큼 띄워 보이게 스크롤한다', () => {
    const area = scroller(300)
    const { box, fit } = image({ width: 1000, height: 2000 }, undefined, area)
    box.style.scrollMargin = '20px 0'
    area.getBoundingClientRect = () => new DOMRect(0, 100, 430, 300)
    const at = (top: number) => {
      box.getBoundingClientRect = () => new DOMRect(0, top, 430, 260)
      area.scrollTop = 1000
      fit.click()
      return area.scrollTop - 1000
    }
    expect(at(50)).toBe(-70)
    expect(at(200)).toBe(80)
    expect(at(120)).toBe(0)
  })
})

describe('복사', () => {
  it('누르면 원본 크기의 PNG 를 클립보드에 싣고, 1.5초 동안 ✓ 를 보인다', async () => {
    vi.useFakeTimers()
    const png = new Blob()
    vi.mocked(imagePng).mockResolvedValue(png)
    vi.mocked(copyPng).mockResolvedValue()
    const { img, copy } = image({ width: 1000, height: 600 })
    const face = copy.innerHTML
    copy.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(imagePng).toHaveBeenCalledWith(img)
    expect(copyPng).toHaveBeenCalledWith(png)
    expect(copy.classList.contains('copied')).toBe(true)
    expect(copy.innerHTML).not.toBe(face)
    await vi.advanceTimersByTimeAsync(1500)
    expect(copy.classList.contains('copied')).toBe(false)
    expect(copy.innerHTML).toBe(face)
  })

  it('✓ 가 떠 있는 동안 다시 누르면 그때부터 1.5초 동안 ✓ 를 보인다', async () => {
    vi.useFakeTimers()
    vi.mocked(imagePng).mockResolvedValue(new Blob())
    vi.mocked(copyPng).mockResolvedValue()
    const { copy } = image({ width: 1000, height: 600 })
    copy.click()
    await vi.advanceTimersByTimeAsync(1000)
    copy.click()
    await vi.advanceTimersByTimeAsync(1000)
    expect(copy.classList.contains('copied')).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(copy.classList.contains('copied')).toBe(false)
  })

  it('싣지 못하면 ✓ 를 보이지 않고 오류를 남긴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(imagePng).mockRejectedValue(new Error('tainted'))
    const { copy } = image({ width: 1000, height: 600 })
    copy.click()
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    expect(copy.classList.contains('copied')).toBe(false)
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
