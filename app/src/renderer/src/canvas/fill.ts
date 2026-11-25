import type { MarkdownBody } from './markdown'

// 큰 문서는 나머지 묶음을 하나씩 붙이고 그 사이에 다른 task 에 메인 스레드를 내준다. 한 번에 붙이면 그동안 터미널 입력도
// 멈추기 때문이다. setTimeout 은 다섯 번 넘게 중첩해 부르면 지연이 최소 4 ms 로 늘어나므로(HTML 표준의 timer clamping,
// 이 앱에서 재지는 않았다) MessageChannel 로 넘긴다.
const channel = new MessageChannel()
const waiting: (() => void)[] = []
channel.port1.onmessage = () => waiting.shift()?.()
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    waiting.push(resolve)
    channel.port2.postMessage(null)
  })
}

const CHAR_HEIGHT = '--char-height'

/**
 * 첫 묶음을 감싼 요소 하나만 든 `el` 에 `body` 의 나머지 묶음을 task 마다 하나씩 붙인다. 묶음을 붙일 때마다 그 HTML 로
 * `added` 를 부른다. 돌려준 함수를 부르면 더 붙이지 않는다.
 *
 * 화면 밖 묶음은 그리지 않는다. 그래야 묶음을 붙일 때마다 Chrome 이 프레임마다 하는 일이 문서 크기만큼 늘지 않기
 * 때문이다. 아직 그린 적 없는 묶음의 높이는 첫 묶음의 높이를 그 HTML 길이로 나눈 값에 그 묶음의 HTML 길이를 곱해
 * 어림한다. 이 값은 첫 묶음의 높이가 바뀔 때마다 다시 잰다. 한 번만 재면 Canvas 가 열리며 폭이 바뀌는 중에 잰 값이
 * 남기 때문이다.
 */
export function fillBody(
  el: HTMLElement,
  body: Pick<MarkdownBody, 'length' | 'html'>,
  added?: (html: string) => void
): () => void {
  let stopped = false
  // 첫 묶음의 HTML 이 비면(문서 머리가 HTML 주석이나 링크 참조 정의뿐이면) 어림할 기준이 없으므로 화면 밖 묶음도 그린다.
  const first = body.length > 1 ? body.html(0).length : 0
  const resize = new ResizeObserver(([e]) => {
    // 첫 묶음이 보이지 않아 높이가 0 이면 앞서 잰 값을 그대로 둔다.
    if (e!.contentRect.height)
      el.style.setProperty(CHAR_HEIGHT, `${e!.contentRect.height / first}px`)
  })
  if (first) resize.observe(el.firstElementChild!)
  void (async () => {
    for (let i = 1; i < body.length; i++) {
      await nextTask()
      if (stopped) return
      const html = body.html(i)
      const style = first
        ? `content-visibility: auto; contain-intrinsic-size: auto calc(var(${CHAR_HEIGHT}) * ${html.length})`
        : ''
      el.insertAdjacentHTML('beforeend', `<div class="part" style="${style}">${html}</div>`)
      added?.(html)
    }
  })()
  return () => {
    stopped = true
    resize.disconnect()
  }
}
