import { describe, expect, it } from 'vitest'
import { parseGhosttyTheme } from './ghostty'

const PALETTE = Array.from({ length: 16 }, (_, i) => `palette = ${i}=#${i.toString(16).repeat(6)}`)
const PALETTE_TEXT = PALETTE.join('\n')
const MOCHA = `${PALETTE_TEXT}
background = #1e1e2e
foreground = #cdd6f4
cursor-color = #f5e0dc
cursor-text = #1e1e2e
selection-background = #585b70
selection-foreground = #cdd6f4
`

describe('parseGhosttyTheme', () => {
  it('팔레트 16색과 배경·글자·커서·선택 색을 읽는다', () => {
    const t = parseGhosttyTheme(MOCHA)!
    expect(t.ansi).toHaveLength(16)
    expect(t.ansi[0]).toBe('#000000')
    expect(t.ansi[15]).toBe('#ffffff')
    expect(t).toMatchObject({
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorText: '#1e1e2e',
      selectionBackground: '#585b70',
      selectionForeground: '#cdd6f4'
    })
  })

  it('팔레트 줄은 순서와 상관없이 번호 자리에 둔다', () => {
    const reversed = [...PALETTE].reverse().join('\n')
    const t = parseGhosttyTheme(`${reversed}\nbackground = #000000\nforeground = #ffffff\n`)!
    expect(t.ansi[1]).toBe('#111111')
  })

  it('커서·선택 색은 없어도 된다', () => {
    const t = parseGhosttyTheme(`${PALETTE_TEXT}\nbackground = #000000\nforeground = #ffffff\n`)!
    expect(t.cursor).toBeUndefined()
    expect(t.selectionBackground).toBeUndefined()
  })

  it('= 둘레의 공백이 없거나 #이 빠지거나 대문자여도 읽고, 색은 #rrggbb 소문자로 맞춘다', () => {
    const t = parseGhosttyTheme(
      `${PALETTE_TEXT}\nbackground= 1E1E2E\nforeground =#CDD6F4\n\n# a comment\n`
    )!
    expect(t.background).toBe('#1e1e2e')
    expect(t.foreground).toBe('#cdd6f4')
  })

  it('모르는 키와 = 가 없는 줄은 값이 무엇이든 지나간다', () => {
    const text = `${PALETTE_TEXT}\nbackground = #000000\nforeground = #ffffff\ncursor-style = bar\nnonsense\n`
    expect(parseGhosttyTheme(text)).not.toBeNull()
  })

  it.each([
    ['배경이 없다', `${PALETTE_TEXT}\nforeground = #ffffff\n`],
    [
      '팔레트가 15색이다',
      `${PALETTE.slice(0, 15).join('\n')}\nbackground = #000000\nforeground = #ffffff\n`
    ],
    [
      '팔레트 번호가 16이다',
      `${PALETTE_TEXT}\npalette = 16=#000000\nbackground = #000000\nforeground = #ffffff\n`
    ],
    ['색이 아니다', `${PALETTE_TEXT}\nbackground = red\nforeground = #ffffff\n`],
    [
      '커서 색이 색이 아니다',
      `${PALETTE_TEXT}\nbackground = #000000\nforeground = #ffffff\ncursor-color = none\n`
    ],
    [
      '팔레트 값이 N=#rrggbb 가 아니다',
      `${PALETTE.slice(1).join('\n')}\npalette = #000000\nbackground = #000000\nforeground = #ffffff\n`
    ]
  ])('빠지거나 틀리면 null 이다: %s', (_name, text) => {
    expect(parseGhosttyTheme(text)).toBeNull()
  })
})
