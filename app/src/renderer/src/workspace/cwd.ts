import type { Pane } from './store'

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

export function dirName(cwd: string | undefined): string {
  if (cwd === undefined) return 'Shell'
  return cwd.split('/').filter(Boolean).pop() ?? '/'
}

export type Label = { name: string; branch?: string }

export function cellLabel(p: Pick<Pane, 'cwd' | 'git'>): Label {
  return p.git ? { name: p.git.repo, branch: p.git.branch } : { name: dirName(p.cwd) }
}

export function workspaceName(p: Pick<Pane, 'cwd' | 'git'>): string {
  return cellLabel(p).name
}

export function windowTitle(label: Label): string {
  return label.branch ? `${label.name} — ${label.branch}` : label.name
}

export function tildePath(path: string, home: string | undefined): string {
  home = home?.replace(/\/+$/, '')
  if (!home) return path
  if (path === home) return '~'
  return path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
}
