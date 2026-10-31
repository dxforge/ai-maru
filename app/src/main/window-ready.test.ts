import { describe, expect, it } from 'vitest'
import { createWindowReady } from './window-ready'

describe('createWindowReady', () => {
  it('준비되기 전에 온 것은 쌓았다가 준비되면 온 순서대로 한 번씩 부른다', () => {
    const calls: string[] = []
    const w = createWindowReady()
    w.whenReady(() => calls.push('a'))
    w.whenReady(() => calls.push('b'))
    expect(calls).toEqual([])
    w.ready()
    w.ready()
    expect(calls).toEqual(['a', 'b'])
  })

  it('준비된 뒤에 온 것은 바로 부른다', () => {
    const calls: string[] = []
    const w = createWindowReady()
    w.ready()
    w.whenReady(() => calls.push('a'))
    expect(calls).toEqual(['a'])
  })

  it('unready 뒤에 온 것은 다음 ready 까지 쌓는다', () => {
    const calls: string[] = []
    const w = createWindowReady()
    w.ready()
    w.unready()
    w.whenReady(() => calls.push('a'))
    expect(calls).toEqual([])
    w.ready()
    expect(calls).toEqual(['a'])
  })

  it('뺀 것은 준비돼도 부르지 않는다', () => {
    const calls: string[] = []
    const w = createWindowReady()
    const unqueue = w.whenReady(() => calls.push('a'))
    w.whenReady(() => calls.push('b'))
    unqueue()
    w.ready()
    expect(calls).toEqual(['b'])
  })
})
