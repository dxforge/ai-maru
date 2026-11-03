import { shallowRef } from 'vue'
import { favoriteById, samePath, type Favorite } from '../../../shared/launcher'
import { randomId } from '../../../shared/pty'

/** 즐겨찾기 목록이다. 사이드바의 별과 런처가 같은 목록을 본다. */
export function createFavorites() {
  const list = shallowRef<readonly Favorite[]>([])
  // 처음 읽은 값이 그 뒤에 바꾼 목록보다 늦게 오면 쓰지 않는다.
  let changed = false
  const set = (favorites: readonly Favorite[]): void => {
    changed = true
    list.value = favorites
  }
  void window.maru.launcherState().then((s) => {
    if (!changed) list.value = s.favorites
  })

  return {
    list,
    // main 이 답하기 전에 목록에 먼저 넣는다. 그 사이에 별을 다시 누르면 이 항목을 빼야 하기 때문이다.
    async add(favorite: Favorite): Promise<void> {
      set([...list.value, favorite])
      set((await window.maru.addFavorite(favorite)).favorites)
    },
    async forget(id: string): Promise<void> {
      set((await window.maru.forgetFavorite(id)).favorites)
    },
    async rename(id: string, name: string): Promise<void> {
      set((await window.maru.renameFavorite(id, name)).favorites)
    }
  }
}

export type Favorites = ReturnType<typeof createFavorites>

export type FavoriteToggle =
  | { kind: 'unknown' }
  | { kind: 'forget'; id: string }
  | { kind: 'link'; id: string }
  | { kind: 'add'; favorite: Favorite }

/**
 * 디렉토리가 `dir` 이고 이름이 `name` 이며 즐겨찾기 항목 `favorite` 을 가리키는 workspace 의 별을 눌렀을 때 할 일이다.
 * `linked` 는 열린 workspace 들이 가리키는 항목의 `id` 다. 디렉토리와 이름이 같은 항목 가운데 열린 workspace 가 가리키지
 * 않는 것이 있으면 새 항목 대신 그 항목에 잇는 `link` 를 돌려준다. workspace 를 닫으면 항목은 남으므로, 같은 디렉토리를
 * 다시 열어 같은 이름으로 별을 누를 때 항목이 겹치지 않게 하기 위해서다.
 */
export function favoriteToggle(
  favorites: readonly Favorite[],
  workspace: { dir: string | undefined; name: string; favorite?: string },
  linked: ReadonlySet<string>
): FavoriteToggle {
  const current = favoriteById(favorites, workspace.favorite)
  if (current) return { kind: 'forget', id: current.id }
  const { dir, name } = workspace
  if (dir === undefined) return { kind: 'unknown' }
  const free = favorites.find((f) => !linked.has(f.id) && f.name === name && samePath(f.dir, dir))
  return free
    ? { kind: 'link', id: free.id }
    : { kind: 'add', favorite: { id: randomId('f'), dir, name } }
}
