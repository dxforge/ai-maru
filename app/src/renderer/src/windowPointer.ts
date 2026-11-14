export function listenWindowPointer(
  move: (e: PointerEvent) => void,
  up: (e: PointerEvent) => void,
  cancel: (e: PointerEvent) => void = up
): () => void {
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  return () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
  }
}
