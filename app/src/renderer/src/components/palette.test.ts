import { describe, expect, it } from 'vitest'
import { arrowIndex } from './palette'

describe('arrowIndex', () => {
  it('↓ 는 다음 후보, ↑ 는 앞 후보이고 끝에서 돈다', () => {
    expect(arrowIndex('ArrowDown', 0, 3)).toBe(1)
    expect(arrowIndex('ArrowDown', 2, 3)).toBe(0)
    expect(arrowIndex('ArrowUp', 1, 3)).toBe(0)
    expect(arrowIndex('ArrowUp', 0, 3)).toBe(2)
  })

  it('아무것도 고르지 않았으면 ↓ 는 첫 후보, ↑ 는 마지막 후보다', () => {
    expect(arrowIndex('ArrowDown', -1, 3)).toBe(0)
    expect(arrowIndex('ArrowUp', -1, 3)).toBe(2)
  })

  it('화살표가 아니거나 후보가 없으면 옮기지 않는다', () => {
    expect(arrowIndex('Enter', 0, 3)).toBeUndefined()
    expect(arrowIndex('ArrowLeft', 0, 3)).toBeUndefined()
    expect(arrowIndex('ArrowDown', 0, 0)).toBeUndefined()
  })
})
