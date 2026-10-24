import { describe, expect, it } from 'vitest'
import { GHOSTTY } from '../../../shared/theme'
import { DEFAULT_THEME, themeNamed } from '../themes'
import { DEFAULT_LAYOUT } from './layout'
import { DEFAULT_FONT, fontNames, fontSizeOverride, parseConfig, stepFontSize } from './terminal'

const FAMILY = "D2Coding, Menlo, 'Symbols Nerd Font Mono', monospace"

function ok(text: string) {
  const r = parseConfig(text)
  if (!r.ok) throw new Error(r.problem)
  return r
}

describe('parseConfig', () => {
  it('빈 문자열은 기본값이고 경고가 없다', () => {
    expect(parseConfig('')).toEqual({
      ok: true,
      font: DEFAULT_FONT,
      theme: DEFAULT_THEME,
      layout: DEFAULT_LAYOUT,
      names: [],
      warnings: []
    })
    expect(DEFAULT_THEME).toEqual({ kind: 'one', theme: GHOSTTY })
    expect(DEFAULT_FONT).toEqual({ fontFamily: FAMILY, fontSize: 14, lineHeight: 1.2 })
    expect(DEFAULT_LAYOUT).toEqual({ header: 'bottom', palette: 'bottom', columnCols: 80 })
  })

  it('세 키를 읽는다', () => {
    const r = ok('[terminal]\nfont-family = "JetBrains Mono"\nfont-size = 13\nline-height = 1.3\n')
    expect(r.font).toEqual({
      fontFamily: `'JetBrains Mono', ${FAMILY}`,
      fontSize: 13,
      lineHeight: 1.3
    })
    expect(r.names).toEqual(['JetBrains Mono'])
    expect(r.warnings).toEqual([])
  })

  it('쉼표 목록과 따옴표를 받는다', () => {
    const r = ok(`[terminal]\nfont-family = "'JetBrains Mono', \\"Sarasa Term K\\" "\n`)
    expect(r.names).toEqual(['JetBrains Mono', 'Sarasa Term K'])
    expect(r.font.fontFamily).toBe(`'JetBrains Mono', 'Sarasa Term K', ${FAMILY}`)
  })

  it('CSS generic family 키워드는 따옴표 없이 넣는다', () => {
    const r = ok(`[terminal]\nfont-family = "ui-monospace, Menlo, 'Monospace', system-ui"\n`)
    expect(r.font.fontFamily).toBe(`ui-monospace, 'Menlo', Monospace, system-ui, ${FAMILY}`)
    expect(r.names).toEqual(['ui-monospace', 'Menlo', 'Monospace', 'system-ui'])
  })

  // TOML 의 basic string 안이라 `\\n`·`\\t` 는 줄바꿈·탭이 된다.
  it.each(['Ha\\"ck', 'A;B', 'A\\\\B', 'A,,B', '  ', "'A", 'Menlo\\nX', 'A\\tB', '\\"A\\nB\\"'])(
    '받지 않는 문자나 빈 이름이 있으면 기본 글꼴을 쓴다: %s',
    (value) => {
      const r = ok(`[terminal]\nfont-family = "${value}"\n`)
      expect(r.font.fontFamily).toBe(FAMILY)
      expect(r.names).toEqual([])
      expect(r.warnings).toEqual([
        `terminal.font-family can't contain " ' ; \\, control characters or empty names, using the default.`
      ])
    }
  )

  it('삼중 따옴표 문자열의 줄바꿈도 받지 않는다', () => {
    expect(ok('[terminal]\nfont-family = """Menlo\nX"""\n').font.fontFamily).toBe(FAMILY)
  })

  it.each([
    ['font-size = 40', { fontSize: 32 }, 'terminal.font-size = 40 is outside 8–32, using 32.'],
    ['font-size = 4', { fontSize: 8 }, 'terminal.font-size = 4 is outside 8–32, using 8.'],
    ['line-height = 0.5', { lineHeight: 1 }, 'terminal.line-height = 0.5 is outside 1–2, using 1.'],
    ['line-height = 3', { lineHeight: 2 }, 'terminal.line-height = 3 is outside 1–2, using 2.']
  ])('범위를 벗어나면 끝값을 쓴다: %s', (line, font, warning) => {
    const r = ok(`[terminal]\n${line}\n`)
    expect(r.font).toEqual({ ...DEFAULT_FONT, ...font })
    expect(r.warnings).toEqual([warning])
  })

  it.each(['"13"', 'nan', 'inf', '-inf', 'true'])('숫자가 아니면 기본 크기를 쓴다: %s', (value) => {
    const r = ok(`[terminal]\nfont-size = ${value}\nline-height = ${value}\n`)
    expect(r.font).toEqual(DEFAULT_FONT)
    expect(r.warnings).toEqual([
      'terminal.font-size must be a number, using 14.',
      'terminal.line-height must be a number, using 1.2.'
    ])
  })

  it('글꼴이 문자열이 아니면 기본 글꼴을 쓴다', () => {
    const r = ok('[terminal]\nfont-family = 13\n')
    expect(r.font.fontFamily).toBe(FAMILY)
    expect(r.warnings).toEqual(['terminal.font-family must be a string, using the default.'])
  })

  it('소수 크기를 받는다', () => {
    expect(ok('[terminal]\nfont-size = 13.5\n').font.fontSize).toBe(13.5)
  })

  it('모르는 키를 알린다', () => {
    expect(ok('[terminal]\nfont_size = 13\n').warnings).toEqual(['Unknown key terminal.font_size.'])
    expect(ok('[ui]\nx = 1\n').warnings).toEqual(['Unknown key ui.'])
    expect(ok('title = "x"\n').warnings).toEqual(['Unknown key title.'])
    expect(ok('[constructor]\nx = 1\n').warnings).toEqual(['Unknown key constructor.'])
    expect(ok('[layout]\nheader-position = "top"\n').warnings).toEqual([
      'Unknown key layout.header-position.'
    ])
  })

  it('terminal.theme 에 적은 이름의 테마를 쓴다', () => {
    const r = ok('[terminal]\ntheme = "Catppuccin Mocha"\n')
    expect(r.theme).toEqual({ kind: 'one', theme: themeNamed('Catppuccin Mocha') })
    expect(r.theme.kind === 'one' && r.theme.theme.background).toBe('#1e1e2e')
    expect(r.warnings).toEqual([])
  })

  it('terminal.theme 의 이름은 대소문자·공백까지 맞아야 한다', () => {
    const r = ok('[terminal]\ntheme = "catppuccin mocha"\n')
    expect(r.theme).toBe(DEFAULT_THEME)
    expect(r.warnings).toEqual([
      'terminal.theme: no theme named "catppuccin mocha", using the default.'
    ])
  })

  it('terminal.theme 에 light·dark 를 적으면 짝이 된다', () => {
    const r = ok('[terminal]\ntheme = { light = "Catppuccin Latte", dark = "Catppuccin Mocha" }\n')
    expect(r.theme).toEqual({
      kind: 'pair',
      light: themeNamed('Catppuccin Latte'),
      dark: themeNamed('Catppuccin Mocha')
    })
    expect(r.warnings).toEqual([])
  })

  const FORM =
    'terminal.theme must be a theme name or { light = "…", dark = "…" }, using the default.'

  it.each([
    ['{ light = "Catppuccin Latte" }', FORM],
    ['{ dark = "Catppuccin Mocha" }', FORM],
    ['{ light = "Catppuccin Latte", dark = 3 }', FORM],
    ['13', FORM],
    ['["Catppuccin Mocha"]', FORM],
    [
      '{ light = "Nope", dark = "Catppuccin Mocha" }',
      'terminal.theme.light: no theme named "Nope", using the default.'
    ],
    [
      '{ light = "Catppuccin Latte", dark = "Nope" }',
      'terminal.theme.dark: no theme named "Nope", using the default.'
    ]
  ])('terminal.theme 이 이름도 light·dark 짝도 아니면 기본 테마를 쓴다: %s', (value, warning) => {
    const r = ok(`[terminal]\ntheme = ${value}\n`)
    expect(r.theme).toBe(DEFAULT_THEME)
    expect(r.warnings).toEqual([warning])
  })

  it('terminal.theme 의 짝에서 둘 다 모르는 이름이면 둘 다 알린다', () => {
    const r = ok('[terminal]\ntheme = { light = "A", dark = "B" }\n')
    expect(r.warnings).toEqual([
      'terminal.theme.light: no theme named "A", using the default.',
      'terminal.theme.dark: no theme named "B", using the default.'
    ])
  })

  it('terminal.theme 의 짝에 모르는 키가 있으면 알리고 짝은 쓴다', () => {
    const r = ok(
      '[terminal]\ntheme = { light = "Catppuccin Latte", dark = "Catppuccin Mocha", dim = "x" }\n'
    )
    expect(r.theme.kind).toBe('pair')
    expect(r.warnings).toEqual(['Unknown key terminal.theme.dim.'])
  })

  it.each(['header', 'palette'] as const)('layout.%s 를 따로 읽는다', (key) => {
    const r = ok(`[layout]\n${key} = "top"\n`)
    expect(r.layout).toEqual({ ...DEFAULT_LAYOUT, [key]: 'top' })
    expect(r.warnings).toEqual([])
  })

  it.each(['"Top"', '"left"', '1', 'true', '["top"]'])(
    'layout.header·palette 가 top·bottom 이 아니면 bottom 을 쓴다: %s',
    (value) => {
      const r = ok(`[layout]\nheader = ${value}\npalette = ${value}\n`)
      expect(r.layout).toEqual(DEFAULT_LAYOUT)
      expect(r.warnings).toEqual([
        'layout.header must be "top" or "bottom", using bottom.',
        'layout.palette must be "top" or "bottom", using bottom.'
      ])
    }
  )

  it.each([20, 100, 144, 500])(
    'layout.column-cols = %i 는 그대로 읽고 알리지 않는다 — 80·110·144 밖의 값과 범위 끝도',
    (value) => {
      const r = ok(`[layout]\ncolumn-cols = ${value}\n`)
      expect(r.layout.columnCols).toBe(value)
      expect(r.warnings).toEqual([])
    }
  )

  it.each([
    [10, 20],
    [19, 20],
    [501, 500],
    [10000, 500]
  ])('layout.column-cols = %i 는 20–500 으로 맞추고 알린다', (value, clamped) => {
    const r = ok(`[layout]\ncolumn-cols = ${value}\n`)
    expect(r.layout.columnCols).toBe(clamped)
    expect(r.warnings).toEqual([
      `layout.column-cols = ${value} is outside 20–500, using ${clamped}.`
    ])
  })

  it.each(['100.5', '"100"', 'true', '[100]', 'inf', 'nan'])(
    'layout.column-cols 가 정수가 아니면 80 을 쓴다: %s',
    (value) => {
      const r = ok(`[layout]\ncolumn-cols = ${value}\n`)
      expect(r.layout.columnCols).toBe(80)
      expect(r.warnings).toEqual(['layout.column-cols must be an integer, using 80.'])
    }
  )

  it('layout 이 표가 아니면 기본값을 쓴다', () => {
    const r = ok('layout = "top"\n')
    expect(r.layout).toEqual(DEFAULT_LAYOUT)
    expect(r.warnings).toEqual(['layout must be a table, using the defaults.'])
  })

  it('terminal 이 표가 아니면 기본값을 쓴다', () => {
    const r = ok('terminal = 1\n')
    expect(r.font).toEqual(DEFAULT_FONT)
    expect(r.warnings).toEqual(['terminal must be a table, using the defaults.'])
  })

  it('문법 오류는 줄과 열을 준다', () => {
    expect(parseConfig('[terminal]\nfont-size =\n')).toEqual({
      ok: false,
      problem: 'Line 2, column 12: invalid value'
    })
  })

  it('BOM 과 CRLF 를 읽는다', () => {
    const r = ok('﻿[terminal]\r\nfont-size = 13\r\n')
    expect(r.font.fontSize).toBe(13)
    expect(r.warnings).toEqual([])
  })
})

