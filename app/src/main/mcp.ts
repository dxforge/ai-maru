import { InvalidParams, isObject, type Handlers } from './cli-server'

// 계약은 core/crates/maru 의 모듈 doc 에 있다. `maru mcp` 가 MCP 메시지를 하나씩 `mcp.message` 로 보낸다.

/** 앱이 아는 MCP 버전. 클라이언트가 이 밖의 버전을 보내면 첫 버전으로 답한다. */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export const CANVAS_PUT_TOOL = {
  name: 'canvas_put',
  description:
    'Show a markdown document in the AI Maru Canvas panel next to this terminal. Pass markdown in `text`, or the path of a markdown file in `file`. Reuse the same `id` to replace a document you put before; the reply is the document id.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Markdown body. Give exactly one of text or file.' },
      file: {
        type: 'string',
        description:
          'Path of a markdown file to show. A relative path is read from the directory this session started in, not from a directory changed to later, so prefer an absolute path.'
      },
      id: {
        type: 'string',
        description: 'Document id. Putting again with the same id replaces that document.'
      },
      title: {
        type: 'string',
        description: 'Title shown in the Canvas list. Defaults to the first heading.'
      }
    }
  }
}

type Message = Record<string, unknown>
type Deps = {
  put: (params: Record<string, unknown>) => Promise<{ id: string }>
  version: string
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

function toolError(text: string): object {
  return { content: [{ type: 'text', text }], isError: true }
}

async function callTool(params: Message, put: Deps['put']): Promise<object> {
  if (params.name !== 'canvas_put') {
    throw new RpcError(-32602, `unknown tool: ${String(params.name)}`)
  }
  const args = isObject(params.arguments) ? params.arguments : {}
  const { text, file, id, title } = args
  // `file` 은 `maru mcp` 가 읽어 `text` 로 바꾸므로, 여기까지 온 `file` 은 `text` 와 같이 왔거나 문자열이 아니다.
  if (file !== undefined) return toolError('give exactly one of text or file')
  if (text === undefined) return toolError('give text or file')
  if (typeof text === 'string' && !/\S/.test(text)) return toolError('text is empty')
  try {
    const doc = await put({ text, id, title })
    return { content: [{ type: 'text', text: doc.id }] }
  } catch (err) {
    if (err instanceof InvalidParams) return toolError(err.message.replace(/^params\./, ''))
    throw err
  }
}

async function result(method: string, params: Message, deps: Deps): Promise<unknown> {
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion
      return {
        protocolVersion:
          typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked)
            ? asked
            : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-maru', version: deps.version }
      }
    }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: [CANVAS_PUT_TOOL] }
    case 'tools/call':
      return callTool(params, deps.put)
    default:
      throw new RpcError(-32601, `Method not found: ${method}`)
  }
}

/** 앱은 MCP 세션도 `initialize` 여부도 기억하지 않는다(`docs/architecture.md` 「MCP 도구는 `maru mcp` 가 앱에 중계한다」). 그래서 앱이 다시 떠도 claude 는 `initialize` 를 다시 보내지 않아도 된다. */
async function handle(msg: Message, deps: Deps): Promise<Message | null> {
  // 앱이 클라이언트에 거는 요청이 없으므로 응답이 올 일도 없다.
  if (typeof msg.method !== 'string') return null
  const notification = !('id' in msg)
  const id = msg.id
  const params = isObject(msg.params) ? msg.params : {}
  try {
    const value = await result(msg.method, params, deps)
    return notification ? null : { jsonrpc: '2.0', id, result: value }
  } catch (err) {
    if (notification) return null
    const code = err instanceof RpcError ? err.code : -32603
    const message = err instanceof Error ? err.message : String(err)
    return { jsonrpc: '2.0', id, error: { code, message } }
  }
}

export function mcpHandlers(deps: Deps): Handlers {
  return {
    'mcp.message': async (params) => {
      if (!isObject(params.message)) throw new InvalidParams('params.message must be an object')
      const message = await handle(params.message, deps)
      return message && { message }
    }
  }
}
