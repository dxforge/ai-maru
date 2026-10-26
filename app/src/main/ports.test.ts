import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { createPortWatch, parseLsof, parsePs, readPorts, treePorts } from './ports'

describe('parseLsof', () => {
  it('pid 마다 포트를 모으고, IPv4·IPv6 로 같은 포트를 들으면 하나로 센다', () => {
    const out = 'p10\nf3\nn*:5173\nf4\nn[fd00::1]:5173\np20\nf7\nn127.0.0.1:8080\n'
    expect(parseLsof(out)).toEqual(
      new Map([
        [10, [5173]],
        [20, [8080]]
      ])
    )
  })
})

describe('treePorts', () => {
  it('뿌리와 그 자손의 포트만 작은 것부터 모은다', () => {
    const children = parsePs('  1   0\n 10   1\n 11  10\n 12  11\n 99   1\n')
    const listening = new Map([
      [11, [9000]],
      [12, [3000, 9000]],
      [99, [80]]
    ])
    expect(treePorts(10, children, listening)).toEqual([3000, 9000])
    expect(treePorts(99, children, listening)).toEqual([80])
    expect(treePorts(5, children, listening)).toEqual([])
  })
})

describe('readPorts', () => {
  it('자식 프로세스가 듣는 포트를 그 뿌리의 것으로 잰다', async () => {
    const server = createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const child = spawn('/bin/sleep', ['30'])
    try {
      const found = await readPorts(
        new Map([
          ['me', process.pid],
          ['child', child.pid!]
        ])
      )
      expect(found.get('me')).toContain(port)
      expect(found.get('child')).toEqual([])
    } finally {
      child.kill()
      server.close()
    }
  })
})

describe('createPortWatch', () => {
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('잴 job 이 있는 동안 주기마다 재고, 바뀌었을 때만 알리며, 없어지면 비우고 멈춘다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let active = true
      let next = new Map([['a', [5173]]])
      const measure = vi.fn(async () => next)
      const changed = vi.fn()
      const watch = createPortWatch({ active: () => active, measure, changed, intervalMs: 5000 })

      watch.update()
      await vi.advanceTimersByTimeAsync(0)
      expect(watch.ports('a')).toEqual([5173])
      expect(changed).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(5000)
      expect(measure).toHaveBeenCalledTimes(2)
      expect(changed).toHaveBeenCalledTimes(1)

      next = new Map([['a', [5173, 9229]]])
      await vi.advanceTimersByTimeAsync(5000)
      expect(watch.ports('a')).toEqual([5173, 9229])
      expect(changed).toHaveBeenCalledTimes(2)

      active = false
      watch.update()
      await vi.advanceTimersByTimeAsync(0)
      expect(watch.ports('a')).toEqual([])
      expect(changed).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(20000)
      expect(measure).toHaveBeenCalledTimes(3)
      watch.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('재는 동안 온 update 는 끝난 뒤 한 번 더 잰다', async () => {
    let release = (): void => {}
    const measure = vi
      .fn<() => Promise<Map<string, number[]>>>()
      .mockImplementationOnce(() => new Promise((r) => (release = () => r(new Map()))))
      .mockResolvedValue(new Map([['a', [1]]]))
    const watch = createPortWatch({
      active: () => true,
      measure,
      changed: () => {},
      intervalMs: 60_000
    })
    watch.update()
    watch.update()
    release()
    await flush()
    await flush()
    expect(measure).toHaveBeenCalledTimes(2)
    expect(watch.ports('a')).toEqual([1])
    watch.stop()
  })
})