describe('fontNames', () => {
  it('이름마다 공백과 양끝의 같은 따옴표를 걷어 낸다', () => {
    expect(fontNames(` "A B" , 'C',D `)).toEqual(['A B', 'C', 'D'])
  })

  it('양끝이 다른 따옴표는 걷어 내지 않아 받지 않는다', () => {
    expect(fontNames(`"A'`)).toBeNull()
  })
})

describe('stepFontSize', () => {
  it('1px 씩 키우고 줄이며, 소수 크기도 1px 씩 움직인다', () => {
    expect(stepFontSize(14, 1)).toBe(15)
    expect(stepFontSize(14, -1)).toBe(13)
    expect(stepFontSize(13.5, 1)).toBe(14.5)
  })

  it('설정 파일의 font-size 와 같은 8–32 를 넘지 않는다', () => {
    expect(stepFontSize(8, -1)).toBe(8)
    expect(stepFontSize(32, 1)).toBe(32)
    expect(stepFontSize(8.5, -1)).toBe(8)
    expect(stepFontSize(31.5, 1)).toBe(32)
  })
})

describe('fontSizeOverride', () => {
  it('설정 파일의 크기와 다르면 그 크기를, 같으면 undefined 를 준다', () => {
    expect(fontSizeOverride(15, 14)).toBe(15)
    expect(fontSizeOverride(14, 14)).toBeUndefined()
  })

  it('소수 크기에서 1px 씩 오가며 쌓인 오차는 같은 크기로 본다', () => {
    let size = 13.1
    for (let i = 0; i < 5; i++) size = stepFontSize(size, 1)
    for (let i = 0; i < 5; i++) size = stepFontSize(size, -1)
    expect(size).not.toBe(13.1)
    expect(fontSizeOverride(size, 13.1)).toBeUndefined()
    expect(fontSizeOverride(stepFontSize(stepFontSize(15.15, 1), -1), 15.15)).toBeUndefined()
  })
})
