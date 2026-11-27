import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isMermaidPath, mermaidDoc, mermaidSource } from './canvas'

describe('mermaidSource', () => {
  it('mermaidDoc 이 감싼 원문을 그대로 꺼낸다', () => {
    expect(mermaidSource(mermaidDoc('graph LR\n  a --> b\n'))).toBe('graph LR\n  a --> b\n')
  })

  it('원문에 backtick 펜스가 있어도 원문을 꺼낸다', () => {
    const source = 'graph LR\n```\na["`x`"]\n````'
    expect(mermaidSource(mermaidDoc(source))).toBe(`${source}\n`)
  })

  it('감싼 모양이 아니면 받은 그대로다', () => {
    expect(mermaidSource('# title\n')).toBe('# title\n')
    expect(mermaidSource('```mermaid\ngraph LR\n```\nmore\n')).toBe(
      '```mermaid\ngraph LR\n```\nmore\n'
    )
  })

  it('끝 줄바꿈이 있는 원문은 감쌌다 꺼내면 원래 원문이고, 없는 원문은 줄바꿈 하나가 붙는다', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('`', 'a', '\n', ' ', 'm') }), (source) => {
        const expected = source.endsWith('\n') ? source : `${source}\n`
        expect(mermaidSource(mermaidDoc(source))).toBe(expected)
      })
    )
  })
})

describe('isMermaidPath', () => {
  it('.mmd·.mermaid 는 대소문자와 상관없이 mermaid 파일이다', () => {
    expect(isMermaidPath('/a/flow.mmd')).toBe(true)
    expect(isMermaidPath('/a/FLOW.Mermaid')).toBe(true)
    expect(isMermaidPath('/a/notes.md')).toBe(false)
    expect(isMermaidPath('/a/mmd')).toBe(false)
    expect(isMermaidPath('/a/.mmd')).toBe(false)
    expect(isMermaidPath('/a/..mmd')).toBe(true)
  })
})
