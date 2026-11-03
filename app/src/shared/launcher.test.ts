import { describe, expect, it } from 'vitest'
import { favoriteById, findFavorite, samePath } from './launcher'

describe('samePath', () => {
  it('treats NFD and NFC spellings of a name as the same directory', () => {
    expect(samePath('/w/한', '/w/한')).toBe(true)
  })

  it('resolves dot segments and repeated slashes', () => {
    expect(samePath('/w/a/../b/./c//', '/w/b/c')).toBe(true)
  })

  it('tells different directories apart', () => {
    expect(samePath('/w/a', '/w/ab')).toBe(false)
    expect(samePath('/w/a/..', '/w/a')).toBe(false)
  })
})

describe('findFavorite', () => {
  const favorites = [{ id: 'f-1', dir: '/work/app', name: 'app' }]

  it('finds the favorite for a directory typed with ..', () => {
    expect(findFavorite(favorites, '/work/lib/../app')).toBe(favorites[0])
  })

  it('finds nothing for another directory', () => {
    expect(findFavorite(favorites, '/work/lib')).toBeUndefined()
  })
})

describe('favoriteById', () => {
  const favorites = [
    { id: 'f-1', dir: '/work/app', name: 'app' },
    { id: 'f-2', dir: '/work/app', name: 'app review' }
  ]

  it('finds the entry with the id among entries of the same directory', () => {
    expect(favoriteById(favorites, 'f-2')).toBe(favorites[1])
  })

  it('finds nothing for an unknown or missing id', () => {
    expect(favoriteById(favorites, 'f-3')).toBeUndefined()
    expect(favoriteById(favorites, undefined)).toBeUndefined()
  })
})
