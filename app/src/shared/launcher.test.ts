import { describe, expect, it } from 'vitest'
import { favoriteById, samePath, withoutPin, withPin } from './launcher'

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

describe('withPin·withoutPin', () => {
  const app = { id: 'f-1', dir: '/work/app', name: 'app' }

  it('withPin 은 핀을 끝에 더하고, 같은 디렉토리면 그대로 둔다', () => {
    const one = withPin(app, '/work/app/x')
    expect(one).toEqual({ ...app, pins: ['/work/app/x'] })
    expect(withPin(one, '/work/app/x/')).toBe(one)
    expect(withPin(one, '/work/y').pins).toEqual(['/work/app/x', '/work/y'])
  })

  it('withoutPin 은 같은 디렉토리의 핀을 빼고, 남은 핀이 없으면 pins 키를 없앤다', () => {
    expect(withoutPin({ ...app, pins: ['/a', '/b'] }, '/a/').pins).toEqual(['/b'])
    expect(withoutPin({ ...app, pins: ['/a'] }, '/a')).toEqual(app)
  })
})
