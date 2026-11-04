import { describe, expect, it } from 'vitest'
import { samePath } from './launcher'

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
