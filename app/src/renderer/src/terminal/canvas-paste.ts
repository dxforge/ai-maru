/**
 * 경로 없는 paste 의 `clipboardData.items` 형식 가운데 이미지가 있는지. 이미지만 든 클립보드는 `types` 가 `Files` 뿐이고,
 * 이미지는 디스크에 없는 File 항목(`image/png`)으로 온다(Electron 45.1 에서 확인했다).
 */
export const hasImage = (types: readonly string[]): boolean =>
  types.some((t) => t.startsWith('image/'))

/**
 * Claude Code 가 클립보드 이미지를 읽는 키(macOS 의 ⌃V)인지.
 * 라틴 글자가 아닌 자판(한글)에서는 글자가 `ㅍ` 로 오므로 자판 위치로 맞춘다.
 * 키를 누르고 있어 반복되는 keydown 에는 `false` 를 낸다. 누르고 있는 동안 Canvas 에 같은 이미지 문서가 쌓이기 때문이다.
 */
export function isImagePasteKey(
  e: Pick<
    KeyboardEvent,
    'type' | 'repeat' | 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
  >
): boolean {
  if (e.type !== 'keydown' || e.repeat) return false
  if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return false
  return /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() === 'v' : e.code === 'KeyV'
}
