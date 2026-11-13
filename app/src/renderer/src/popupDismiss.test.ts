import { describe, expect, it } from 'vitest'
import { popupTop } from './popupDismiss'

describe('popupTop', () => {
  it('아래에 자리가 있으면 기준 아래에 둔다', () => {
    expect(popupTop({ top: 100, bottom: 120 }, 50, 400)).toBe(124)
  })

  it('아래가 모자라고 위에 자리가 있으면 기준 위로 올린다', () => {
    expect(popupTop({ top: 300, bottom: 320 }, 100, 400)).toBe(196)
  })

  it('위아래 모두 모자라면 아래에 두되 창 안으로 당긴다', () => {
    expect(popupTop({ top: 50, bottom: 70 }, 350, 400)).toBe(42)
    expect(popupTop({ top: 50, bottom: 70 }, 500, 400)).toBe(8)
  })
})
