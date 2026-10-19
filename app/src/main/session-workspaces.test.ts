import { describe, expect, it } from 'vitest'
import { createSessionWorkspaces } from './session-workspaces'

describe('createSessionWorkspaces', () => {
  it('연 세션마다 그 workspace 를 돌려주고, 열지 않은 세션은 모른다', () => {
    const ws = createSessionWorkspaces()
    ws.open('k1', 's-00000001', 'w-00000001')
    ws.open('k2', 's-00000002', 'w-00000001')
    ws.open('k3', 's-00000003', 'w-00000002')
    expect(ws.workspaceOf('s-00000001')).toBe('w-00000001')
    expect(ws.workspaceOf('s-00000002')).toBe('w-00000001')
    expect(ws.workspaceOf('s-00000003')).toBe('w-00000002')
    expect(ws.workspaceOf('s-00000004')).toBeUndefined()
  })

  it('끈 세션은 잊고, 다른 세션은 그대로 둔다', () => {
    const ws = createSessionWorkspaces()
    ws.open('k1', 's-00000001', 'w-00000001')
    ws.open('k2', 's-00000002', 'w-00000001')
    ws.close('k1')
    ws.close('k-unknown')
    expect(ws.workspaceOf('s-00000001')).toBeUndefined()
    expect(ws.workspaceOf('s-00000002')).toBe('w-00000001')
  })

  it('workspace 의 마지막 세션을 끄면 그 workspace id 를 돌려준다', () => {
    const ws = createSessionWorkspaces()
    ws.open('k1', 's-00000001', 'w-00000001')
    ws.open('k2', 's-00000002', 'w-00000001')
    ws.open('k3', 's-00000003', 'w-00000002')
    expect(ws.close('k1')).toBeUndefined()
    expect(ws.close('k2')).toBe('w-00000001')
    expect(ws.close('k2')).toBeUndefined()
    expect(ws.close('k-unknown')).toBeUndefined()
  })
})
