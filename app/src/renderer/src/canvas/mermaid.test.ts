import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ fail: true }))
vi.mock('mermaid', () => {
  if (state.fail) throw new Error('chunk failed')
  return {
    default: {
      mermaidAPI: { defaultConfig: { flowchart: { useMaxWidth: true } } },
      initialize: vi.fn(),
      render: vi.fn(async () => ({ svg: '<svg></svg>' }))
    }
  }
})

describe('loadMermaid', () => {
  it('mermaid 를 읽지 못하면 다음에 부를 때 다시 읽는다', async () => {
    const { loadMermaid } = await import('./mermaid')
    await expect(loadMermaid()).rejects.toThrow()
    state.fail = false
    const render = await loadMermaid()
    expect(await render('graph A', false)).toBe('<svg></svg>')
  })
})
