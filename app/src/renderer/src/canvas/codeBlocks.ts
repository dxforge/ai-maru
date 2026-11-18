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
 * `BlockHighlighter.scan` 을 부르지 않아도 된다.
 */
export function hasCodeBlock(html: string): boolean {
  return BLOCK.test(html)
}

/**
 * 본문 요소 하나의 코드 블록을 화면에 들어올 때 fence 에 적은 언어로 강조한다. 강조를 받기 전에는 블록의 글자가 그대로
 * 보이고, 받으면 블록 안을 강조한 HTML 로 바꾼다. `run` 이 null 을 낸 블록, mermaid 블록, 안에 태그가 있는 블록은
 * 그대로 둔다.
 *
 * 화면에 들어온 블록만 worker 에 맡긴다. 모든 블록을 맡기면 코드 블록이 많은 큰 문서에서 강조한 HTML 을 블록마다
 * 붙이는 task 가 메인 스레드에 쌓이기 때문이다. 5 MB 문서(ts 블록 약 1만 개)에서 화면이 초당 6~7 프레임으로 떨어졌고,
 * 나머지 묶음을 붙이는 task(`fillBody`)가 그 뒤에 줄을 서 120초 동안 문서의 약 60%만 붙였다. 강조하지 않을 때는 약
 * 30초에 다 붙였다(잰 값).
 */
export class BlockHighlighter {
  // 본문 끝에만 묶음이 붙으므로, `scan` 은 앞서 본 블록 수 뒤의 블록만 새로 본다.
  #seen = 0
  readonly #index = new WeakMap<Element, number>()
  readonly #observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue
      this.#observer.unobserve(target)
      void this.#highlight(target, this.#index.get(target)!)
    }
  })

  constructor(
    private readonly root: Element,
    private readonly cache: HighlightCache,
    private readonly run: Highlight = highlight
  ) {}

  /** 새로 붙은 블록을 지켜본다. 묶음을 붙일 때마다 부른다. */
  scan(): void {
    // 다이어그램 라벨 안의 코드 블록은 뺀다. 그 블록은 다이어그램이 붙은 뒤에야 생기므로, 세면 블록 순서(캐시의 키)가
    // 렌더마다 달라진다.
    const blocks = [...this.root.querySelectorAll(BLOCKS)].filter(
      (code) => !code.closest('.diagram')
    )
    for (let i = this.#seen; i < blocks.length; i++) {
      this.#index.set(blocks[i], i)
      this.#observer.observe(blocks[i])
    }
    this.#seen = blocks.length
  }

  /** 지켜보던 것을 멈춘다. 이미 worker 에 맡긴 블록은 받은 결과를 캐시에 남긴다. */
  stop(): void {
    this.#observer.disconnect()
  }

  async #highlight(code: Element, i: number): Promise<void> {
    // 마크다운에 직접 쓴 `<code>` 안의 링크 같은 태그는 강조한 HTML 로 바꾸면 사라지므로, 그런 블록은 그대로 둔다.
    if (code.firstElementChild) return
    let html = this.cache.get(i)
    if (!html) {
      html = this.run(code.textContent ?? '', code.className.slice('language-'.length))
      this.cache.set(i, html)
    }
    const h = await html
    if (h !== null) code.innerHTML = h
  }
}
