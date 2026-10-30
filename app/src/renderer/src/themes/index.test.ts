import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  contrast,
  FOCUSED_HEADER_CONTRAST,
  GHOSTTY,
  HEADER_CONTRAST,
  isLight,
  PANE_LINE_CONTRAST,
  uiColors
} from '../../../shared/theme'
import { activeTheme, DEFAULT_THEME, sameThemeChoice, themeNamed, themeNames, windowTheme } from '.'

const MIN_CONTRAST = 3

describe('themeNamed', () => {
  it('ghostty/ 의 파일을 하나도 빠뜨리지 않고 읽는다', () => {
    // Vite 의 `import.meta.glob` 은 `.DS_Store` 같은 점 파일을 빼므로 여기서도 뺀다.
    const files = readdirSync(fileURLToPath(new URL('./ghostty', import.meta.url)))
      .filter((f) => !f.startsWith('.'))
      .sort()
    expect(files.length).toBeGreaterThan(800)
    expect(themeNames().sort()).toEqual(files)
  })

  it('이름은 Ghostty 와 같다 — 대소문자·공백까지', () => {
    expect(themeNamed('Catppuccin Mocha')?.background).toBe('#1e1e2e')
    expect(themeNamed('catppuccin mocha')).toBeUndefined()
    expect(themeNamed('Catppuccin  Mocha')).toBeUndefined()
    expect(themeNamed("Jack O' Lantern")).toBeDefined()
  })

  it('같은 이름은 같은 객체다', () => {
    expect(themeNamed('Nord')).toBe(themeNamed('Nord'))
  })

  it('모든 테마에서 상태 색은 사이드바·pane·pane 헤더 위에서 3:1 이 넘는 ANSI 색이거나, 안 넘으면 bright 색이다', () => {
    for (const name of themeNames()) {
      const theme = themeNamed(name)!
      const ui = uiColors(theme)
      const surfaces = [ui.side, ui.ground, ui.raised, ui.hdr, ui.hdrFocus]
      for (const [key, i] of [
        ['working', 4],
        ['waiting', 3],
        ['error', 1]
      ] as const) {
        const normal = surfaces.every((s) => contrast(theme.ansi[i], s) >= MIN_CONTRAST)
        expect(ui[key], `${name} ${key}`).toBe(theme.ansi[normal ? i : i + 8])
      }
    }
  })

  // 색을 채널마다 8bit 로 반올림하므로 대비가 목표에서 조금 어긋난다. 테마 861개에서 가장 크게 어긋난 값은 1.5% 다.
  const near = (actual: number, target: number): boolean => Math.abs(actual / target - 1) < 0.02

  it('모든 테마에서 pane 헤더 배경은 터미널 배경과 같은 대비로 구별된다', () => {
    for (const name of themeNames()) {
      const ui = uiColors(themeNamed(name)!)
      expect(near(contrast(ui.hdr, ui.ground), HEADER_CONTRAST), name).toBe(true)
    }
  })

  it('모든 테마에서 focus 된 pane 헤더는 focus 안 된 pane 헤더와 같은 대비로 구별되고, 밝은 테마는 흰색에서 멈춘다', () => {
    for (const name of themeNames()) {
      const theme = themeNamed(name)!
      const ui = uiColors(theme)
      const away = isLight(theme) ? '#ffffff' : theme.foreground
      const target = Math.min(FOCUSED_HEADER_CONTRAST, contrast(away, ui.hdr))
      expect(near(contrast(ui.hdrFocus, ui.hdr), target), name).toBe(true)
    }
  })

  it('모든 테마에서 pane 경계선은 터미널·focus 안 된 pane 헤더·focus 된 pane 헤더와 구별된다', () => {
    for (const name of themeNames()) {
      const ui = uiColors(themeNamed(name)!)
      for (const surface of [ui.ground, ui.hdr, ui.hdrFocus])
        expect(contrast(ui.paneLine, surface), name).toBeGreaterThanOrEqual(PANE_LINE_CONTRAST)
    }
  })
})

describe('sameThemeChoice·activeTheme', () => {
  const latte = themeNamed('Catppuccin Latte')!
  const mocha = themeNamed('Catppuccin Mocha')!
  const pair = { kind: 'pair', light: latte, dark: mocha } as const

  it('종류와 테마 객체가 같을 때만 같다', () => {
    expect(sameThemeChoice(DEFAULT_THEME, { kind: 'one', theme: GHOSTTY })).toBe(true)
    expect(sameThemeChoice(DEFAULT_THEME, { kind: 'one', theme: mocha })).toBe(false)
    expect(sameThemeChoice({ kind: 'one', theme: mocha }, { ...pair, light: mocha })).toBe(false)
    expect(sameThemeChoice(pair, { kind: 'pair', light: latte, dark: mocha })).toBe(true)
    expect(sameThemeChoice(pair, { kind: 'pair', light: mocha, dark: latte })).toBe(false)
  })

  it('하나면 모드와 상관없이 그 테마, 짝이면 모드의 테마다', () => {
    expect(activeTheme({ kind: 'one', theme: mocha }, false)).toBe(mocha)
    expect(activeTheme({ kind: 'one', theme: mocha }, true)).toBe(mocha)
    expect(activeTheme(pair, false)).toBe(latte)
    expect(activeTheme(pair, true)).toBe(mocha)
  })

  it('창 틀은 테마 하나면 그 배경의 밝기, 짝이면 system 이다', () => {
    expect(windowTheme(DEFAULT_THEME, true)).toEqual({ background: '#282c34', mode: 'dark' })
    expect(windowTheme({ kind: 'one', theme: latte }, true)).toEqual({
      background: latte.background,
      mode: 'light'
    })
    expect(windowTheme(pair, false)).toEqual({ background: latte.background, mode: 'system' })
    expect(windowTheme(pair, true)).toEqual({ background: mocha.background, mode: 'system' })
  })
})
