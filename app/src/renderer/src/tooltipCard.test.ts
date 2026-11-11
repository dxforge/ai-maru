// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, withDirectives, type App } from 'vue'
import { SHOW_DELAY, TOOLTIP_ID, vTooltip, type TooltipCard } from './tooltip'

// jsdom 에는 popover 가 없어, 열고 닫은 것을 `data-open` 으로 남긴다.
beforeAll(() => {
  HTMLElement.prototype.showPopover = function (this: HTMLElement) {
    this.setAttribute('data-open', '')
  }
  HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
    this.removeAttribute('data-open')
  }
})

describe('vTooltip 카드', () => {
  let app: App | undefined
  const calls: string[] = []
  const card: TooltipCard<{ row?: string }> = {
    id: 'test-card',
    show: (el, at) => void calls.push(`show ${el.id} ${at.row ?? '-'}`),
    hide: () => void calls.push('hide')
  }
  const state = reactive({ a: 'a', on: true, tick: 0 })
  let runs = 0

  // group(카드) 안에 row(카드) 둘을 두고, 첫 row 안에 텍스트 tooltip 버튼을 둔다. group 옆에 다른 cell 인 group2(카드)를 둔다.
  function mount(): void {
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({
      render: () =>
        state.on
          ? [
              withDirectives(
                h('div', { id: 'group', 'data-tick': state.tick }, [
                  withDirectives(
                    h('div', { id: 'row', tabindex: 0 }, [
                      withDirectives(h('button', { id: 'btn' }), [[vTooltip, 'Remove']])
                    ]),
                    [[vTooltip, { card, at: { row: state.a } }]]
                  ),
                  withDirectives(h('div', { id: 'row2' }), [[vTooltip, { card, at: { row: 'b' } }]])
                ]),
                [[vTooltip, { card, at: {} }]]
              ),
              withDirectives(h('div', { id: 'group2' }), [[vTooltip, { card, at: { row: 'g2' } }]])
            ]
          : null
    })
    app.mount(root)
  }

  const el = (id: string): HTMLElement => document.getElementById(id)!
  const enter = (id: string): void => void el(id).dispatchEvent(new MouseEvent('mouseenter'))
  const leave = (id: string): void => void el(id).dispatchEvent(new MouseEvent('mouseleave'))
  // jsdom 의 `:focus-visible` 판정은 앞서 보낸 이벤트에 따라 바뀌므로, 키보드 포커스인지를 `matches` 로 직접 정한다.
  const focus = (id: string): void => {
    vi.spyOn(el(id), 'matches').mockImplementation((s) => s === ':focus-visible')
    el(id).focus()
  }
  const box = (): HTMLElement | null => document.getElementById(TOOLTIP_ID)
  const boxOpen = (): boolean => !!box()?.hasAttribute('data-open')

  beforeEach(() => {
    // 테스트마다 시계를 한 시간씩 앞으로 둬, 앞 테스트가 남긴 WARM_WINDOW 를 지난다. 가짜 시계를 끄면 시각이 되돌아가기 때문이다.
    vi.useFakeTimers({ now: Date.now() + 3_600_000 * ++runs })
    Object.assign(state, { a: 'a', on: true, tick: 0 })
    mount()
    calls.length = 0
  })

  afterEach(() => {
    for (const id of ['btn', 'row', 'row2', 'group', 'group2'])
      if (document.getElementById(id)) leave(id)
    app?.unmount()
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('지연이 지나면 텍스트 상자 대신 카드를 띄우고, 요소를 카드 id 로 잇는다', () => {
    enter('group')
    enter('row')
    vi.advanceTimersByTime(SHOW_DELAY - 1)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['show row a'])
    expect(boxOpen()).toBe(false)
    expect(el('row').getAttribute('aria-describedby')).toBe('test-card')
    expect(el('row').dataset.tooltip).toBeUndefined()
  })

  it('같은 카드를 단 요소 사이를 옮기면 카드를 닫지 않고 옮긴 요소를 넘긴다', () => {
    enter('group')
    enter('row')
    vi.advanceTimersByTime(SHOW_DELAY)
    leave('row')
    enter('row2')
    leave('row2')
    expect(calls).toEqual(['show row a', 'show group -', 'show row2 b', 'show group -'])
    expect(el('row').hasAttribute('aria-describedby')).toBe(false)
    expect(el('row2').hasAttribute('aria-describedby')).toBe(false)
    expect(el('group').getAttribute('aria-describedby')).toBe('test-card')
  })

  it('안쪽의 텍스트 tooltip 요소에 들어가면 카드를 닫고 텍스트를 띄우며, 나오면 기다리지 않고 카드를 띄운다', () => {
    enter('group')
    enter('row')
    vi.advanceTimersByTime(SHOW_DELAY)
    enter('btn')
    expect(calls).toEqual(['show row a', 'hide'])
    expect(boxOpen()).toBe(true)
    expect(box()!.textContent).toBe('Remove')
    expect(el('row').hasAttribute('aria-describedby')).toBe(false)
    leave('btn')
    expect(boxOpen()).toBe(false)
    expect(calls).toEqual(['show row a', 'hide', 'show row a'])
  })

  it('다른 cell 로 옮기면 카드를 닫았다가 기다리지 않고 그 cell 로 다시 띄운다', () => {
    enter('group')
    enter('row')
    vi.advanceTimersByTime(SHOW_DELAY)
    leave('row')
    leave('group')
    enter('group2')
    expect(calls).toEqual(['show row a', 'show group -', 'hide', 'show group2 g2'])
    expect(el('group2').getAttribute('aria-describedby')).toBe('test-card')
  })

  it('키보드로 포커스하면 지연 뒤 카드를 띄우고, 포커스를 잃으면 닫는다', () => {
    focus('row')
    vi.advanceTimersByTime(SHOW_DELAY)
    expect(calls).toEqual(['show row a'])
    expect(el('row').getAttribute('aria-describedby')).toBe('test-card')
    el('row').blur()
    expect(calls).toEqual(['show row a', 'hide'])
    expect(el('row').hasAttribute('aria-describedby')).toBe(false)
  })

  it('키를 누르면 카드를 닫고 aria-describedby 를 뗀다', () => {
    enter('group')
    enter('row')
    vi.advanceTimersByTime(SHOW_DELAY)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(calls).toEqual(['show row a', 'hide'])
    expect(el('row').hasAttribute('aria-describedby')).toBe(false)
  })

  it('값의 at 이 그대로면 다시 그려도 카드를 다시 부르지 않고, 바뀌면 바뀐 at 으로 부른다', async () => {
    enter('group')
    enter('row')
    vi.advanceTimersByTime(SHOW_DELAY)
    state.tick++
    await nextTick()
    expect(calls).toEqual(['show row a'])
    state.a = 'c'
    await nextTick()
    expect(calls).toEqual(['show row a', 'show row c'])
  })

  it('카드를 띄운 요소가 사라지면 카드를 닫는다', async () => {
    enter('group')
    enter('row')
    vi.advanceTimersByTime(SHOW_DELAY)
    state.on = false
    await nextTick()
    expect(calls).toEqual(['show row a', 'hide'])
  })
})
