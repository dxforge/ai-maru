// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onUserScroll } from './userScroll'

afterEach(() => document.body.replaceChildren())

function setup() {
  const add = <K extends keyof HTMLElementTagNameMap>(parent: Element, tag: K) =>
    parent.appendChild(document.createElement(tag))
  const area = add(document.body, 'div')
  const scroller = add(area, 'div')
  const doc = add(scroller, 'div')
  const link = add(doc, 'a')
  const other = add(scroller, 'div')
  const title = add(area, 'div')
  const terminal = add(document.body, 'textarea')
  const drop = vi.fn()
  const stop = onUserScroll(doc, scroller, drop)
  return { scroller, link, other, title, terminal, drop, stop }
}

const key = (target: EventTarget, k: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
const press = (target: EventTarget) =>
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }))

describe('onUserScroll', () => {
  it('휠, 포커스가 스크롤러 안이나 아무 데도 없을 때의 스크롤 키, 문서 밖 누르기에 부른다', () => {
    const { scroller, link, other, title, drop } = setup()
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    key(document.body, 'PageDown')
    key(link, ' ')
    press(other)
    press(title)
    expect(drop).toHaveBeenCalledTimes(5)
  })

  it('포커스가 스크롤러 밖(터미널)일 때의 키, 스크롤하지 않는 키, 문서 안 누르기에는 부르지 않는다', () => {
    const { link, terminal, drop } = setup()
    key(terminal, 'PageDown')
    key(terminal, ' ')
    key(document.body, 'a')
    press(link)
    expect(drop).not.toHaveBeenCalled()
  })

  it('멈춘 뒤에는 부르지 않는다', () => {
    const { scroller, drop, stop } = setup()
    stop()
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    key(document.body, 'PageDown')
    press(document.body)
    expect(drop).not.toHaveBeenCalled()
  })
})
