// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { backgroundOf, standaloneSvg } from './copyImage'

afterEach(() => document.body.replaceChildren())

describe('standaloneSvg', () => {
  it('확대·축소가 준 크기를 걷어 내고 100% 크기를 적되, 화면의 SVG 는 그대로 둔다', () => {
    const host = document.body.appendChild(document.createElement('div'))
    host.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="100%" style="max-width: 200px; color: red"><rect width="10" height="10"/></svg>'
    const svg = host.querySelector('svg')!
    svg.style.width = '500px'
    svg.style.height = '250px'
    const out = new DOMParser().parseFromString(
      standaloneSvg(svg, { width: 200, height: 100 }),
      'image/svg+xml'
    ).documentElement
    expect(out.getAttribute('width')).toBe('200')
    expect(out.getAttribute('height')).toBe('100')
    expect(out.getAttribute('viewBox')).toBe('0 0 200 100')
    expect(out.getAttribute('style')).toBe('color: red;')
    expect(out.querySelector('rect')).not.toBeNull()
    expect(svg.style.width).toBe('500px')
    expect(svg.getAttribute('width')).toBe('100%')
  })
})

describe('backgroundOf', () => {
  it('투명하지 않은 배경을 가진 가장 가까운 조상의 색이고, 없으면 흰색이다', () => {
    const outer = document.body.appendChild(document.createElement('div'))
    const inner = outer.appendChild(document.createElement('div'))
    const el = inner.appendChild(document.createElement('div'))
    expect(backgroundOf(el)).toBe('white')
    outer.style.background = 'rgb(10, 20, 30)'
    inner.style.background = 'transparent'
    expect(backgroundOf(el)).toBe('rgb(10, 20, 30)')
    inner.style.background = 'rgba(0, 0, 0, 0)'
    expect(backgroundOf(el)).toBe('rgb(10, 20, 30)')
    el.style.background = 'rgb(1, 2, 3)'
    expect(backgroundOf(el)).toBe('rgb(1, 2, 3)')
  })
})
