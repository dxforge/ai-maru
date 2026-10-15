import { describe, expect, it } from 'vitest'
import { contrast, GHOSTTY, mix, uiColors, xtermTheme } from './theme'

describe('mix', () => {
  it('두 색 사이를 비율만큼 옮긴다', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('uiColors', () => {
  it('Ghostty 의 red 는 포커스된 칸 머리 위에서 3:1 이 안 되어 bright red 를 쓰고, 나머지는 그대로 쓴다', () => {
    const ui = uiColors(GHOSTTY)
    expect(contrast(GHOSTTY.ansi[1], ui.hdrFocus)).toBeLessThan(3)
    expect(ui.error).toBe(GHOSTTY.ansi[9])
    expect(ui.waiting).toBe(GHOSTTY.ansi[3])
    expect(ui.working).toBe(GHOSTTY.ansi[4])
    expect(ui.done).toBe(GHOSTTY.ansi[2])
  })

  it('어두운 테마의 사이드바는 배경보다 어둡고, 밝은 테마의 사이드바는 배경보다 글자색 쪽이다', () => {
    const dark = uiColors(GHOSTTY)
    expect(contrast(dark.side, '#000000')).toBeLessThan(contrast(dark.ground, '#000000'))
    const light = uiColors({ background: '#ffffff', foreground: '#1f2328', ansi: GHOSTTY.ansi })
    expect(light.side).toBe(mix('#ffffff', '#1f2328', 0.035))
  })

  it('포커스된 칸 머리는 다른 칸 머리보다 글자색에 가깝다', () => {
    const ui = uiColors(GHOSTTY)
    expect(contrast(ui.hdrFocus, ui.fg)).toBeLessThan(contrast(ui.hdr, ui.fg))
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
