import { describe, expect, it } from 'vitest'
import { arrowIndex } from './palette'

describe('arrowIndex', () => {
  it('팔레트가 위에 있으면 ↓ 는 다음 후보, ↑ 는 앞 후보이고 끝에서 돈다', () => {
    expect(arrowIndex('ArrowDown', 0, 3, 'top')).toBe(1)
    expect(arrowIndex('ArrowDown', 2, 3, 'top')).toBe(0)
    expect(arrowIndex('ArrowUp', 1, 3, 'top')).toBe(0)
    expect(arrowIndex('ArrowUp', 0, 3, 'top')).toBe(2)
  })

  it('팔레트가 아래에 있으면 후보가 위로 쌓이므로 ↑ 가 다음 후보다', () => {
    expect(arrowIndex('ArrowUp', 0, 3, 'bottom')).toBe(1)
    expect(arrowIndex('ArrowUp', 2, 3, 'bottom')).toBe(0)
    expect(arrowIndex('ArrowDown', 1, 3, 'bottom')).toBe(0)
    expect(arrowIndex('ArrowDown', 0, 3, 'bottom')).toBe(2)
  })

  it('화살표가 아니거나 후보가 없으면 옮기지 않는다', () => {
    expect(arrowIndex('Enter', 0, 3, 'top')).toBeUndefined()
    expect(arrowIndex('ArrowLeft', 0, 3, 'top')).toBeUndefined()
    expect(arrowIndex('ArrowDown', 0, 0, 'top')).toBeUndefined()
  })
})
