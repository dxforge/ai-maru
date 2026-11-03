import { findFavorite, SHELL, type Favorite } from '../../../shared/launcher'
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

/** `name` 은 즐겨찾기 행에만 있다. */
export type Row = { path: string; label: string; name?: string }

/** 즐겨찾기에 든 디렉토리는 즐겨찾기 묶음에 보이므로 빼고 준다. */
export function filterRecent(
  recent: readonly string[],
  query: string,
  home: string | undefined,
  favorites: readonly Favorite[] = []
): Row[] {
  return recent
    .filter((path) => !findFavorite(favorites, path))
    .map((path) => ({ path, label: tildePath(path, home) }))
    .filter((r) => matchesWords(r.label, query))
}

export function filterFavorites(
  favorites: readonly Favorite[],
  query: string,
  home: string | undefined
): Row[] {
  return favorites
    .map(({ dir, name }) => ({ path: dir, label: tildePath(dir, home), name }))
    .filter((r) => matchesWords(`${r.name} ${r.label}`, query))
}

export type ListEntry = { title: string } | { row: Row; index: number }

/**
 * 디렉토리 단계 목록의 DOM 순서다. 즐겨찾기 행이 있으면 즐겨찾기와 최근 목록을 묶음 제목과 함께 나누고, 없으면 제목 없이
 * 최근 목록만 둔다. `index` 는 `[...favorites, ...recent]` 에서의 자리다. 아래 팔레트의 목록은 column-reverse 라 제목을
 * 묶음 뒤에 두어야 화면에서 묶음 위에 선다.
 */
export function listEntries(
  favorites: readonly Row[],
  recent: readonly Row[],
  bottom: boolean
): ListEntry[] {
  const rows = (list: readonly Row[], from: number): ListEntry[] =>
    list.map((row, i) => ({ row, index: from + i }))
  if (!favorites.length) return rows(recent, 0)
  const group = (title: string, list: ListEntry[]): ListEntry[] =>
    bottom ? [...list, { title }] : [{ title }, ...list]
  const fav = group('Favorites', rows(favorites, 0))
  return recent.length ? [...fav, ...group('Recent', rows(recent, favorites.length))] : fav
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

export function commandList(commands: readonly string[], shell: boolean): readonly string[] {
  return shell ? [...commands, SHELL] : commands
}

export function pickCommand(list: readonly string[], remembered: string | null): string {
  return remembered !== null && list.includes(remembered) ? remembered : list[0]
}

export function commandChoices(
  list: readonly string[],
  query: string
): { command: string; label: string }[] {
  return list
    .map((c) => ({ command: c, label: c === SHELL ? 'shell' : c }))
    .filter((r) => matchesWords(r.label, query))
}
