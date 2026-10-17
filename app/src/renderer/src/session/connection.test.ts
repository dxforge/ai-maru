import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSession, type SessionMessage } from './connection'

function fakeWindow() {
  const listeners = new Set<(e: MessageEvent) => void>()
  const opened: string[] = []
  const killed: string[] = []
  const win = {
    addEventListener: (_type: string, cb: (e: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: (e: MessageEvent) => void) => listeners.delete(cb),
    maru: {
      openSession: (key: string) => opened.push(key),
      killSession: (key: string) => killed.push(key)
    }
  }
  const post = (data: unknown, ports: MessagePort[] = []): void => {
    for (const cb of [...listeners]) cb({ source: win, data, ports } as unknown as MessageEvent)
  }
  vi.stubGlobal('window', win)
  return {
    opened,
    killed,
    givePort(key = opened[0]): MessagePort {
      const { port1, port2 } = new MessageChannel()
      post({ type: 'session:port', key }, [port2])
      return port1
    },
    lose: () => post('session:lost')
  }
}

function received(port: MessagePort, count: number): Promise<SessionMessage[]> {
  const got: SessionMessage[] = []
  return new Promise((resolve) => {
    port.onmessage = ({ data }) => {
      got.push(data)
      if (got.length === count) resolve(got)
    }
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('openSession', () => {
  it('포트가 오기 전에 보낸 메시지를 포트가 온 뒤 보낸 순서대로 보낸다', async () => {
    const win = fakeWindow()
    const conn = openSession('s-00000001')
    const key = new Uint8Array([107])
    conn.send('{"type":"attach"}')
    conn.send(key)
    const port = win.givePort()
    conn.send('{"type":"resize"}')
    expect(await received(port, 3)).toEqual(['{"type":"attach"}', key, '{"type":"resize"}'])
    port.close()
  })

  it('다른 세션의 포트는 받지 않는다', async () => {
    const win = fakeWindow()
    const conn = openSession('s-00000001')
    conn.send('mine')
    const other = win.givePort('other')
    const port = win.givePort()
    const otherGot: SessionMessage[] = []
    other.onmessage = ({ data }) => otherGot.push(data)
    expect(await received(port, 1)).toEqual(['mine'])
    expect(otherGot).toEqual([])
    other.close()
    port.close()
  })

  it('포트가 오기 전의 session:lost 로는 닫히지 않고, 온 뒤의 것으로 닫힌다', () => {
    const win = fakeWindow()
    const conn = openSession('s-00000001')
    let closes = 0
    conn.onClose(() => closes++)
    win.lose()
    win.givePort()
    expect(closes).toBe(0)
    win.lose()
    expect(closes).toBe(1)
  })

  it('포트가 오기 전에도 그 세션을 끝낼 수 있다', () => {
    const win = fakeWindow()
    openSession('s-00000001').kill()
    expect(win.killed).toEqual(win.opened)
    expect(win.killed).toHaveLength(1)
  })
})
