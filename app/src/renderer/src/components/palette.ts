import { nextTick, onMounted, onUnmounted, watch, type Ref, type ShallowRef } from 'vue'

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
  const reveal = (): void =>
    void nextTick(() =>
      list.value?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
    )
  // 처음 고른 줄이 첫 줄이 아닐 수 있으므로 띄울 때도 보이게 한다.
  onMounted(reveal)
  watch(index, reveal)
}

/**
 * ↑·↓ 로 옮긴 후보 번호. 팔레트가 위든 아래든 후보는 첫 후보부터 위에서 아래로 놓이므로 ↓ 가 다음 후보다. 끝에서 돈다.
 * 화살표가 아니거나 후보가 없으면 undefined 다.
 */
export function arrowIndex(key: string, index: number, n: number): number | undefined {
  if (!n || (key !== 'ArrowDown' && key !== 'ArrowUp')) return undefined
  return (index + (key === 'ArrowDown' ? 1 : -1) + n) % n
}
