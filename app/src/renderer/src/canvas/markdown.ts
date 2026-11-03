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

// 문서 안의 HTML 은 아래 목록의 태그·속성만 남긴다. 빼야 할 것이 앱 CSS 가 걸리는 class 말고도 브라우저가
// 패널 밖 창 위에 띄우는 `popover` 속성·`dialog` 태그까지 여러 갈래라, 나열하면 하나를 빠뜨리기 쉽기 때문이다.
const ALLOWED_TAGS = [
  // `marked` 가 markdown 에서 만드는 태그
  ...['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'br'],
  ...['ul', 'ol', 'li', 'input', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  ...['a', 'em', 'strong', 'del'],
  // markdown 에 없어 HTML 로 적는 글자 꾸밈·접기
  ...['kbd', 'sub', 'sup', 'mark', 's', 'ins', 'b', 'i', 'details', 'summary']
]
// `type`·`checked`·`disabled` 는 작업 목록의 checkbox, `align` 은 표 정렬, `start` 는 번호 목록의 시작 번호다.
// `href` 의 `javascript:` 같은 주소는 DOMPurify 의 기본 URI 검사가 지운다.
const ALLOWED_ATTR = [
  'href',
  'title',
  'class',
  'align',
  'start',
  'type',
  'checked',
  'disabled',
  'open'
]

let purify: typeof DOMPurify | undefined

// 처음 그릴 때 만든다. DOM 이 없는 환경(`store.ts` 를 읽는 node 테스트)에서는 hook 을 달 수 없기 때문이다.
function sanitizer(): typeof DOMPurify {
  if (purify) return purify
  purify = DOMPurify()
  // `class` 는 코드 블록의 `language-*` 만 남긴다. 앱의 class 를 붙이면 앱 CSS 가 걸리기 때문이다.
  purify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'class') return
    data.keepAttr = node.nodeName === 'CODE' && /^language-\S+$/.test(data.attrValue)
  })
  // `input` 은 작업 목록(`- [ ]`)이 만드는 비활성 checkbox 만 남긴다.
  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'input') return
    const el = node as Element
    if (el.getAttribute('type') !== 'checkbox' || !el.hasAttribute('disabled')) el.remove()
  })
  return purify
}

export function renderMarkdown(text: string): string {
  return sanitizer().sanitize(marked.parse(text, { async: false }), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
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
