/** dev 에서 Vite 가 페이지를 새로 고치는 이동인지. */
export function isDevReload(url: string, devServer: string | undefined): boolean {
  if (!devServer) return false
  try {
    return new URL(url).origin === new URL(devServer).origin
  } catch {
    return false
  }
}
