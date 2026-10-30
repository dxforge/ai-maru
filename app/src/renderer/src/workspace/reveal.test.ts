import { describe, expect, it } from 'vitest'
import { arrangementKey, easeInOut, smoothReveal } from './reveal'

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
