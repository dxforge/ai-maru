import DOMPurify from 'dompurify'
import { Marked, type Token, type Tokens } from 'marked'

// 문서 안의 이미지는 띄우지 않고 대체 텍스트만 남긴다 — 원격 주소는 CSP 가 막아 깨진 그림이 되고,
// 상대 경로는 기준이 될 디렉토리를 받지 않는다.
const marked = new Marked({
  renderer: {
    image({ text }) {
      return this.text({ type: 'text', raw: text, text })
    }
  }
})

export function renderMarkdown(text: string): string {
  // 패널 안의 HTML 이지만 스타일은 문서 전체에 걸려 터미널을 가리거나 덮을 수 있다.
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    FORBID_TAGS: ['style', 'img'],
    FORBID_ATTR: ['style']
  })
}

export function firstHeading(text: string): string | undefined {
  const heading = marked.lexer(text).find((t) => t.type === 'heading') as Tokens.Heading | undefined
  return heading && plainText(heading.tokens)
}

function plainText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if ('tokens' in t && t.tokens) return plainText(t.tokens)
      return t.type === 'text' || t.type === 'codespan' || t.type === 'escape' ? t.text : ''
    })
    .join('')
}
