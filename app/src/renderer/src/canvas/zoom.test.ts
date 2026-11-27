import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fitScale, stepZoom, wheelZoom, ZOOM_STEPS, zoomLabel } from './zoom'

describe('stepZoom', () => {
  it('단계 위의 배율에서는 이웃 단계로 가고, 끝에서는 그대로다', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(0.5, -1)).toBe(1 / 3)
    expect(stepZoom(5, 1)).toBe(5)
    expect(stepZoom(0.25, -1)).toBe(0.25)
  })

  it('범위 밖의 배율에서는 범위 쪽 끝 단계로 가고, 범위 밖으로는 더 가지 않는다', () => {
    expect(stepZoom(0.12, 1)).toBe(0.25)
    expect(stepZoom(0.12, -1)).toBe(0.12)
    expect(stepZoom(7, -1)).toBe(5)
    expect(stepZoom(7, 1)).toBe(7)
  })

  it('단계 사이의 배율에서는 그 방향의 가장 가까운 단계로 간다', () => {
    expect(stepZoom(1.05, 1)).toBe(1.1)
    expect(stepZoom(1.05, -1)).toBe(1)
    expect(stepZoom(1 / 3 + 1e-9, -1)).toBe(0.25)
  })

  it('끝 단계에서 끝 단계까지 한 단계씩 모두 지난다', () => {
    const up = [ZOOM_STEPS[0]!]
    while (up.length < 30 && stepZoom(up.at(-1)!, 1) !== up.at(-1)) up.push(stepZoom(up.at(-1)!, 1))
    expect(up).toEqual([...ZOOM_STEPS])
  })
})

describe('wheelZoom', () => {
  it('deltaY 가 span·ln s 만큼 쌓이면 s 배가 된다', () => {
    expect(wheelZoom(1, -100 * Math.log(2), 100)).toBeCloseTo(2)
    expect(wheelZoom(2, -500 * Math.log(0.5), 500)).toBeCloseTo(1)
    expect(wheelZoom(1.5, 0, 500)).toBe(1.5)
  })

  it('이벤트 하나는 그 deltaY 만큼만 바꾸어, 작은 이벤트를 여러 번 받은 것과 큰 이벤트 하나가 같다', () => {
    let scale = 1
    for (let i = 0; i < 10; i++) scale = wheelZoom(scale, -30, 500)
    expect(scale).toBeCloseTo(wheelZoom(1, -300, 500))
    expect(wheelZoom(1, -4, 500)).toBeCloseTo(1.008, 3)
  })

  it('단계의 끝을 넘지 않는다', () => {
    expect(wheelZoom(4, -1000, 100)).toBe(5)
    expect(wheelZoom(0.3, 1000, 100)).toBe(0.25)
  })

  it('범위 밖의 배율에서는 범위 쪽으로만 움직인다', () => {
    expect(wheelZoom(0.12, 100, 100)).toBe(0.12)
    expect(wheelZoom(0.12, -100, 100)).toBeCloseTo(0.12 * Math.E)
    expect(wheelZoom(0.12, -1000, 100)).toBe(5)
    expect(wheelZoom(7, -100, 100)).toBe(7)
    expect(wheelZoom(7, 100, 100)).toBeCloseTo(7 / Math.E)
  })
})

it('zoomLabel 은 배율을 반올림한 백분율로 적는다', () => {
  expect(zoomLabel(1)).toBe('100%')
  expect(zoomLabel(1 / 3)).toBe('33%')
  expect(zoomLabel(2 / 3)).toBe('67%')
})

describe('fitScale', () => {
  it('너비와 높이 가운데 더 좁은 쪽에 맞춘다', () => {
    expect(fitScale({ width: 1000, height: 600 }, { width: 430, height: 800 })).toBe(0.43)
    expect(fitScale({ width: 1000, height: 2000 }, { width: 430, height: 240 })).toBe(0.12)
  })

  it('작은 그림은 키우되 500% 를 넘지 않는다', () => {
    expect(fitScale({ width: 200, height: 100 }, { width: 430, height: 800 })).toBe(2.15)
    expect(fitScale({ width: 10, height: 10 }, { width: 430, height: 800 })).toBe(5)
  })

  it('0 이하인 변은 보지 않는다', () => {
    expect(fitScale({ width: 1000, height: 600 }, { width: 430, height: Infinity })).toBe(0.43)
    expect(fitScale({ width: 1000, height: 600 }, { width: 430, height: -20 })).toBe(0.43)
    expect(fitScale({ width: 1000, height: 600 }, { width: 0, height: 0 })).toBe(5)
  })

  it('맞춘 그림은 room 안에 들어오고, 500% 가 아니면 한 변이 room 에 닿는다', () => {
    const side = fc.double({ min: 1, max: 10_000, noNaN: true })
    fc.assert(
      fc.property(side, side, side, side, (width, height, roomWidth, roomHeight) => {
        const scale = fitScale({ width, height }, { width: roomWidth, height: roomHeight })
        const [w, h] = [width * scale, height * scale]
        const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * b
        expect(w <= roomWidth || near(w, roomWidth)).toBe(true)
        expect(h <= roomHeight || near(h, roomHeight)).toBe(true)
        expect(scale === 5 || near(w, roomWidth) || near(h, roomHeight)).toBe(true)
      })
    )
  })
})
