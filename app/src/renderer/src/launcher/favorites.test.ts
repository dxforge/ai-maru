import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Favorite, LauncherState } from '../../../shared/launcher'
import { createFavorites, favoriteToggle, pinsOnLink, pinToggle } from './favorites'

const app: Favorite = { id: 'f-1', dir: '/work/app', name: 'app' }

describe('favoriteToggle', () => {
  const none = new Set<string>()

  it('forgets the entry the workspace points to', () => {
    expect(
      favoriteToggle([app], { dir: '/work/app', name: 'app', favorite: 'f-1' }, new Set(['f-1']))
    ).toEqual({ kind: 'forget', id: 'f-1' })
  })

  it('forgets the linked entry even when the directory is unknown', () => {
    expect(favoriteToggle([app], { dir: undefined, name: 'Shell', favorite: 'f-1' }, none)).toEqual(
      { kind: 'forget', id: 'f-1' }
    )
  })

  it('does nothing but report when an unlinked workspace has no directory yet', () => {
    expect(favoriteToggle([app], { dir: undefined, name: 'Shell' }, none)).toEqual({
      kind: 'unknown'
    })
  })

  it('links to an entry of the same directory and name that no open workspace points to', () => {
    expect(favoriteToggle([app], { dir: '/work/lib/../app', name: 'app' }, none)).toEqual({
      kind: 'link',
      id: 'f-1'
    })
  })

  it('adds a new entry when the matching entry is taken by another open workspace', () => {
    expect(favoriteToggle([app], { dir: '/work/app', name: 'app' }, new Set(['f-1']))).toEqual({
      kind: 'add',
      favorite: { id: expect.stringMatching(/^f-[0-9a-f]{8}$/), dir: '/work/app', name: 'app' }
    })
  })

  it('adds a new entry when the name differs', () => {
    expect(favoriteToggle([app], { dir: '/work/app', name: 'app review' }, none)).toEqual({
      kind: 'add',
      favorite: {
        id: expect.stringMatching(/^f-[0-9a-f]{8}$/),
        dir: '/work/app',
        name: 'app review'
      }
    })
  })

  it('links to a free entry of the same directory and name when the entry the workspace pointed to was removed', () => {
    const action = favoriteToggle(
      [app],
      { dir: '/work/app', name: 'app', favorite: 'f-9' },
      new Set(['f-9'])
    )
    expect(action).toEqual({ kind: 'link', id: 'f-1' })
  })

  it('adds a new entry when the entry the workspace pointed to was removed', () => {
    const action = favoriteToggle([], { dir: '/work/app', name: 'app', favorite: 'f-1' }, none)
    expect(action).toMatchObject({ kind: 'add', favorite: { dir: '/work/app', name: 'app' } })
    expect(action.kind === 'add' && action.favorite.id).not.toBe('f-1')
  })
})

