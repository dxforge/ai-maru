import { shallowRef } from 'vue'
import { findFavorite, type Favorite } from '../../../shared/launcher'

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
    async add(dir: string, name: string): Promise<void> {
      set((await window.maru.addFavorite(dir, name)).favorites)
    },
    async forget(dir: string): Promise<void> {
      set((await window.maru.forgetFavorite(dir)).favorites)
    },
    async rename(dir: string, name: string): Promise<void> {
      set((await window.maru.renameFavorite(dir, name)).favorites)
    }
  }
}

export type Favorites = ReturnType<typeof createFavorites>

export type FavoriteToggle =
  { kind: 'unknown' } | { kind: 'forget'; dir: string } | { kind: 'add'; dir: string; name: string }

/** 디렉토리가 `dir` 이고 이름이 `name` 인 workspace 의 별을 눌렀을 때 할 일이다. */
export function favoriteToggle(
  favorites: readonly Favorite[],
  dir: string | undefined,
  name: string
): FavoriteToggle {
  if (dir === undefined) return { kind: 'unknown' }
  const favorite = findFavorite(favorites, dir)
  return favorite ? { kind: 'forget', dir: favorite.dir } : { kind: 'add', dir, name }
}
