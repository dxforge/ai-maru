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
  it('상태 색은 사이드바와 칸 배경 위에서 3:1 이 넘으면 ANSI 색을 그대로 쓴다', () => {
    const ui = uiColors(GHOSTTY)
    expect([ui.error, ui.done, ui.waiting, ui.working]).toEqual(
      [1, 2, 3, 4].map((i) => GHOSTTY.ansi[i])
    )
  })

  it('3:1 이 안 되는 상태 색은 bright 색을 쓴다', () => {
    const ansi = [...GHOSTTY.ansi]
    ansi[1] = '#5a2020'
    const ui = uiColors({ ...GHOSTTY, ansi })
    expect(contrast(ansi[1], GHOSTTY.background)).toBeLessThan(3)
    expect(ui.error).toBe(ansi[9])
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
