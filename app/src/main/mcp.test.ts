import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { canvasPut } from './canvas'
import { InvalidParams } from './cli-server'
import { CANVAS_PUT_TOOL, mcpHandlers } from './mcp'
import { createWindowReady } from './window-ready'

function hub(
  put: (params: Record<string, unknown>) => Promise<{ id: string }> = async () => ({
    id: 'doc'
  })
) {
  const calls: Record<string, unknown>[] = []
  const handlers = mcpHandlers({
    put: (params) => {
      calls.push(params)
      return put(params)
    },
    version: '1.2.3'
  })
  const send = (message: unknown) => handlers['mcp.message']({ message }, 'p-1') as Promise<unknown>
  return { send, calls }
}

const call = (args: unknown, name = 'canvas_put') => ({
  jsonrpc: '2.0',
  id: 7,
  method: 'tools/call',
  params: { name, arguments: args }
})

const toolError = (text: string) => ({
  message: { jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text }], isError: true } }
})

describe('mcp.message', () => {
  it.each([[undefined], ['x'], [[{ jsonrpc: '2.0', id: 1, method: 'ping' }]], [null]])(
    'message %j 는 객체가 아니라 InvalidParams 다',
    async (message) => {
      await expect(hub().send(message)).rejects.toBeInstanceOf(InvalidParams)
    }
  )

  it('initialize 는 아는 버전이면 그대로 답하고 tools 를 알린다', async () => {
    const res = await hub().send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c' } }
    })
    expect(res).toEqual({
      message: {
        jsonrpc: '2.0',
        id: 0,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'ai-maru', version: '1.2.3' }
        }
      }
    })
  })

  it.each([['1999-01-01'], [undefined]])(
    'initialize 의 protocolVersion %j 은 모르는 버전이라 2025-11-25 로 답한다',
    async (protocolVersion) => {
      const res = await hub().send({
        jsonrpc: '2.0',
        id: 'a',
        method: 'initialize',
        params: { protocolVersion }
      })
      expect(res).toMatchObject({ message: { id: 'a', result: { protocolVersion: '2025-11-25' } } })
    }
  )

  it.each([['notifications/initialized'], ['notifications/cancelled'], ['tools/call']])(
    '알림 %s 에는 답하지 않는다',
    async (method) => {
      const { send, calls } = hub()
      expect(await send({ jsonrpc: '2.0', method, params: {} })).toBeNull()
      expect(calls).toEqual([])
    }
  )

  it('응답 메시지(method 없음)는 버린다', async () => {
    expect(await hub().send({ jsonrpc: '2.0', id: 1, result: {} })).toBeNull()
  })

  it('ping 은 빈 객체로 답한다', async () => {
    expect(await hub().send({ jsonrpc: '2.0', id: 3, method: 'ping' })).toEqual({
      message: { jsonrpc: '2.0', id: 3, result: {} }
    })
  })

  it('tools/list 는 canvas_put 하나를 돌려준다', async () => {
    const res = await hub().send({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} })
    expect(res).toEqual({
      message: { jsonrpc: '2.0', id: 4, result: { tools: [CANVAS_PUT_TOOL] } }
    })
    expect(CANVAS_PUT_TOOL.name).toBe('canvas_put')
  })

  it.each([['server/discover'], ['resources/list']])(
    '모르는 method %s 는 -32601 이다',
    async (method) => {
      const res = await hub().send({ jsonrpc: '2.0', id: 5, method })
      expect(res).toMatchObject({ message: { id: 5, error: { code: -32601 } } })
    }
  )
})

describe('tools/call canvas_put', () => {
  it('text·id·title 을 canvas.put 처리로 넘기고 문서 id 를 text 로 돌려준다', async () => {
    const { send, calls } = hub(async () => ({ id: 'd-1' }))
    const res = await send(call({ text: '# hi', id: 'd-1', title: 'T' }))
    expect(calls).toEqual([{ text: '# hi', id: 'd-1', title: 'T' }])
    expect(res).toEqual({
      message: { jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'd-1' }] } }
    })
  })

  it.each([
    [{ text: 'x', file: 'a.md' }, 'give exactly one of text or file'],
    [{ file: 3 }, 'give exactly one of text or file'],
    [{}, 'give text or file'],
    [undefined, 'give text or file'],
    [{ text: '' }, 'text is empty'],
    [{ text: ' \n' }, 'text is empty']
  ])('arguments %j 는 canvas.put 처리를 부르지 않고 isError 결과다', async (args, reason) => {
    const { send, calls } = hub()
    expect(await send(call(args))).toEqual(toolError(reason))
    expect(calls).toEqual([])
  })

  it.each([
    [{ text: 1 }, 'text must be a string'],
    [{ text: 'x', id: '' }, 'id must be a non-empty string'],
    [{ text: 'x', title: 2 }, 'title must be a string']
  ])(
    'canvasPut 이 arguments %j 를 거절하면 그 이유를 params. 없이 isError 결과로 돌려준다',
    async (args, reason) => {
      const sent: unknown[] = []
      const win = {
        isDestroyed: () => false,
        webContents: { send: (...a: unknown[]) => sent.push(a) }
      }
      const { send } = hub(canvasPut(() => win as unknown as BrowserWindow, createWindowReady()))
      expect(await send(call(args))).toEqual(toolError(reason))
      expect(sent).toEqual([])
    }
  )

  it('canvas.put 처리가 그 밖의 이유로 실패하면 -32603 이다', async () => {
    const { send } = hub(async () => {
      throw new Error('no window to show the document in')
    })
    expect(await send(call({ text: 'x' }))).toEqual({
      message: {
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32603, message: 'no window to show the document in' }
      }
    })
  })

  it('모르는 도구 이름은 -32602 이다', async () => {
    const { send, calls } = hub()
    const res = await send(call({ text: 'x' }, 'canvas_get'))
    expect(res).toMatchObject({ message: { id: 7, error: { code: -32602 } } })
    expect(calls).toEqual([])
  })
})
