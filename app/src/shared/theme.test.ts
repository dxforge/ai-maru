import { describe, expect, it } from 'vitest'
import { contrast, GHOSTTY, isLight, mix, uiColors, xtermTheme } from './theme'

describe('isLight', () => {
  it('배경의 밝기로 가른다', () => {
    expect(isLight(GHOSTTY)).toBe(false)
    expect(isLight({ ...GHOSTTY, background: '#ffffff', foreground: '#1f2328' })).toBe(true)
  })
})

describe('mix', () => {
  it('두 색 사이를 비율만큼 옮긴다', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('uiColors', () => {
  it('상태 색은 사이드바·pane·pane 헤더 위에서 모두 3:1 이 넘으면 ANSI 색을 그대로 쓴다', () => {
    const ui = uiColors(GHOSTTY)
    expect([ui.waiting, ui.working]).toEqual([GHOSTTY.ansi[3], GHOSTTY.ansi[4]])
  })

  it('오류 색도 상태 색과 같은 대비 기준으로 고른다', () => {
    const ui = uiColors(GHOSTTY)
    expect(contrast(GHOSTTY.ansi[1], ui.hdrFocus)).toBeLessThan(3)
    expect(ui.error).toBe(GHOSTTY.ansi[9])
  })

  it('포커스된 pane 헤더 위에서만 3:1 이 안 되어도 bright 색을 쓴다', () => {
    const ui = uiColors(GHOSTTY)
    const ansi = [...GHOSTTY.ansi]
    ansi[4] = GHOSTTY.ansi[1]
    expect(contrast(ansi[4], ui.ground)).toBeGreaterThanOrEqual(3)
    expect(contrast(ansi[4], ui.hdrFocus)).toBeLessThan(3)
    expect(uiColors({ ...GHOSTTY, ansi }).working).toBe(ansi[12])
  })

  it('포커스된 pane 헤더는 다른 pane 헤더보다 글자색에 가깝다', () => {
    const ui = uiColors(GHOSTTY)
    expect(contrast(ui.hdrFocus, ui.fg)).toBeLessThan(contrast(ui.raised, ui.fg))
  })

  it('어두운 테마의 사이드바는 배경보다 어둡고, 밝은 테마의 사이드바는 배경보다 글자색 쪽이다', () => {
    const dark = uiColors(GHOSTTY)
    expect(contrast(dark.side, '#000000')).toBeLessThan(contrast(dark.ground, '#000000'))
    const light = uiColors({ background: '#ffffff', foreground: '#1f2328', ansi: GHOSTTY.ansi })
    expect(light.side).toBe(mix('#ffffff', '#1f2328', 0.035))
  })
})

describe('xtermTheme', () => {
  it('16색을 xterm 의 이름으로 옮긴다', () => {
    const t = xtermTheme(GHOSTTY)
    expect(t.background).toBe('#282c34')
    expect(t.black).toBe('#1d1f21')
    expect(t.white).toBe('#c5c8c6')
    expect(t.brightBlack).toBe('#666666')
    expect(t.brightWhite).toBe('#eaeaea')
  })
})
