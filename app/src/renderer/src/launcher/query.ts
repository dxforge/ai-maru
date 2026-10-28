import { SHELL } from '../../../shared/launcher'
import { foldCase, matchesWords } from '../../../shared/commands'
import { tildePath } from '../workspace/cwd'

export function expandPath(input: string, home: string | undefined): string {
  const h = home?.replace(/\/+$/, '')
  const expanded = h && (input === '~' || input.startsWith('~/')) ? h + input.slice(1) : input
  return expanded.replace(/(?<=.)\/+$/, '')
}

export type PathQuery = { prefix: string; fragment: string; parent: string }

export function isPathInput(input: string): boolean {
  return input.startsWith('~') || input.startsWith('/')
}

export function pathQuery(input: string, home: string | undefined): PathQuery | null {
  const slash = input.lastIndexOf('/')
  if (!isPathInput(input) || slash < 0) return null
  const prefix = input.slice(0, slash + 1)
  return { prefix, fragment: input.slice(slash + 1), parent: expandPath(prefix, home) }
}

export type Row = { path: string; label: string }

export function filterRecent(
  recent: readonly string[],
  query: string,
  home: string | undefined
): Row[] {
  return recent
    .map((path) => ({ path, label: tildePath(path, home) }))
    .filter((r) => matchesWords(r.label, query))
}

/**
 * `fragment` 로 시작하는 이름을 남긴다(대소문자와 유니코드 정규화 무시). `.` 으로 시작하는 이름은 `fragment` 도 `.` 으로 시작할 때만 남긴다.
 * `fragment` 와 같은 이름은 맨 앞에 둔다. `~/proj` 를 치고 Enter 를 누르면 `~/projects` 가 아니라 `~/proj` 가 열려야
 * 하기 때문이다.
 */
export function matchDirs(names: readonly string[], fragment: string): string[] {
  const f = foldCase(fragment)
  const hidden = f.startsWith('.')
  const found = names.filter((n) => {
    const l = foldCase(n)
    return l.startsWith(f) && (hidden || !l.startsWith('.'))
  })
  const exact = found.filter((n) => foldCase(n) === f)
  return [...exact, ...found.filter((n) => foldCase(n) !== f)]
}

export function joinDir(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : `${parent}/${name}`
}

/** 기억한 명령이 `commands` 에 있거나 셸(`SHELL`)이면 그것을, 아니면 첫 명령을 고른다. */
export function pickCommand(commands: readonly string[], remembered: string | null): string {
  return remembered === SHELL || (remembered !== null && commands.includes(remembered))
    ? remembered
    : commands[0]
}
