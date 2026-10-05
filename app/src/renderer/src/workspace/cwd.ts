/**
 * 호스트가 실린 것은 ssh 로 붙은 다른 머신의 셸이 보냈을 수 있어 버린다. 이 머신의 호스트 이름과
 * 견주지 않는 것은, 셸이 뜬 뒤 호스트 이름이 바뀌면 이 머신의 것까지 버리게 되어서다.
 */
export function osc7Path(data: string): string | null {
  const path = /^file:\/\/(\/.*)$/.exec(data)?.[1]
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
