// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, withDirectives, type App } from 'vue'
import {
  EDGE,
  GAP,
  placeBeside,
  placeTooltip,
  SHOW_DELAY,
  TOOLTIP_ID,
  vTooltip,
  WARM_WINDOW,
  type Anchor,
  type TooltipValue
} from './tooltip'

describe('placeTooltip', () => {
  const view = { width: 800, height: 600 }
  const tip = { width: 100, height: 20 }
  // 마우스로 띄울 때의 자리: 가로는 커서, 세로는 요소다.
  const cursor = (x: number, top: number): Anchor => ({
    rect: { left: x, top, width: 0, height: 20 },
    align: 'start'
  })
  const element = (left: number, top: number, width: number, height: number): Anchor => ({
    rect: { left, top, width, height },
    align: 'center'
  })

  it('마우스로 띄우면 요소 아래에 두고 왼쪽을 커서에 맞춘다', () => {
    expect(placeTooltip(cursor(300, 300), tip, view)).toEqual({
      left: 300,
      top: 320 + GAP,
      side: 'bottom'
    })
  })

  it('키보드 포커스 자리는 요소 아래 가운데에 둔다', () => {
    expect(placeTooltip(element(300, 300, 40, 20), tip, view)).toEqual({
      left: 320 - tip.width / 2,
      top: 320 + GAP,
      side: 'bottom'
    })
  })

  it('아래에 자리가 없으면 위로 뒤집는다', () => {
    expect(placeTooltip(cursor(300, 570), tip, view)).toEqual({
      left: 300,
      top: 570 - GAP - tip.height,
      side: 'top'
    })
  })

  it('왼쪽·오른쪽 가장자리에서는 창 안으로 민다', () => {
    expect(placeTooltip(element(0, 300, 20, 20), tip, view).left).toBe(EDGE)
    expect(placeTooltip(cursor(790, 300), tip, view).left).toBe(view.width - EDGE - tip.width)
  })

  it('창보다 넓으면 왼쪽 가장자리에 붙인다', () => {
    const wide = { width: view.width + 100, height: 20 }
    expect(placeTooltip(cursor(300, 300), wide, view).left).toBe(EDGE)
  })

  it('위아래 모두 자리가 없으면 넓은 쪽에 두고 창 안으로 민다', () => {
    const tall = { width: 100, height: 300 }
    // 아래(350 + GAP 부터)가 위(150 - GAP 까지)보다 넓다.
    expect(placeTooltip(element(300, 150, 40, 200), tall, view)).toEqual({
      left: 270,
      top: view.height - EDGE - tall.height,
      side: 'bottom'
    })
    // 위(260 - GAP 까지)가 아래(360 + GAP 부터)보다 넓다.
    expect(placeTooltip(element(300, 260, 40, 100), tall, view)).toEqual({
      left: 270,
      top: EDGE,
      side: 'top'
    })
  })
})

