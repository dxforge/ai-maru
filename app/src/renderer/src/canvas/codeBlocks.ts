import { HIGHLIGHT_MAX_CHARS, highlight } from './code'

/** 코드와 fence 에 적은 언어 이름으로 강조한 HTML 을 낸다. 모르는 언어면 null 이다. */
export type Highlight = (code: string, lang: string) => Promise<string | null>

/** 블록 순서마다 강조한 결과. 문서 하나의 본문에 하나씩 두어, 카드를 접었다 펴도 worker 에 다시 보내지 않는다. */
export type HighlightCache = Map<number, Promise<string | null>>

// mermaid 블록은 `drawDiagrams`(`diagrams.ts`)가 다이어그램으로 바꾸므로 강조하지 않는다.
const BLOCKS = 'pre > code[class^="language-"]:not(.language-mermaid)'
// `marked` 가 fence 의 언어를 `<code class="language-*">` 로 내고, sanitize 의 `uponSanitizeAttribute`
// hook(`markdown.ts`)이 이 `class` 만 남긴다.
const BLOCK = /<code class="language-(?!mermaid")/

/** `renderPart` 가 낸 HTML 에 언어를 적은 코드 블록이 있는지 본다. 없으면 본문의 DOM 을 뒤지지 않는다. */
export function hasCodeBlock(html: string): boolean {
  return BLOCK.test(html)
}

// 강조를 맡긴 블록. 묶음을 붙일 때마다 다시 불러도 같은 블록을 두 번 맡기지 않는다.
const requested = new WeakSet<Element>()

/**
 * `el` 안의 코드 블록을 fence 에 적은 언어로 강조한다. 강조를 받기 전에는 글자만 보이고, 받으면 블록 안을 색 입힌 글자로
 * 바꾼다. 언어를 모르거나 `HIGHLIGHT_MAX_CHARS` 보다 긴 블록은 그대로 둔다.
 */
export async function highlightBlocks(
  el: Element,
  cache: HighlightCache,
  run: Highlight = highlight
): Promise<void> {
  const blocks = [...el.querySelectorAll(BLOCKS)]
  await Promise.all(
    blocks.map(async (code, i) => {
      if (requested.has(code)) return
      requested.add(code)
      let html = cache.get(i)
      if (!html) {
        const text = code.textContent ?? ''
        const lang = code.className.slice('language-'.length)
        html = text.length > HIGHLIGHT_MAX_CHARS ? Promise.resolve(null) : run(text, lang)
        cache.set(i, html)
      }
      const h = await html
      if (h !== null) code.innerHTML = h
    })
  )
}
