import { describe, expect, it } from 'vitest'
import { createSessionCells } from './session-cells'

describe('createSessionCells', () => {
  it('연 세션마다 그 cell 을 돌려주고, 열지 않은 세션은 모른다', () => {
    const cs = createSessionCells()
    cs.open('k1', 's-00000001', 'c-00000001')
    cs.open('k2', 's-00000002', 'c-00000001')
    cs.open('k3', 's-00000003', 'c-00000002')
    expect(cs.cellOf('s-00000001')).toBe('c-00000001')
    expect(cs.cellOf('s-00000002')).toBe('c-00000001')
    expect(cs.cellOf('s-00000003')).toBe('c-00000002')
    expect(cs.cellOf('s-00000004')).toBeUndefined()
  })

  it('끈 세션은 잊고, 다른 세션은 그대로 둔다', () => {
    const cs = createSessionCells()
    cs.open('k1', 's-00000001', 'c-00000001')
    cs.open('k2', 's-00000002', 'c-00000001')
    cs.close('k1')
    cs.close('k-unknown')
    expect(cs.cellOf('s-00000001')).toBeUndefined()
    expect(cs.cellOf('s-00000002')).toBe('c-00000001')
  })

  it('끈 key 의 세션 id 를 돌려주고, cell 의 마지막 세션이면 그 cell id 도 돌려준다', () => {
    const cs = createSessionCells()
    cs.open('k1', 's-00000001', 'c-00000001')
    cs.open('k2', 's-00000002', 'c-00000001')
    cs.open('k3', 's-00000003', 'c-00000002')
    expect(cs.close('k1')).toEqual({ session: 's-00000001' })
    expect(cs.close('k2')).toEqual({ session: 's-00000002', closed: 'c-00000001' })
    expect(cs.close('k2')).toBeUndefined()
    expect(cs.close('k-unknown')).toBeUndefined()
  })
})
