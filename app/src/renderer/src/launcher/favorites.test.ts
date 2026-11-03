import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Favorite, LauncherState } from '../../../shared/launcher'
import { createFavorites, favoriteToggle } from './favorites'

const server: Favorite = { dir: '/w/atlas/server', name: 'atlas' }

describe('favoriteToggle', () => {
  it('does nothing but report when the directory is unknown', () => {
    expect(favoriteToggle([server], undefined, 'Shell')).toEqual({ kind: 'unknown' })
  })

  it('adds the directory with the current name when it is not a favorite', () => {
    expect(favoriteToggle([server], '/w/other', 'other')).toEqual({
      kind: 'add',
      dir: '/w/other',
      name: 'other'
    })
  })

  it('forgets the stored entry when the same directory is spelled differently', () => {
    expect(favoriteToggle([server], '/w/atlas/sub/../server', 'server')).toEqual({
      kind: 'forget',
      dir: '/w/atlas/server'
    })
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
        addFavorite: async (dir: string, name: string) => after([server, { dir, name }]),
        forgetFavorite: async () => after([]),
        renameFavorite: async (dir: string, name: string) => after([{ dir, name }])
      }
    })
    return { resolveRead }
  }

  it('loads the saved list', async () => {
    const { resolveRead } = stub()
    const favorites = createFavorites()
    resolveRead({ recent: [], favorites: [server], command: null })
    await vi.waitFor(() => expect(favorites.list.value).toEqual([server]))
  })

  it('keeps a change made before the saved list arrives', async () => {
    const { resolveRead } = stub()
    const favorites = createFavorites()
    await favorites.forget(server.dir)
    resolveRead({ recent: [], favorites: [server], command: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(favorites.list.value).toEqual([])
  })
})
