import { describe, expect, it } from 'vitest'
import { configToast, createConfig, type ConfigReport } from './store'
import { DEFAULT_THEME, themeNamed } from '../themes'
import { DEFAULT_LAYOUT } from './layout'
import { DEFAULT_FONT } from './terminal'

const PATH = '/h/.ai-maru/config.toml'

function setup(text: string | null) {
  const reports: ConfigReport[] = []
  const config = createConfig({ path: PATH, text }, (r) => reports.push(r))
  return { config, reports }
}

describe('createConfig', () => {
  it('파일이 없으면 기본값이고 알릴 것이 없다', () => {
    const { config, reports } = setup(null)
    expect(config.font.value).toEqual(DEFAULT_FONT)
    expect(reports).toEqual([{ path: PATH, first: true, warnings: [], names: [] }])
  })

  it('읽은 값을 쓰고, 문법 오류면 앞의 값을 둔다', () => {
    const { config, reports } = setup('[terminal]\nfont-size = 18\n')
    expect(config.font.value.fontSize).toBe(18)
    config.apply({ path: PATH, text: '[terminal]\nfont-size =\n' })
    expect(config.font.value.fontSize).toBe(18)
    expect(reports.at(-1)!.problem).toMatch(/^Line 2/)
  })

  it('읽기 오류면 앞의 값을 두고 그 메시지를 알린다', () => {
    const { config, reports } = setup('[terminal]\nfont-size = 18\n')
    config.apply({ path: PATH, text: null, error: 'EISDIR: illegal operation on a directory' })
    expect(config.font.value.fontSize).toBe(18)
    expect(reports.at(-1)!.problem).toBe('EISDIR: illegal operation on a directory')
  })

  it('파일이 지워지면 기본값으로 돌아간다', () => {
    const { config } = setup('[terminal]\nfont-size = 18\n')
    config.apply({ path: PATH, text: null })
    expect(config.font.value).toEqual(DEFAULT_FONT)
  })

  it('띄울 때 문법 오류면 헤더와 팔레트는 아래다', () => {
    expect(setup('[layout\n').config.layout.value).toEqual(DEFAULT_LAYOUT)
  })

  it('헤더·팔레트 위치를 읽고, 문법 오류면 앞의 값을 두며, 파일이 지워지면 아래로 돌아간다', () => {
    const { config } = setup('[layout]\nheader = "top"\npalette = "top"\n')
    expect(config.layout.value).toEqual({ ...DEFAULT_LAYOUT, header: 'top', palette: 'top' })
    config.apply({ path: PATH, text: '[layout]\nheader =\n' })
    expect(config.layout.value).toEqual({ ...DEFAULT_LAYOUT, header: 'top', palette: 'top' })
    config.apply({ path: PATH, text: null })
    expect(config.layout.value).toEqual(DEFAULT_LAYOUT)
  })

  it('column-cols 만 바뀌어도 layout 을 바꾼다', () => {
    const { config } = setup('[layout]\nheader = "top"\n')
    const before = config.layout.value
    config.apply({ path: PATH, text: '[layout]\nheader = "top"\ncolumn-cols = 100\n' })
    expect(config.layout.value).not.toBe(before)
    expect(config.layout.value).toEqual({ ...before, columnCols: 100 })
  })

  it('column-step 만 바뀌어도 layout 을 바꾼다', () => {
    const { config } = setup('[layout]\nheader = "top"\n')
    const before = config.layout.value
    config.apply({ path: PATH, text: '[layout]\nheader = "top"\ncolumn-step = 10\n' })
    expect(config.layout.value).not.toBe(before)
    expect(config.layout.value).toEqual({ ...before, columnStep: 10 })
  })

  it('같은 값이면 layout 을 바꾸지 않는다', () => {
    const { config } = setup('[layout]\nheader = "top"\n')
    const before = config.layout.value
    config.apply({ path: PATH, text: '[layout]\nheader = "top"\n' })
    expect(config.layout.value).toBe(before)
  })

  it('테마를 읽고, 문법 오류면 앞의 값을 두며, 파일이 지워지면 기본 테마로 돌아간다', () => {
    const { config } = setup('[terminal]\ntheme = "Catppuccin Mocha"\n')
    const mocha = { kind: 'one', theme: themeNamed('Catppuccin Mocha') }
    expect(config.theme.value).toEqual(mocha)
    config.apply({ path: PATH, text: '[terminal]\ntheme =\n' })
    expect(config.theme.value).toEqual(mocha)
    config.apply({ path: PATH, text: null })
    expect(config.theme.value).toEqual(DEFAULT_THEME)
  })

  it('같은 테마면 theme 을 바꾸지 않고, 짝의 한쪽만 바뀌어도 바꾼다', () => {
    const pair = '[terminal]\ntheme = { light = "Catppuccin Latte", dark = "Catppuccin Mocha" }\n'
    const { config } = setup(pair)
    const before = config.theme.value
    config.apply({ path: PATH, text: pair })
    expect(config.theme.value).toBe(before)
    config.apply({
      path: PATH,
      text: '[terminal]\ntheme = { light = "Catppuccin Latte", dark = "Catppuccin Frappe" }\n'
    })
    expect(config.theme.value).not.toBe(before)
    expect(config.theme.value.kind === 'pair' && config.theme.value.dark).toEqual(
      themeNamed('Catppuccin Frappe')
    )
  })

  it('같은 값이면 font 를 바꾸지 않는다', () => {
    const { config } = setup('[terminal]\nfont-size = 18\n')
    const before = config.font.value
    config.apply({ path: PATH, text: '[terminal]\nfont-size = 18\n' })
    expect(config.font.value).toBe(before)
  })
})

describe('configToast', () => {
  const report: ConfigReport = { path: PATH, first: false, warnings: [], names: [] }

  it('알릴 것이 없으면 null', () => {
    expect(configToast(report, [], '~/x')).toBeNull()
  })

  it('문제가 있으면 오류 토스트', () => {
    expect(
      configToast({ ...report, problem: 'Line 2, column 12: invalid value' }, [], '~/x')
    ).toEqual({
      level: 'error',
      title: "Couldn't read config.toml",
      lines: ['Line 2, column 12: invalid value', 'Kept the previous settings.'],
      detail: '~/x'
    })
  })

  it('처음 읽을 때의 문제면 기본값을 쓴다고 알린다', () => {
    expect(configToast({ ...report, first: true, problem: 'x' }, [], '~/x')!.lines).toEqual([
      'x',
      'Using the default settings.'
    ])
  })

  it('경고와 없는 글꼴은 한 경고 토스트에 잇는다', () => {
    expect(configToast({ ...report, warnings: ['Unknown key ui.'] }, ['Foo'], '~/x')).toEqual({
      level: 'warning',
      title: 'Applied config.toml with warnings',
      lines: ['Unknown key ui.', 'Font "Foo" is not available.'],
      detail: '~/x'
    })
  })
})
