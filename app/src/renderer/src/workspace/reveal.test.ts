import { describe, expect, it } from 'vitest'
import {
  arrangementKey,
  easeInOut,
  scrollPlan,
  shapeOf,
  shiftScrolling,
  smoothReveal
} from './reveal'

const style = (left: number) => ({ left: `${left}px`, top: '0px', width: '100px', height: '50px' })

function views(o: { width?: string; left?: number; order?: number[]; extra?: object } = {}) {
  const { width = '656px', left = 0, order = [1, 2], extra = {} } = o
  return order.map((key) => ({
    c: { key },
    width,
    ...extra,
    panes: [{ p: { key: key * 10 }, style: style(left), ...extra }]
  }))
}

describe('arrangementKey', () => {
  it('cell 폭, pane 의 자리, cell 순서가 바뀌면 바뀐다', () => {
    const base = arrangementKey(views())
    expect(arrangementKey(views({ width: '820px' }))).not.toBe(base)
    expect(arrangementKey(views({ left: 8 }))).not.toBe(base)
    expect(arrangementKey(views({ order: [2, 1] }))).not.toBe(base)
    expect(arrangementKey(views({ order: [1] }))).not.toBe(base)
  })

  it('자리와 상관없는 값(포커스 표시 등)만 바뀌면 그대로다', () => {
    const base = arrangementKey(views({ extra: { selected: false, active: false } }))
    expect(arrangementKey(views({ extra: { selected: true, active: true } }))).toBe(base)
  })
})

describe('smoothReveal', () => {
  const smooth = { smooth: true, settled: true, reducedMotion: false, from: 0, to: 300 }

  it('움직일 거리가 있고, 앱이 자리를 잡았고, 동작 줄이기가 꺼져 있으면 부드럽게 움직인다', () => {
    expect(smoothReveal(smooth)).toBe(true)
  })

  it('하나라도 아니면 바로 그 자리에 선다', () => {
    expect(smoothReveal({ ...smooth, smooth: false })).toBe(false)
    expect(smoothReveal({ ...smooth, settled: false })).toBe(false)
    expect(smoothReveal({ ...smooth, reducedMotion: true })).toBe(false)
    expect(smoothReveal({ ...smooth, to: 0 })).toBe(false)
  })
})

describe('shiftScrolling', () => {
  it('출발점과 도착점을 같은 만큼 옮기고, 옮긴 뒤의 자리를 마지막 자리로 둔다', () => {
    expect(shiftScrolling({ from: 100, to: 400, last: 250 }, 660, 910)).toEqual({
      from: 760,
      to: 1060,
      last: 910
    })
  })
})

describe('easeInOut', () => {
  it('0 에서 시작해 가운데를 지나 1 에서 끝나고, 처음과 끝이 느리다', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.1)).toBeLessThan(0.1)
    expect(easeInOut(0.9)).toBeGreaterThan(0.9)
  })

  it('줄지 않고 늘기만 한다', () => {
    const values = Array.from({ length: 21 }, (_, i) => easeInOut(i / 20))
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })
})

describe('shapeOf', () => {
  it('cell 폭이나 그 안의 pane 자리가 바뀌면 바뀌고, 다른 값만 바뀌면 그대로다', () => {
    const [base] = views({ extra: { selected: false } })
    expect(shapeOf(views({ width: '820px' })[0])).not.toBe(shapeOf(base))
    expect(shapeOf(views({ left: 8 })[0])).not.toBe(shapeOf(base))
    expect(shapeOf(views({ extra: { selected: true } })[0])).toBe(shapeOf(base))
  })
})

describe('scrollPlan', () => {
  const focus = { cell: 1, pane: 10, shape: 'a' }
  const plan = {
    modeChanged: false,
    settled: true,
    before: focus,
    after: focus,
    beforeGone: false
  }

  it('포커스와 그 cell 의 모양이 그대로면 포커스된 cell 을 제자리에 둔다', () => {
    expect(scrollPlan(plan)).toBe('hold')
  })

  it('포커스된 cell 이 닫혀 다른 cell 이 포커스를 받으면 그 cell 을 닫힌 자리에 둔다', () => {
    expect(
      scrollPlan({ ...plan, after: { cell: 2, pane: 20, shape: 'b' }, beforeGone: true })
    ).toBe('take')
  })

  it('포커스를 다른 cell 로 옮기면 포커스된 pane 이 보이게 스크롤한다', () => {
    expect(scrollPlan({ ...plan, after: { cell: 2, pane: 20, shape: 'b' } })).toBe('reveal')
  })

  it('같은 cell 에서 포커스된 pane 이 바뀌거나 그 cell 의 모양이 바뀌면 보이게 스크롤한다', () => {
    expect(scrollPlan({ ...plan, after: { ...focus, pane: 11 } })).toBe('reveal')
    expect(scrollPlan({ ...plan, after: { ...focus, shape: 'c' } })).toBe('reveal')
  })

  it('보기를 바꿨거나, 앱이 뜬 뒤 자리를 잡기 전이거나, 포커스된 cell 이 없으면 보이게 스크롤한다', () => {
    expect(scrollPlan({ ...plan, modeChanged: true })).toBe('reveal')
    expect(scrollPlan({ ...plan, settled: false })).toBe('reveal')
    expect(scrollPlan({ ...plan, after: {}, beforeGone: true })).toBe('reveal')
  })

  it('앞서 포커스된 cell 이 없었으면 새로 포커스된 cell 을 보이게 스크롤한다', () => {
    expect(scrollPlan({ ...plan, before: {}, after: focus })).toBe('reveal')
  })
})
