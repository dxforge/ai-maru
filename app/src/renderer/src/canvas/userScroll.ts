const SCROLL_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])

/**
 * 사용자가 휠·스크롤 키로 `scroller` 를 스크롤하거나, `scroller` 를 담은 요소 안에서 `doc` 밖을 누르면 `drop` 을 부른다.
 * 돌려준 함수로 멈춘다.
 * `scroll` 이벤트는 앱이 scrollTop 을 맞출 때도 나므로 쓰지 않는다.
 */
export function onUserScroll(doc: Element, scroller: Element, drop: () => void): () => void {
  // 스크롤바와, 스크롤러 위아래에 붙은 카드 제목 줄(`CardStream` 의 `.pins`)도 누르면 스크롤러가 움직이므로, 스크롤러를 담은
  // 요소에서 받는다. 다른 카드를 누른 것도 다른 곳으로 옮겨 간 것으로 본다.
  const area = scroller.parentElement ?? scroller
  const onPointer = (e: Event): void => {
    if (!doc.contains(e.target as Node)) drop()
  }
  // 키는 포커스가 스크롤러 안에 있거나 아무 데도 없을 때만 스크롤러를 움직인다.
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as Node
    if (SCROLL_KEYS.has(e.key) && (t === document.body || scroller.contains(t))) drop()
  }
  scroller.addEventListener('wheel', drop, { passive: true })
  area.addEventListener('pointerdown', onPointer)
  window.addEventListener('keydown', onKey)
  return () => {
    scroller.removeEventListener('wheel', drop)
    area.removeEventListener('pointerdown', onPointer)
    window.removeEventListener('keydown', onKey)
  }
}
