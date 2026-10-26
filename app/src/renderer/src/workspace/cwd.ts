export function tildePath(path: string, home: string | undefined): string {
  home = home?.replace(/\/+$/, '')
  if (!home) return path
  if (path === home) return '~'
  return path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
}
