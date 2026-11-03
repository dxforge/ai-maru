import { shallowRef } from 'vue'
import {
  favoriteById,
  samePath,
  withoutPin,
  withPin,
  type Favorite
} from '../../../shared/launcher'
import { randomId } from '../../../shared/pty'

/**
 * 즐겨찾기 목록이다. 사이드바의 별과 런처가 같은 목록을 본다. `onForget` 은 항목을 빼기 직전에 그 `id` 로 불린다. 별과
 * 런처 어느 쪽에서 빼든 같은 정리를 하기 위해서다.
 */
export function createFavorites(onForget: (id: string) => void = () => {}) {
  const list = shallowRef<readonly Favorite[]>([])
  // 처음 읽은 값이 그 뒤에 바꾼 목록보다 늦게 오면 쓰지 않는다.
  let changed = false
  let loaded = false
  const set = (favorites: readonly Favorite[]): void => {
    changed = true
    list.value = favorites
  }
  void window.maru
    .launcherState()
    .then((s) => {
      if (!changed) list.value = s.favorites
    })
    .finally(() => (loaded = true))

  // main 이 답하기 전에 목록에 먼저 넣는다. 그 사이에 별을 다시 누르면 이 항목을 빼야 하기 때문이다.
  async function add(favorite: Favorite): Promise<void> {
    set([...list.value, favorite])
    set((await window.maru.addFavorite(favorite)).favorites)
  }
  async function forget(id: string): Promise<void> {
    onForget(id)
    set((await window.maru.forgetFavorite(id)).favorites)
  }

  return {
    list,
    add,
    forget,
    /**
     * 별을 누른 workspace 의 즐겨찾기를 `favoriteToggle` 대로 빼거나 넣고, 할 일을 돌려준다. workspace 에 링크를 거는
     * 것은 부른 쪽의 일이다. 처음 읽은 목록이 오기 전에는 아무것도 하지 않고 `loading` 을 돌려준다. 빈 목록으로 판정하면
     * 이어진 workspace 의 항목을 못 찾아 같은 항목을 새로 넣기 때문이다.
     */
    toggle(workspace: ToggledWorkspace, linked: ReadonlySet<string>): FavoriteToggle | Loading {
      if (!loaded) return { kind: 'loading' }
      const action = favoriteToggle(list.value, workspace, linked)
      if (action.kind === 'forget') void forget(action.id)
      else if (action.kind === 'add') void add(action.favorite)
      return action
    },
    async rename(id: string, name: string): Promise<void> {
      set((await window.maru.renameFavorite(id, name)).favorites)
    },
    // 목록에 먼저 반영한다. main 이 답하기 전에도 닫힌 핀 줄이 보이고 사라지게 하기 위해서다.
    async pin(id: string, dir: string): Promise<void> {
      set(list.value.map((f) => (f.id === id ? withPin(f, dir) : f)))
      set((await window.maru.addPin(id, dir)).favorites)
    },
    async unpin(id: string, dir: string): Promise<void> {
      set(list.value.map((f) => (f.id === id ? withoutPin(f, dir) : f)))
      set((await window.maru.removePin(id, dir)).favorites)
    }
  }
}

export type Favorites = ReturnType<typeof createFavorites>

export type PinToggle = { kind: 'pin' | 'unpin'; dir: string } | { kind: 'unknown' }

/**
 * cell 의 핀을 누르면 할 일이다. cell 이 맡은 핀(`pin`)이 즐겨찾기의 `pins` 에 있으면 그 핀을 뺀다. 즐겨찾기가 아니거나
 * `pins` 에 없는 낡은 `pin` 이면 첫 pane 의 지금 디렉토리(`cwd`)로 꽂는다. `cwd` 를 모르면 `unknown` 이다.
 */
export function pinToggle(
  favorite: Favorite | undefined,
  pin: string | undefined,
  cwd: string | undefined
): PinToggle {
  if (pin !== undefined && favorite?.pins?.some((p) => samePath(p, pin)))
    return { kind: 'unpin', dir: pin }
  return cwd === undefined ? { kind: 'unknown' } : { kind: 'pin', dir: cwd }
}

type ToggledWorkspace = { dir: string | undefined; name: string; favorite?: string }
type Loading = { kind: 'loading' }

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
  workspace: ToggledWorkspace,
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
