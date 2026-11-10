export function relativeTo(path: string, base: string | undefined): string | undefined {
  base = base?.replace(/\/+$/, '')
  if (!base) return undefined
  if (path === base) return ''
  return path.startsWith(base + '/') ? path.slice(base.length + 1) : undefined
}

export function tildePath(path: string, home: string | undefined): string {
  const rel = relativeTo(path, home)
  if (rel === undefined) return path
  return rel ? `~/${rel}` : '~'
}
