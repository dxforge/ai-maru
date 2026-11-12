import { describe, expect, it } from 'vitest'
import { highlightCode, languageFor, tokensHtml } from './highlight'

describe('languageFor', () => {
  it('확장자를 shiki 의 언어 id·alias 로 찾고, 대소문자를 가리지 않는다', () => {
    expect(languageFor('a.ts')).toBe('typescript')
    expect(languageFor('a.MTS')).toBe('typescript')
    expect(languageFor('a.rs')).toBe('rust')
    expect(languageFor('x.config.yml')).toBe('yaml')
    expect(languageFor('a.zsh')).toBe('shellscript')
  })

  it('shiki 에 없는 C·C++ 헤더 확장자도 고른다', () => {
    expect(languageFor('a.h')).toBe('c')
    expect(languageFor('a.hpp')).toBe('cpp')
    expect(languageFor('a.cc')).toBe('cpp')
  })

  it('확장자가 없으면 파일 이름으로 고르고, 모르면 null 이다', () => {
    expect(languageFor('Makefile')).toBe('make')
    expect(languageFor('Dockerfile')).toBe('docker')
    expect(languageFor('notes.txt')).toBeNull()
    expect(languageFor('LICENSE')).toBeNull()
    expect(languageFor('.gitignore')).toBeNull()
  })
})

describe('tokensHtml', () => {
  it('글자와 style 을 escape 하고, 줄은 줄바꿈으로 잇는다', () => {
    const html = tokensHtml([
      [{ content: '<a>&', offset: 0, htmlStyle: { '--shiki-light': '#111', color: '"x' } }],
      [],
      [{ content: 'b', offset: 0 }]
    ])
    expect(html).toBe(
      '<span style="--shiki-light:#111;color:&quot;x">&lt;a&gt;&amp;</span>\n\n<span style="">b</span>'
    )
  })
})

describe('highlightCode', () => {
  it('아는 언어는 라이트·다크 색을 함께 단 HTML 이고, 줄 수가 글자와 같다', async () => {
    const html = (await highlightCode('const a = "<"\nlet b = 1', 'a.ts'))!
    expect(html.split('\n')).toHaveLength(2)
    expect(html).toContain('--shiki-light:')
    expect(html).toContain('--shiki-dark:')
    expect(html).toContain('"&lt;"')
  })

  it('모르는 언어면 null 이다', async () => {
    expect(await highlightCode('x', 'notes.txt')).toBeNull()
  })
})
