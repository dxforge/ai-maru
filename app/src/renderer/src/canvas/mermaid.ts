import type { RenderDiagram } from './diagrams'

let loaded: Promise<RenderDiagram> | undefined

/**
 * mermaid 를 처음 부를 때 읽는다. mermaid 는 번들이 커서, mermaid 블록이 없는 문서만 여는 동안에는 읽지 않는다.
 * 밝기는 `initialize` 로 정하는 전역 설정이라, 한 번에 하나씩 설정하고 그린다.
 */
export function loadMermaid(): Promise<RenderDiagram> {
  return (loaded ??= import('mermaid').then(({ default: mermaid }) => {
    let queue: Promise<unknown> = Promise.resolve()
    let n = 0
    return (source, dark) => {
      const run = queue.then(async () => {
        mermaid.initialize({
          startOnLoad: false,
          // 라벨의 HTML 을 거르고, 클릭하면 스크립트를 부르는 `click` 문을 끈다.
          securityLevel: 'strict',
          // 문법 오류를 문서 끝에 그림으로 붙이지 않는다. 오류는 `drawDiagrams` 가 블록 아래에 보인다.
          suppressErrorRendering: true,
          theme: dark ? 'dark' : 'default'
        })
        return (await mermaid.render(`maru-mermaid-${++n}`, source)).svg
      })
      queue = run.catch(() => undefined)
      return run
    }
  }))
}
