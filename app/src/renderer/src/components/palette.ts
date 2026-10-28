import { nextTick, onMounted, onUnmounted, watch, type Ref, type ShallowRef } from 'vue'
import type { Position } from '../config/layout'

/**
 * 키는 입력창만 받으므로 포커스가 입력창을 떠나면 닫는다. 창이 포커스를 잃을 때도 입력창에 blur 가 오는데, 그때는 닫지
 * 않고 창이 돌아왔을 때 포커스가 입력창을 떠나 있으면 닫는다. 돌려준 함수를 입력창의 blur 에 건다.
 */
export function closeOnFocusLoss(
  input: Readonly<ShallowRef<HTMLInputElement | null>>,
  close: () => void
): () => void {
  function onWindowFocus(): void {
    if (document.activeElement !== input.value) close()
  }
  onMounted(() => window.addEventListener('focus', onWindowFocus))
  onUnmounted(() => window.removeEventListener('focus', onWindowFocus))
  return () => {
    if (document.hasFocus()) close()
  }
}

export function revealSelected(
  list: Readonly<ShallowRef<HTMLElement | null>>,
  index: Readonly<Ref<number>>
): void {
  watch(index, () =>
    nextTick(() => list.value?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }))
  )
}

/**
 * ↑·↓ 로 옮긴 후보 번호. 화살표는 화면 방향대로 움직인다. 팔레트가 아래면 후보가 입력줄 위에 첫 후보부터 위로 놓이므로
 * ↓ 가 앞 후보다. 화살표가 아니거나 후보가 없으면 undefined 다.
 */
export function arrowIndex(
  key: string,
  index: number,
  n: number,
  position: Position
): number | undefined {
  if (!n || (key !== 'ArrowDown' && key !== 'ArrowUp')) return undefined
  const down = position === 'bottom' ? -1 : 1
  return (index + (key === 'ArrowDown' ? down : -down) + n) % n
}