describe('vTooltip', () => {
  let app: App | undefined
  const state = reactive<{
    outer: TooltipValue
    inner: TooltipValue
    other: TooltipValue
    on: boolean
  }>({
    outer: 'outer tip',
    inner: 'inner tip',
    other: 'other tip',
    on: true
  })

  function mount(): void {
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({
      render: () =>
        state.on
          ? [
              withDirectives(
                h('button', { id: 'outer' }, [
                  withDirectives(h('span', { id: 'inner' }), [[vTooltip, state.inner]])
                ]),
                [[vTooltip, state.outer]]
              ),
              withDirectives(h('button', { id: 'other' }), [[vTooltip, state.other]])
            ]
          : []
    })
    app.mount(root)
  }

  const el = (id: string): HTMLElement => document.getElementById(id)!
  const box = (): HTMLElement | null => document.getElementById(TOOLTIP_ID)
  const shownText = (): string | undefined =>
    box()?.hasAttribute('data-open') ? box()!.textContent! : undefined
  const at = (): { left: string; top: string } => ({
    left: box()!.style.left,
    top: box()!.style.top
  })
  // jsdom 의 `:focus-visible` 판정은 앞서 보낸 이벤트에 따라 바뀌므로, `focus` 는 키보드 포커스인지를 `matches` 로 직접 정한다.
  const focus = (id: string, visible = true): void => {
    vi.spyOn(el(id), 'matches').mockImplementation((s) => s === ':focus-visible' && visible)
    el(id).focus()
  }
  const enter = (id: string, clientX = 0, clientY = 0): void =>
    void el(id).dispatchEvent(new MouseEvent('mouseenter', { clientX, clientY }))
  const leave = (id: string): void => void el(id).dispatchEvent(new MouseEvent('mouseleave'))

  // jsdom 에는 popover 가 없어, 열고 닫은 것을 `data-open` 으로 남긴다.
  beforeAll(() => {
    HTMLElement.prototype.showPopover = function (this: HTMLElement) {
      this.setAttribute('data-open', '')
    }
    HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
      this.removeAttribute('data-open')
    }
  })

  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(state, { outer: 'outer tip', inner: 'inner tip', other: 'other tip', on: true })
    mount()
  })

  afterEach(() => {
    for (const id of ['inner', 'outer', 'other']) if (document.getElementById(id)) leave(id)
    el('other')?.blur()
    vi.advanceTimersByTime(WARM_WINDOW)
    app?.unmount()
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('마우스를 올리고 지연이 지나면 뜨고, 요소를 aria-describedby 로 잇는다', () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY - 1)
    expect(shownText()).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(shownText()).toBe('other tip')
    expect(box()!.getAttribute('role')).toBe('tooltip')
    expect(box()!.getAttribute('popover')).toBe('manual')
    expect(el('other').getAttribute('aria-describedby')).toBe(TOOLTIP_ID)
  })

  it('마우스로 띄우면 요소 아래에 두고, 떠 있는 동안 가로 자리가 커서를 따라간다', async () => {
    vi.spyOn(el('other'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 190, 300, 30))
    enter('other', 100, 200)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 205 }))
    vi.advanceTimersByTime(SHOW_DELAY)
    const top = `${220 + GAP}px`
    expect(at()).toEqual({ left: '120px', top })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 215 }))
    expect(at()).toEqual({ left: '150px', top })
    state.other = 'changed'
    await nextTick()
    expect(shownText()).toBe('changed')
    expect(at()).toEqual({ left: '150px', top })
  })

  it('키보드 포커스로 띄우면 요소 아래 가운데에 둔다', () => {
    vi.spyOn(el('other'), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 40, 20))
    focus('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(at()).toEqual({ left: '120px', top: `${70 + GAP}px` })
  })

  it('마우스가 나가면 닫고 aria-describedby 를 뗀다', () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    leave('other')
    expect(shownText()).toBeUndefined()
    expect(el('other').hasAttribute('aria-describedby')).toBe(false)
  })

  it('지연이 지나기 전에 나가면 뜨지 않는다', () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY - 1)
    leave('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBeUndefined()
  })

  it('떠 있는 동안 다른 요소로 옮기면 기다리지 않고 띄운다', () => {
    enter('outer')
    vi.advanceTimersByTime(SHOW_DELAY)
    leave('outer')
    vi.advanceTimersByTime(WARM_WINDOW - 1)
    enter('other')
    expect(shownText()).toBe('other tip')
    expect(el('outer').hasAttribute('aria-describedby')).toBe(false)
  })

  it('닫힌 뒤 WARM_WINDOW 가 지나 다른 요소에 들어가면 다시 지연을 기다린다', () => {
    enter('outer')
    vi.advanceTimersByTime(SHOW_DELAY)
    leave('outer')
    vi.advanceTimersByTime(WARM_WINDOW)
    enter('other')
    expect(shownText()).toBeUndefined()
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBe('other tip')
  })

  it('안쪽 요소에 들어가면 안쪽 값을, 나오면 바깥 값을 띄운다', () => {
    enter('outer')
    vi.advanceTimersByTime(SHOW_DELAY)
    enter('inner')
    expect(shownText()).toBe('inner tip')
    expect(el('inner').getAttribute('aria-describedby')).toBe(TOOLTIP_ID)
    expect(el('outer').hasAttribute('aria-describedby')).toBe(false)
    leave('inner')
    expect(shownText()).toBe('outer tip')
  })

  it('안쪽 요소의 값이 비었으면 바깥 값을 그대로 띄운다', async () => {
    state.inner = ''
    await nextTick()
    enter('outer')
    vi.advanceTimersByTime(SHOW_DELAY)
    enter('inner')
    expect(shownText()).toBe('outer tip')
    expect(el('inner').dataset.tooltip).toBe('')
  })

  it('마우스가 올라가 있는 동안 안쪽 요소에 값이 생기면 안쪽 값으로 바꾼다', async () => {
    state.inner = ''
    await nextTick()
    enter('outer')
    enter('inner')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBe('outer tip')
    state.inner = 'inner tip'
    await nextTick()
    expect(shownText()).toBe('inner tip')
  })

  it.each(['Escape', 'a', 'Shift'])(
    '%s 키로 닫고, 키를 막지 않으며, 안쪽에서 바깥으로 나와도 다시 띄우지 않는다',
    (name) => {
      enter('outer')
      enter('inner')
      vi.advanceTimersByTime(SHOW_DELAY)
      const key = new KeyboardEvent('keydown', { key: name, cancelable: true })
      document.dispatchEvent(key)
      expect(key.defaultPrevented).toBe(false)
      expect(shownText()).toBeUndefined()
      expect(el('inner').hasAttribute('aria-describedby')).toBe(false)
      leave('inner')
      vi.advanceTimersByTime(SHOW_DELAY)
      expect(shownText()).toBeUndefined()
    }
  )

  it('Esc 로 닫은 뒤 다른 요소에 들어가면 지연을 기다려 띄운다', () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    leave('other')
    enter('outer')
    expect(shownText()).toBeUndefined()
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBe('outer tip')
  })

  it('Esc 로 닫은 뒤 키보드로 포커스를 옮기면, 마우스 아래 요소가 아니라 포커스한 요소를 띄운다', () => {
    enter('outer')
    vi.advanceTimersByTime(SHOW_DELAY)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    focus('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBe('other tip')
  })

  it('키보드 포커스로 띄운 것을 Esc 로 닫으면 포커스가 옮겨 갈 때까지 다시 띄우지 않는다', () => {
    focus('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBeUndefined()
    focus('outer')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBe('outer tip')
  })

  it('마우스가 올라간 요소를 포커스한 요소보다 먼저 띄우고, 마우스가 나가면 포커스한 요소로 돌아간다', () => {
    focus('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    enter('outer')
    expect(shownText()).toBe('outer tip')
    leave('outer')
    expect(shownText()).toBe('other tip')
  })

  it('기다리는 동안 누르면 띄우지 않는다', () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY - 1)
    el('other').dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBeUndefined()
  })

  it('요소에 원래 있던 aria-describedby 는 지킨다', () => {
    el('other').setAttribute('aria-describedby', 'hint')
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(el('other').getAttribute('aria-describedby')).toBe(`hint ${TOOLTIP_ID}`)
    leave('other')
    expect(el('other').getAttribute('aria-describedby')).toBe('hint')
  })

  it('요소를 누르면 닫는다', () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    el('other').dispatchEvent(new Event('pointerdown'))
    expect(shownText()).toBeUndefined()
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBeUndefined()
  })

  it('창이 포커스를 잃으면 닫는다', () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    window.dispatchEvent(new Event('blur'))
    expect(shownText()).toBeUndefined()
  })

  it('요소를 담은 영역이 스크롤되면 닫고, 상관없는 영역의 스크롤은 무시한다', () => {
    const elsewhere = document.createElement('div')
    document.body.append(elsewhere)
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    elsewhere.dispatchEvent(new Event('scroll'))
    expect(shownText()).toBe('other tip')
    el('other').parentElement!.dispatchEvent(new Event('scroll'))
    expect(shownText()).toBeUndefined()
  })

  it('떠 있는 동안 값이 바뀌면 내용을 바꾸고, 값이 비면 닫는다', async () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    state.other = 'line 1\nline 2'
    await nextTick()
    expect(shownText()).toBe('line 1\nline 2')
    state.other = ''
    await nextTick()
    expect(shownText()).toBeUndefined()
    expect(el('other').hasAttribute('aria-describedby')).toBe(false)
  })

  it('단축키가 있으면 문장 뒤에 kbd 로 띄우고, 단축키만 바뀌어도 내용을 바꾼다', async () => {
    state.other = { text: 'Close Canvas', keys: '⌥⌘B' }
    await nextTick()
    expect(el('other').dataset.tooltipKeys).toBe('⌥⌘B')
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBe('Close Canvas⌥⌘B')
    expect(box()!.querySelector('kbd')!.textContent).toBe('⌥⌘B')
    state.other = { text: 'Close Canvas', keys: '⌘B' }
    await nextTick()
    expect(box()!.querySelector('kbd')!.textContent).toBe('⌘B')
    state.other = 'plain'
    await nextTick()
    expect(box()!.querySelector('kbd')).toBeNull()
    expect(el('other').dataset.tooltipKeys).toBeUndefined()
  })

  it('기다리는 동안 값이 바뀌면 바뀐 값을 띄운다', async () => {
    enter('other')
    state.other = 'changed'
    await nextTick()
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBe('changed')
  })

  it('값이 빈 요소는 띄우지 않는다', async () => {
    state.other = ''
    await nextTick()
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBeUndefined()
  })

  it('떠 있는 요소가 사라지면 닫는다', async () => {
    enter('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    state.on = false
    await nextTick()
    expect(shownText()).toBeUndefined()
  })

  it('키보드로 포커스하면 띄우고, 포커스를 잃으면 닫는다', () => {
    focus('other')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBe('other tip')
    el('other').blur()
    expect(shownText()).toBeUndefined()
  })

  it('`:focus-visible` 이 아닌 포커스(마우스로 눌러 받은 포커스)에는 띄우지 않는다', () => {
    focus('other', false)
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(shownText()).toBeUndefined()
  })
})

describe('placeBeside', () => {
  const view = { width: 800, height: 600 }
  const card = { width: 300, height: 200 }

  it('왼쪽 위 끝을 at 에 둔다', () => {
    expect(placeBeside({ top: 100, left: 240 }, card, view)).toEqual({ left: 240, top: 100 })
  })

  it('창 아래로 넘치면 창 안으로 올린다', () => {
    expect(placeBeside({ top: 500, left: 240 }, card, view)).toEqual({
      left: 240,
      top: view.height - EDGE - card.height
    })
  })

  it('창보다 높으면 위 가장자리에 두고 아래를 자른다', () => {
    const tall = { width: 300, height: 700 }
    expect(placeBeside({ top: 100, left: 240 }, tall, view)).toEqual({
      left: 240,
      top: EDGE,
      maxHeight: view.height - 2 * EDGE
    })
  })

  it('오른쪽에 자리가 없으면 창 안으로 민다', () => {
    expect(placeBeside({ top: 100, left: 700 }, card, view).left).toBe(
      view.width - EDGE - card.width
    )
  })
})
