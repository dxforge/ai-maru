import { describe, expect, it } from 'vitest'
import { baselineOffset } from './composition'

const base = {
  dpr: 1,
  charTop: 1,
  charHeight: 17,
  ideographicBaseline: -3,
  domBaseline: 15,
  canvasOverflow: 0
}

describe('baselineOffset', () => {
  it('두 기준선이 같으면 옮기지 않는다', () => {
    expect(baselineOffset(base)).toBe(0)
  })

  it('renderer 의 기준선이 아래에 있으면 그만큼 내린다', () => {
    expect(baselineOffset({ ...base, domBaseline: 14 })).toBe(1)
  })

  it('renderer 의 기준선이 위에 있으면 올린다', () => {
    expect(baselineOffset({ ...base, domBaseline: 16 })).toBe(-1)
  })

  it('WebGL 캔버스가 계산보다 1px 크면 1 device px 더 내린다', () => {
    expect(
      baselineOffset({
        ...base,
        dpr: 2,
        charTop: 2,
        charHeight: 34,
        ideographicBaseline: -6,
        canvasOverflow: 1
      })
    ).toBe(0.5)
  })

  it('device px 격자에 맞춰 반올림한다', () => {
    expect(baselineOffset({ ...base, dpr: 2.2, domBaseline: (15 - 1.3) / 2.2 })).toBeCloseTo(
      1 / 2.2
    )
  })
})
