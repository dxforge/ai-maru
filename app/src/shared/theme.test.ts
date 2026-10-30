import { describe, expect, it } from 'vitest'
import {
  contrast,
  GHOSTTY,
  HEADER_CONTRAST,
  isLight,
  mix,
  hexColor,
  PANE_LINE_CONTRAST,
  parseWindowTheme,
  uiColors,
  xtermTheme
} from './theme'

const brightness = (c: string): number => contrast(c, '#000000')

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
  it('어두운 테마의 pane 헤더는 터미널보다 어둡고, 밝은 테마의 pane 헤더는 글자색 쪽이다', () => {
    const dark = uiColors(GHOSTTY)
    expect(brightness(dark.hdr)).toBeLessThan(brightness(dark.ground))
    const light = uiColors({ background: '#eff1f5', foreground: '#4c4f69', ansi: GHOSTTY.ansi })
    expect(contrast(light.hdr, light.fg)).toBeLessThan(contrast(light.ground, light.fg))
  })

  it('배경이 검정이면 pane 헤더를 글자색 쪽으로 섞어 같은 대비를 낸다', () => {
    const ui = uiColors({ ...GHOSTTY, background: '#000000' })
    expect(brightness(ui.hdr)).toBeGreaterThan(brightness(ui.ground))
    expect(contrast(ui.hdr, ui.ground)).toBeCloseTo(HEADER_CONTRAST, 2)
  })

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

  it('밝은 테마의 focus 된 pane 헤더는 focus 안 된 pane 헤더보다 밝아, 흐린 글자와 멀어진다', () => {
    const ui = uiColors({ background: '#eff1f5', foreground: '#4c4f69', ansi: GHOSTTY.ansi })
    expect(brightness(ui.hdrFocus)).toBeGreaterThan(brightness(ui.hdr))
    expect(contrast(ui.faint, ui.hdrFocus)).toBeGreaterThan(contrast(ui.faint, ui.hdr))
  })

  it('배경이 흰색인 밝은 테마의 focus 된 pane 헤더는 흰색에서 멈춘다', () => {
    const ui = uiColors({ background: '#ffffff', foreground: '#1f2328', ansi: GHOSTTY.ansi })
    expect(ui.hdrFocus).toBe('#ffffff')
  })

  it('구분선이 터미널·두 헤더와 이미 구별되면 pane 경계선은 구분선과 같은 색이다', () => {
    const ui = uiColors(GHOSTTY)
    expect(ui.paneLine).toBe(ui.line)
  })

  it('구분선이 focus 된 pane 헤더와 같은 색에 가까우면 pane 경계선을 글자색 쪽으로 더 섞는다', () => {
    const ui = uiColors({ background: '#1e1e2e', foreground: '#cdd6f4', ansi: GHOSTTY.ansi })
    expect(contrast(ui.line, ui.hdrFocus)).toBeLessThan(PANE_LINE_CONTRAST)
    expect(contrast(ui.paneLine, ui.hdrFocus)).toBeGreaterThanOrEqual(PANE_LINE_CONTRAST)
    expect(contrast(ui.paneLine, ui.fg)).toBeLessThan(contrast(ui.line, ui.fg))
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

describe('xtermTheme 의 커서·선택 색', () => {
  it('테마에 없으면 커서는 글자색이고 선택 색은 xterm 기본(undefined)이다', () => {
    const t = xtermTheme(GHOSTTY)
    expect(t.cursor).toBe(GHOSTTY.foreground)
    expect(t.cursorAccent).toBeUndefined()
    expect(t.selectionBackground).toBeUndefined()
    expect(t.selectionForeground).toBeUndefined()
  })

  it('테마에 있으면 그대로 넘긴다', () => {
    const t = xtermTheme({
      ...GHOSTTY,
      cursor: '#f5e0dc',
      cursorText: '#1e1e2e',
      selectionBackground: '#585b70',
      selectionForeground: '#cdd6f4'
    })
    expect([t.cursor, t.cursorAccent, t.selectionBackground, t.selectionForeground]).toEqual([
      '#f5e0dc',
      '#1e1e2e',
      '#585b70',
      '#cdd6f4'
    ])
  })
})

describe('hexColor', () => {
  it('# 이 없거나 대문자여도 #rrggbb 소문자로 맞추고, 그 꼴이 아니면 null', () => {
    expect(hexColor('#1e1e2e')).toBe('#1e1e2e')
    expect(hexColor(' 1E1E2E ')).toBe('#1e1e2e')
    for (const bad of ['#fff', 'red', '#1e1e2e1e', '#1e1e2g', ''])
      expect(hexColor(bad), bad).toBeNull()
  })
})

describe('parseWindowTheme', () => {
  it('#rrggbb 배경과 세 모드만 받는다', () => {
    expect(parseWindowTheme({ background: '#1E1E2E', mode: 'system' })).toEqual({
      background: '#1e1e2e',
      mode: 'system'
    })
    for (const bad of [
      null,
      'dark',
      { background: '#fff', mode: 'dark' },
      { background: 'red', mode: 'dark' },
      { background: '#1e1e2e', mode: 'auto' },
      { background: '#1e1e2e' }
    ])
      expect(parseWindowTheme(bad), JSON.stringify(bad)).toBeNull()
  })
})
