import { onBeforeUnmount, onMounted } from 'vue'

export const POPUP_GAP = 4
export const POPUP_MARGIN = 8

// 팝업 둘이 잠깐 겹쳐 열려도 먼저 닫힌 쪽이 드래그 영역을 다시 켜지 않게 센다.
let dragOff = 0

/**
 * 바깥을 누르거나 창 크기가 바뀌면 `close` 를 부른다. 창 크기가 바뀌면 팝업이 붙어 있던 자리가 움직이기 때문이다. `inside` 가
 * true 인 곳(팝업과 그것을 여닫는 버튼)을 누를 때는 부르지 않는다. 열린 동안 창 드래그 영역(`.window-drag`)을 끈다. 드래그
 * 영역을 누르면 페이지에 pointerdown 이 오지 않아, 사이드바 빈 곳·제목 줄을 눌러도 닫히지 않기 때문이다.
 */
export function usePopupDismiss(inside: (t: Element) => boolean, close: () => void): void {
  function onPointerDown(e: PointerEvent): void {
    const t = e.target as Element | null
    if (t && inside(t)) return
    close()
  }
  const onResize = (): void => close()
  onMounted(() => {
    if (dragOff++ === 0) document.documentElement.classList.add('window-drag-off')
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onResize)
  })
  onBeforeUnmount(() => {
    if (--dragOff === 0) document.documentElement.classList.remove('window-drag-off')
    document.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('resize', onResize)
  })
}

/** `anchor` 아래에 높이 `height` 의 팝업을 둘 top 이다. 아래가 모자라고 위에 자리가 있으면 위로 올린다. */
export function popupTop(anchor: DOMRect, height: number): number {
  const below = anchor.bottom + POPUP_GAP
  const above = anchor.top - POPUP_GAP - height
  const top = below + height <= innerHeight - POPUP_MARGIN || above < POPUP_MARGIN ? below : above
  return Math.max(POPUP_MARGIN, Math.min(top, innerHeight - POPUP_MARGIN - height))
}
