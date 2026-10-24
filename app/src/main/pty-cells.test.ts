import { describe, expect, it } from 'vitest'
import { createPtyCells } from './pty-cells'

describe('createPtyCells', () => {
  it('연 pty 마다 그 cell 을 돌려주고, 열지 않은 pty 는 모른다', () => {
    const cs = createPtyCells()
    cs.open('k1', 'p-00000001', 'c-00000001')
    cs.open('k2', 'p-00000002', 'c-00000001')
    cs.open('k3', 'p-00000003', 'c-00000002')
    expect(cs.cellOf('p-00000001')).toBe('c-00000001')
    expect(cs.cellOf('p-00000002')).toBe('c-00000001')
    expect(cs.cellOf('p-00000003')).toBe('c-00000002')
    expect(cs.cellOf('p-00000004')).toBeUndefined()
  })

  it('끈 pty 는 잊고, 다른 pty 는 그대로 둔다', () => {
    const cs = createPtyCells()
    cs.open('k1', 'p-00000001', 'c-00000001')
    cs.open('k2', 'p-00000002', 'c-00000001')
    cs.close('k1')
    cs.close('k-unknown')
    expect(cs.cellOf('p-00000001')).toBeUndefined()
    expect(cs.cellOf('p-00000002')).toBe('c-00000001')
  })

  it('끈 key 의 pty id 를 돌려주고, cell 의 마지막 pty 면 그 cell id 도 돌려준다', () => {
    const cs = createPtyCells()
    cs.open('k1', 'p-00000001', 'c-00000001')
    cs.open('k2', 'p-00000002', 'c-00000001')
    cs.open('k3', 'p-00000003', 'c-00000002')
    expect(cs.close('k1')).toEqual({ pty: 'p-00000001' })
    expect(cs.close('k2')).toEqual({ pty: 'p-00000002', closed: 'c-00000001' })
    expect(cs.close('k2')).toBeUndefined()
    expect(cs.close('k-unknown')).toBeUndefined()
  })
})
