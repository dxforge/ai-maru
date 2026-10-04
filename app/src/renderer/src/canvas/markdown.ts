import DOMPurify from 'dompurify'
import { decodeHTML } from 'entities'
import { Marked, Renderer, type Token, type Tokens } from 'marked'

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
  // dialog·popover 는 패널이 아니라 창을 기준으로 떠서 터미널 위에 겹친다.
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    FORBID_TAGS: ['style', 'img', 'dialog'],
    FORBID_ATTR: ['style', 'popover', 'popovertarget']
  })
}

export function firstHeading(text: string): string | undefined {
  const heading = marked.lexer(text).find((t) => t.type === 'heading') as Tokens.Heading | undefined
  return heading && plainText(heading.tokens)
}

const textRenderer = new Renderer()

function plainText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if ('tokens' in t && t.tokens) return plainText(t.tokens)
      // 본문 글자는 marked 가 text 토큰을 escape 한 HTML 을 브라우저가 푼 것이라 같은 두 단계를 거친다.
      // escape 를 건너뛰면 marked 가 &amp; 로 바꿔 둔 세미콜론 없는 참조까지 풀린다.
      if (t.type === 'text') return decodeHTML(textRenderer.text(t as Tokens.Text))
      return t.type === 'codespan' || t.type === 'escape' ? t.text : ''
    })
    .join('')
}
