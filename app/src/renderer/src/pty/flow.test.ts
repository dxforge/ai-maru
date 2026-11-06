import { describe, expect, it } from 'vitest'
import { Acks, HIDDEN_AHEAD } from './flow'

function acks(hidden = false) {
  const sent: number[] = []
  const state = { hidden }
  const a = new Acks(
    (n) => sent.push(n),
    () => state.hidden
  )
  return { a, sent, state }
}

describe('Acks', () => {
  it('보이는 창에서는 그린 만큼만 알린다', () => {
    const { a, sent } = acks()
    a.wrote(100)
    a.wrote(50)
    expect(sent).toEqual([])
    a.drew(100)
    a.drew(50)
    expect(sent).toEqual([100, 50])
  })

  it('숨긴 창에서는 받은 즉시 알리되, 그리지 않은 양이 한도를 넘지 않게 한다', () => {
    const { a, sent } = acks(true)
    a.wrote(100)
    expect(sent).toEqual([100])
    a.wrote(2 * HIDDEN_AHEAD)
    expect(sent).toEqual([100, HIDDEN_AHEAD - 100])
    a.drew(300)
    expect(sent).toEqual([100, HIDDEN_AHEAD - 100, 300])
  })

  it('숨겼다 보이면 앞서 알린 양을 그릴 때까지 더 알리지 않는다', () => {
    const { a, sent, state } = acks(true)
    a.wrote(1000)
    state.hidden = false
    a.wrote(500)
    a.drew(1200)
    expect(sent).toEqual([1000, 200])
  })

  it('보이다 숨기면 받거나 그리지 않아도 그리지 않은 양까지 알린다', () => {
    const { a, sent, state } = acks()
    a.wrote(1000)
    a.drew(100)
    state.hidden = true
    a.flush()
    expect(sent).toEqual([100, 900])
  })
})
