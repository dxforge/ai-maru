import { describe, expect, it } from 'vitest'
import { createWorkspaces } from './store'

function opened(n: number) {
  const ws = createWorkspaces()
  for (let i = 0; i < n; i++) ws.open(`s-${i}`)
  return ws
}

const keys = (ws: ReturnType<typeof createWorkspaces>) => ws.list.value.map((w) => w.key)

describe('workspaces', () => {
  it('새로 띄운 세션의 id 를 그 workspace 에 단다', () => {
    const ws = createWorkspaces()
    ws.open()
    ws.open()
    const [first] = keys(ws)
    ws.setSessionId(first, 's-9')
    expect(ws.list.value.map((w) => w.sessionId)).toEqual(['s-9', undefined])
  })

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

  it('open 에 준 시작 디렉토리는 cwd 가 아니고, cwd 는 setCwd 로 정한다', () => {
    const ws = createWorkspaces()
    ws.open(undefined, '/a')
    expect(ws.list.value[0].startDir).toBe('/a')
    expect(ws.list.value[0].cwd).toBeUndefined()
    ws.setCwd(keys(ws)[0], '/b')
    expect(ws.list.value[0].cwd).toBe('/b')
  })

  it('selected 는 선택된 workspace 이고, 없으면 undefined 다', () => {
    const ws = opened(2)
    const [first, last] = keys(ws)
    ws.select(first)
    expect(ws.selected()?.key).toBe(first)
    ws.close(first)
    ws.close(last)
    expect(ws.selected()).toBeUndefined()
  })
})
