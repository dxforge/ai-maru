/**
 * dev 에서 Vite 가 페이지를 새로 고치는 이동인지. Vite 는 지금 주소를 다시 읽으므로, 같은 dev
 * 서버라도 다른 주소로 가는 이동(Canvas 문서의 상대 링크 등)은 새로 고침이 아니다.
 */
export function isDevReload(url: string, current: string, devServer: string | undefined): boolean {
  if (!devServer) return false
  try {
    const to = new URL(url)
    return to.origin === new URL(devServer).origin && to.href === new URL(current).href
  } catch {
    return false
  }
}
