import DOMPurify from 'dompurify'
import { decodeHTML, escapeText } from 'entities'
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

// 묶음 하나를 HTML 로 만들어 붙이는 데 50 ms 안팎이 걸리는 크기다(100 KB 문서의 parse·sanitize·삽입을 잰 값).
const PART_SIZE = 100_000

/** 차례로 렌더해 이어 붙일 문서의 한 묶음. lexing 하지 못한 문서는 원문을 글자 그대로 나눈 것이다. */
export type Part = { tokens: Token[] } | { text: string }

export type Prepared = { heading: string | undefined; parts: Part[] }

/**
 * 문서를 한 번 lexing 해 첫 heading 과 렌더할 묶음을 낸다. 묶음은 최상위 블록 경계에서 나누므로 코드 블록·표가
 * 묶음 사이에서 잘리지 않는다. 참조형 링크는 lexing 할 때 이미 주소로 풀리므로 묶음마다
 * 따로 렌더해도 된다.
 */
export function prepareMarkdown(text: string, size = PART_SIZE): Prepared {
  let tokens: Token[]
  try {
    tokens = marked.lexer(text)
  } catch {
    // 아주 긴 문단은 marked 의 정규식이 호출 스택을 넘겨 던지므로, 문서를 버리지 않고 원문을 글자로 보인다.
    return { heading: undefined, parts: splitText(text, size).map((t) => ({ text: t })) }
  }
  const heading = tokens.find((t) => t.type === 'heading') as Tokens.Heading | undefined
  const parts: Part[] = []
  let part: Token[] = []
  let length = 0
  for (const t of tokens) {
    part.push(t)
    length += t.raw.length
    if (length >= size) {
      parts.push({ tokens: part })
      part = []
      length = 0
    }
  }
  if (part.length || !parts.length) parts.push({ tokens: part })
  return { heading: heading && plainText(heading.tokens), parts }
}

function splitText(text: string, size: number): string[] {
  const out: string[] = []
  let start = 0
  while (start < text.length) {
    let end = start + size
    if (end < text.length) {
      const nl = text.indexOf('\n', end)
      end = nl === -1 ? text.length : nl + 1
    }
    out.push(text.slice(start, end))
    start = end
  }
  return out.length ? out : ['']
}

export function renderPart(part: Part): string {
  if ('text' in part) return `<div class="plain">${escapeText(part.text)}</div>`
  return sanitizer().sanitize(marked.parser(part.tokens), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
  })
}

export class MarkdownBody {
  static #count = 0
  readonly id = ++MarkdownBody.#count
  #parts: (Part | string)[]

  constructor(parts: Part[]) {
    this.#parts = parts
  }

  get length(): number {
    return this.#parts.length
  }

  html(i: number): string {
    const part = this.#parts[i]!
    if (typeof part === 'string') return part
    return (this.#parts[i] = renderPart(part))
  }
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
