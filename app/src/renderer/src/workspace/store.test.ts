import { describe, expect, it } from 'vitest'
import { createWorkspaces } from './store'

function opened(n: number) {
  const ws = createWorkspaces()
  for (let i = 0; i < n; i++) ws.open(`s-${i}`)
  return ws
}

const keys = (ws: ReturnType<typeof createWorkspaces>) => ws.list.value.map((w) => w.key)

describe('workspaces', () => {
  it('연 workspace 는 목록 끝에 붙고 선택된다', () => {
    const ws = opened(2)
    ws.open()
    expect(ws.list.value.map((w) => w.sessionId)).toEqual(['s-0', 's-1', undefined])
    expect(ws.selectedKey.value).toBe(keys(ws)[2])
  })

  it('선택한 workspace 가 닫히면 바로 아래 것을 선택한다', () => {
    const ws = opened(3)
    const [, middle, last] = keys(ws)
    ws.select(middle)
    ws.close(middle)
    expect(ws.selectedKey.value).toBe(last)
  })

  it('맨 아래의 선택한 workspace 가 닫히면 바로 위 것을 선택한다', () => {
    const ws = opened(3)
    const [, middle, last] = keys(ws)
    ws.close(last)
    expect(ws.selectedKey.value).toBe(middle)
  })

  it('선택하지 않은 workspace 가 닫히면 선택은 그대로다', () => {
    const ws = opened(3)
    const [first, , last] = keys(ws)
    ws.close(first)
    expect(ws.selectedKey.value).toBe(last)
  })

  it('마지막 workspace 가 닫히면 아무것도 선택하지 않는다', () => {
    const ws = opened(1)
    ws.close(keys(ws)[0])
    expect(ws.list.value).toEqual([])
    expect(ws.selectedKey.value).toBeNull()
  })
})
