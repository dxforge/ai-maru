/** mermaid 가 그린 SVG, 또는 그리지 못한 까닭 한 줄. */
export type Diagram = { svg: string } | { error: string }

/** mermaid 원문을 SVG 로 그린다. 문법이 틀리면 reject 한다. */
export type RenderDiagram = (source: string, dark: boolean) => Promise<string>

/** 블록 순서와 밝기마다 그린 결과. 문서 하나의 본문에 하나씩 두어, 본문을 다시 그릴 때 mermaid 를 다시 돌리지 않는다. */
export type DiagramCache = Map<string, Promise<Diagram>>

// `renderPart` 가 거른 HTML 에서 mermaid 블록이 남는 꼴이다. sanitize 가 `code` 의 `class` 말고는 속성을 모두 지운다.
const BLOCK = '<code class="language-mermaid">'

/** `renderPart` 가 낸 HTML 에 mermaid 블록이 있는지 본다. 없으면 본문의 DOM 을 뒤지지 않는다. */
export function hasDiagram(html: string): boolean {
  return html.includes(BLOCK)
}

// 블록(`pre`)마다 지금 그리고 있거나 그린 밝기와, 그 결과를 넣은 요소.
const drawn = new WeakMap<Element, { dark: boolean; out?: Element }>()

/**
 * `el` 안의 mermaid 블록을 `dark` 밝기의 다이어그램으로 바꾼다. 그린 블록은 숨기고 바로 뒤에 SVG 를 넣는다. 문법이 틀린
 * 블록은 코드를 그대로 두고 뒤에 오류 한 줄을 넣는다. 이미 이 밝기로 그린 블록은 건너뛰므로, 묶음을 붙이거나 밝기가
 * 바뀔 때마다 다시 불러도 된다. mermaid 는 처음 그릴 블록이 생겼을 때 `load` 로 읽는다.
 */
export function drawDiagrams(
  el: Element,
  cache: DiagramCache,
  dark: boolean,
  load: () => Promise<RenderDiagram>
): Promise<void> {
  const blocks = [...el.querySelectorAll('pre > code.language-mermaid')]
  return Promise.all(
    blocks.map(async (code, i) => {
      const pre = code.parentElement!
      const was = drawn.get(pre)
      if (was?.dark === dark) return
      const claim = { dark, out: was?.out }
      drawn.set(pre, claim)
      const key = `${dark ? 'dark' : 'light'}:${i}`
      let diagram = cache.get(key)
      if (!diagram) {
        const source = code.textContent ?? ''
        diagram = load()
          .then((render) => render(source, dark))
          .then(
            (svg) => ({ svg }),
            (e: unknown) => ({ error: errorLine(e) })
          )
        cache.set(key, diagram)
      }
      const d = await diagram
      // 그리는 동안 밝기가 다시 바뀌었거나 본문이 떨어져 나갔으면 넣지 않는다.
      if (drawn.get(pre) !== claim || !el.isConnected) return
      const out = document.createElement('div')
      if ('svg' in d) {
        out.className = 'diagram'
        out.innerHTML = d.svg
      } else {
        out.className = 'diagram-error'
        out.textContent = d.error
      }
      pre.hidden = 'svg' in d
      if (claim.out) claim.out.replaceWith(out)
      else pre.after(out)
      claim.out = out
    })
  ).then(() => undefined)
}

/**
 * mermaid 의 오류를 한 줄로 줄인다. 문법 오류는 첫 줄에 줄 번호, 마지막 줄에 기대한 것과 받은 것을 적고 그 사이에 원문과
 * 위치 표시를 두므로, 첫 줄과 마지막 줄만 잇는다.
 */
export function errorLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return 'Unable to render the diagram'
  return lines.length > 1 ? `${lines[0]} ${lines[lines.length - 1]}` : lines[0]!
}
