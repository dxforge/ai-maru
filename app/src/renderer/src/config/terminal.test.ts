import { describe, expect, it } from 'vitest'
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
      header: 'bottom',
      names: [],
      warnings: []
    })
    expect(DEFAULT_FONT).toEqual({ fontFamily: FAMILY, fontSize: 14, lineHeight: 1.2 })
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

  it.each(['top', 'bottom'] as const)('layout.header 를 읽는다: %s', (value) => {
    const r = ok(`[layout]\nheader = "${value}"\n`)
    expect(r.header).toBe(value)
    expect(r.warnings).toEqual([])
  })

  it.each(['"Top"', '"left"', '1', 'true'])(
    'layout.header 가 top·bottom 이 아니면 bottom 을 쓴다: %s',
    (value) => {
      const r = ok(`[layout]\nheader = ${value}\n`)
      expect(r.header).toBe('bottom')
      expect(r.warnings).toEqual(['layout.header must be "top" or "bottom", using bottom.'])
    }
  )

  it('layout 이 표가 아니면 기본값을 쓴다', () => {
    const r = ok('layout = "top"\n')
    expect(r.header).toBe('bottom')
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
