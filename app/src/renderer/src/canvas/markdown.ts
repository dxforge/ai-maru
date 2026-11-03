import DOMPurify from 'dompurify'
import { decodeHTML, escapeUTF8 } from 'entities'
import { Marked, Renderer, Tokenizer, type Token, type Tokens } from 'marked'

// 문서 안의 이미지는 띄우지 않고 대체 텍스트만 남긴다 — 원격 주소는 CSP 가 막아 깨진 그림이 되고,
// 상대 경로는 기준이 될 디렉토리를 받지 않는다.
// 문서 안의 HTML 은 요소로 만들지 않고 적힌 글자 그대로 보인다. 패널 안에 그려도 앱의 class·전역
// CSS 가 걸려 창 전체를 덮거나, 앱 UI 처럼 보이는 입력창을 만들 수 있기 때문이다.
const marked = new Marked({
  tokenizer: {
    // `marked` 는 `<kbd>`·`<code>`·`<pre>`·`<script>` 태그 뒤의 글자를 escape 하지 않고 내보낸다.
    // 태그를 글자로 그리므로 태그가 lexer 상태를 바꾸지 않게 한다.
    tag(src) {
      const { inLink, inRawBlock } = this.lexer.state
      const token = Tokenizer.prototype.tag.call(this, src)
      Object.assign(this.lexer.state, { inLink, inRawBlock })
      return token
    }
  },
  renderer: {
    image({ text }) {
      return this.text({ type: 'text', raw: text, text })
    },
    html({ text, block }) {
      return block ? `<p>${escapeUTF8(text.trimEnd())}</p>\n` : escapeUTF8(text)
    }
  }
})

export function renderMarkdown(text: string): string {
  // `marked` 는 `[x](javascript:…)` 링크도 href 를 그대로 둔 a 요소로 만들므로, DOMPurify 가 그 href 를 지운다.
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
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
      return t.type === 'codespan' || t.type === 'escape' || t.type === 'html' ? t.text : ''
    })
    .join('')
}
