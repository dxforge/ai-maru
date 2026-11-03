import { describe, expect, it } from 'vitest'
import { findFavorite, samePath } from './launcher'

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
  const favorites = [{ dir: '/w/atlas/server', name: 'atlas' }]

  it('finds the favorite for a directory typed with ..', () => {
    expect(findFavorite(favorites, '/w/atlas/x/../server')).toBe(favorites[0])
  })

  it('finds nothing for an unknown directory', () => {
    expect(findFavorite(favorites, undefined)).toBeUndefined()
  })
})
