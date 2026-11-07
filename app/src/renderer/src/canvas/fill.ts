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

/** 첫 묶음이 이미 든 `el` 에 `body` 의 나머지 묶음을 task 마다 하나씩 붙인다. 돌려준 함수를 부르면 더 붙이지 않는다. */
export function fillBody(el: Element, body: Pick<MarkdownBody, 'length' | 'html'>): () => void {
  let stopped = false
  void (async () => {
    for (let i = 1; i < body.length; i++) {
      await nextTask()
      if (stopped) return
      el.insertAdjacentHTML('beforeend', body.html(i))
    }
  })()
  return () => {
    stopped = true
  }
}