describe('createFavorites', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stub() {
    let resolveRead!: (s: LauncherState) => void
    const read = new Promise<LauncherState>((r) => (resolveRead = r))
    const after = (favorites: Favorite[]): LauncherState => ({
      recent: [],
      favorites,
      command: null
    })
    const addFavorite = vi.fn(async (favorite: Favorite) => after([app, favorite]))
    const forgetFavorite = vi.fn(async () => after([]))
    vi.stubGlobal('window', {
      maru: {
        launcherState: () => read,
        addFavorite,
        forgetFavorite,
        renameFavorite: async (id: string, name: string) => after([{ ...app, id, name }])
      }
    })
    return { resolveRead, addFavorite, forgetFavorite }
  }

  it('neither adds nor forgets on a toggle before the saved list arrives, then toggles the saved entry', async () => {
    const { resolveRead, addFavorite, forgetFavorite } = stub()
    const favorites = createFavorites()
    const linked = { dir: '/work/app', name: 'app', favorite: 'f-1' }
    expect(favorites.toggle(linked, new Set(['f-1']))).toEqual({ kind: 'loading' })
    expect(favorites.toggle({ dir: '/work/lib', name: 'lib' }, new Set())).toEqual({
      kind: 'loading'
    })
    expect(addFavorite).not.toHaveBeenCalled()
    expect(forgetFavorite).not.toHaveBeenCalled()
    expect(favorites.list.value).toEqual([])

    resolveRead({ recent: [], favorites: [app], command: null })
    await vi.waitFor(() => expect(favorites.list.value).toEqual([app]))
    expect(favorites.toggle(linked, new Set(['f-1']))).toEqual({ kind: 'forget', id: 'f-1' })
    expect(forgetFavorite).toHaveBeenCalledWith('f-1')
    expect(addFavorite).not.toHaveBeenCalled()
  })

  it('adds the new entry on a toggle after the saved list arrives', async () => {
    const { resolveRead, addFavorite } = stub()
    const favorites = createFavorites()
    resolveRead({ recent: [], favorites: [], command: null })
    await vi.waitFor(() =>
      expect(favorites.toggle({ dir: '/work/app', name: 'app' }, new Set()).kind).toBe('add')
    )
    expect(addFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ dir: '/work/app', name: 'app' })
    )
  })

  it('별로 빼든 런처에서 빼든 빼기 전에 onForget 을 그 id 로 부른다', async () => {
    const { resolveRead } = stub()
    const onForget = vi.fn()
    const favorites = createFavorites(onForget)
    resolveRead({ recent: [], favorites: [app], command: null })
    await vi.waitFor(() => expect(favorites.list.value).toEqual([app]))
    favorites.toggle({ dir: '/work/app', name: 'app', favorite: 'f-1' }, new Set(['f-1']))
    expect(onForget).toHaveBeenLastCalledWith('f-1')
    await favorites.forget('f-2')
    expect(onForget).toHaveBeenLastCalledWith('f-2')
  })

  it('loads the saved list', async () => {
    const { resolveRead } = stub()
    const favorites = createFavorites()
    resolveRead({ recent: [], favorites: [app], command: null })
    await vi.waitFor(() => expect(favorites.list.value).toEqual([app]))
  })

  it('lists an added entry before main answers', () => {
    stub()
    const favorites = createFavorites()
    const added = { id: 'f-2', dir: '/work/app', name: 'review' }
    void favorites.add(added)
    expect(favorites.list.value).toEqual([added])
  })

  it('keeps a change made before the saved list arrives', async () => {
    const { resolveRead } = stub()
    const favorites = createFavorites()
    await favorites.forget(app.id)
    resolveRead({ recent: [], favorites: [app], command: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(favorites.list.value).toEqual([])
  })
})

describe('pinToggle', () => {
  const pinned = { ...app, pins: ['/work/app/x'] }

  it('cell 이 맡은 핀이 즐겨찾기의 pins 에 있으면 그 핀을 뺀다. 그 사이 cd 한 디렉토리는 보지 않는다', () => {
    expect(pinToggle(pinned, '/work/app/x/', '/work/y')).toEqual({
      kind: 'unpin',
      dir: '/work/app/x/'
    })
  })

  it('즐겨찾기가 아니거나 pins 에 없는 낡은 핀이면 첫 pane 의 지금 디렉토리로 꽂는다', () => {
    expect(pinToggle(undefined, undefined, '/work/y')).toEqual({ kind: 'pin', dir: '/work/y' })
    expect(pinToggle(undefined, '/work/app/x', '/work/y')).toEqual({ kind: 'pin', dir: '/work/y' })
    expect(pinToggle(app, '/work/app/x', '/work/y')).toEqual({ kind: 'pin', dir: '/work/y' })
    expect(pinToggle(pinned, undefined, '/work/app/x')).toEqual({ kind: 'pin', dir: '/work/app/x' })
  })

  it('꽂을 디렉토리를 모르면 unknown 이다', () => {
    expect(pinToggle(pinned, undefined, undefined)).toEqual({ kind: 'unknown' })
  })
})

describe('pinsOnLink', () => {
  const cell = (key: number, cwd?: string, pin?: string) => ({ key, pin, panes: [{ cwd }] })

  it('핀마다 첫 pane 이 그 디렉토리에 있는 첫 cell 이 맡고, 순서는 pins 의 순서다', () => {
    const cells = [cell(1, '/p'), cell(2, '/p/api/'), cell(3, '/p/api'), cell(4, '/p/web')]
    expect(pinsOnLink(['/p/web', '/p/api'], cells)).toEqual([
      { cell: 4, dir: '/p/web' },
      { cell: 2, dir: '/p/api' }
    ])
  })

  it('맞는 cell 이 없거나, 이미 핀을 맡았거나, 디렉토리를 모르는 cell 은 맡지 않는다', () => {
    const cells = [cell(1, '/p/api', '/q'), cell(2, undefined), cell(3, '/p')]
    expect(pinsOnLink(['/p/api', '/r'], cells)).toEqual([])
  })
})
