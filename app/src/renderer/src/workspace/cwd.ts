/** 호스트는 보지 않는다 — `URL` 은 셸이 싣는 `$HOST` 가운데 일부(`foo.1`)를 거절한다. */
export function osc7Path(data: string): string | null {
  const path = /^file:\/\/[^/]*(\/.*)$/.exec(data)?.[1]
  if (path === undefined) return null
  try {
    return decodeURIComponent(path)
  } catch {
    return null
  }
}

export function workspaceName(cwd: string | undefined): string {
  if (cwd === undefined) return 'Shell'
  return cwd.split('/').filter(Boolean).pop() ?? '/'
}
