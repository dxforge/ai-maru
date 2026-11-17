import type { RenderDiagram } from './diagrams'

let loaded: Promise<RenderDiagram> | undefined

/**
 * `loadMermaid` 를 처음 부를 때 mermaid 를 읽는다. mermaid 는 번들이 커서, mermaid 블록이 없는 문서만 여는 동안에는 읽지 않는다.
 * 밝기는 `initialize` 로 정하는 전역 설정이라, 한 번에 하나씩 설정하고 그린다. 읽지 못하면 다음에 부를 때 다시 읽는다.
 */
export function loadMermaid(): Promise<RenderDiagram> {
  return (loaded ??= import('mermaid').then(({ default: mermaid }) => {
    // 다이어그램을 mermaid 가 정한 크기로 그린다. `useMaxWidth` 는 다이어그램 종류마다 따로 있어, 기본 설정에서 그 값을 가진
    // 종류를 모두 끈다. 켜 두면 SVG 가 블록 너비에 맞춰 줄어, 카드 너비에 따라 글자 크기가 달라지기 때문이다.
    const fixedSize = Object.fromEntries(
      Object.entries(mermaid.mermaidAPI.defaultConfig)
        .filter(([, v]) => typeof v === 'object' && v !== null && 'useMaxWidth' in v)
        .map(([type]) => [type, { useMaxWidth: false }])
    )
    let queue: Promise<unknown> = Promise.resolve()
    let n = 0
    // 설정은 밝기가 바뀔 때만 다시 한다. `render` 는 그릴 때마다 설정을 `initialize` 의 값으로 되돌리고 나서 원문의
    // 설정 지시문을 더하므로, 앞 다이어그램의 지시문이 다음 다이어그램에 남지 않는다.
    let theme: boolean | undefined
    return (source, dark) => {
      const run = queue.then(async () => {
        if (theme !== dark) {
          theme = dark
          mermaid.initialize({
            ...fixedSize,
            startOnLoad: false,
            // 라벨의 HTML 을 거르고, 클릭하면 스크립트를 부르는 `click` 문을 끈다.
            securityLevel: 'strict',
            // 문법 오류를 문서 끝에 그림으로 붙이지 않는다. 오류는 `drawDiagrams` 가 블록 아래에 보인다.
            suppressErrorRendering: true,
            // 앱 색 대신 mermaid 내장 테마 `default`·`dark` 가운데 배경 밝기에 맞는 것을 쓴다. 앱 색은 터미널 테마에서
            // 따와, 그 색으로 노드를 칠하면 대비가 떨어질 수 있기 때문이다.
            theme: dark ? 'dark' : 'default'
          })
        }
        return (await mermaid.render(`maru-mermaid-${++n}`, source)).svg
      })
      queue = run.catch(() => undefined)
      return run
    }
  })).catch((e: unknown) => {
    loaded = undefined
    throw e
  })
}
