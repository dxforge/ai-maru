import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Favorite, LauncherState } from '../../../shared/launcher'
import { createFavorites, favoriteToggle } from './favorites'

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

  function stub(): { resolveRead: (s: LauncherState) => void } {
    let resolveRead!: (s: LauncherState) => void
    const read = new Promise<LauncherState>((r) => (resolveRead = r))
    const after = (favorites: Favorite[]): LauncherState => ({
      recent: [],
      favorites,
      command: null
    })
    vi.stubGlobal('window', {
      maru: {
        launcherState: () => read,
        addFavorite: async (favorite: Favorite) => after([app, favorite]),
        forgetFavorite: async () => after([]),
        renameFavorite: async (id: string, name: string) => after([{ ...app, id, name }])
      }
    })
    return { resolveRead }
  }

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
