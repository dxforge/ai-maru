import { highlight } from './code'

export type Highlight = (code: string, lang: string) => Promise<string | null>

/** 블록 순서마다 강조한 결과. 문서 하나의 본문에 하나씩 두어, 카드를 접었다 펴도 worker 에 다시 보내지 않는다. */
export type HighlightCache = Map<number, Promise<string | null>>

// mermaid 블록은 `drawDiagrams`(`diagrams.ts`)가 다이어그램으로 바꾸므로 강조하지 않는다.
const BLOCKS = 'pre > code[class^="language-"]:not(.language-mermaid)'
// `marked` 가 fence 의 언어를 `<code class="language-*">` 로 내고, sanitize 의 `uponSanitizeAttribute`
// hook(`markdown.ts`)이 이 `class` 만 남긴다. 마크다운에 직접 쓴 `<code>` 는 `class` 앞에 다른 속성이 올 수 있다.
const BLOCK = /<code\b[^>]*\bclass="language-(?!mermaid")/

/**
 * `renderPart` 가 낸 HTML 에 mermaid 가 아니면서 언어를 적은 코드 블록이 있는지 본다. false 면 호출하는 쪽은
 * `highlightBlocks` 를 부르지 않아도 된다.
 */
export function hasCodeBlock(html: string): boolean {
  return BLOCK.test(html)
}

// 본문 요소마다 강조를 맡긴 블록 수. 묶음은 본문 끝에만 붙으므로, 다시 부르면 그 뒤의 블록만 맡긴다.
const requested = new WeakMap<Element, number>()

/**
 * 강조를 받기 전에는 블록의 글자가 그대로 보이고, 받으면 블록 안을 강조한 HTML 로 바꾼다. `run` 이 null 을 낸 블록,
 * mermaid 블록, 안에 태그가 있는 블록은 그대로 둔다. 본문 끝에 묶음을 붙일 때마다 다시 불러도 되고, 그때는 새로 붙은
 * 블록만 `run` 에 맡긴다.
 */
export async function highlightBlocks(
  el: Element,
  cache: HighlightCache,
  run: Highlight = highlight
): Promise<void> {
  // 다이어그램 라벨 안의 코드 블록은 뺀다. 그 블록은 다이어그램이 붙은 뒤에야 생기므로, 세면 블록 순서(캐시의 키)가
  // 렌더마다 달라진다.
  const blocks = [...el.querySelectorAll(BLOCKS)].filter((code) => !code.closest('.diagram'))
  const from = requested.get(el) ?? 0
  requested.set(el, blocks.length)
  await Promise.all(
    blocks.slice(from).map(async (code, j) => {
      // 마크다운에 직접 쓴 `<code>` 안의 링크 같은 태그는 강조한 HTML 로 바꾸면 사라지므로, 그런 블록은 그대로 둔다.
      if (code.firstElementChild) return
      const i = from + j
      let html = cache.get(i)
      if (!html) {
        html = run(code.textContent ?? '', code.className.slice('language-'.length))
        cache.set(i, html)
      }
      const h = await html
      if (h !== null) code.innerHTML = h
    })
  )
}
