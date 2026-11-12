import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  holderPid,
  launchServicesKnows,
  lostInstance,
  runLsappinfo,
  secondInstanceAction,
  TAKEOVER_REQUEST,
  takeOver,
  waitGone,
  type LostInstanceDeps,
  type TakeOverDeps
} from './takeover'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function userDataWithLock(target: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'maru-takeover-'))
  dirs.push(dir)
  if (target !== null) symlinkSync(target, join(dir, 'SingletonLock'))
  return dir
}

const REGISTERED = 'ASN:0x0-0x1234567-"AI_Maru":\n'

function deps(over: Partial<LostInstanceDeps> = {}): LostInstanceDeps {
  return {
    platform: 'darwin',
    userData: userDataWithLock('My-Mac.local-4242'),
    self: 1000,
    alive: () => true,
    run: () => '\n',
    ...over
  }
}

describe('holderPid', () => {
  it('호스트 이름에 - 가 있어도 마지막 - 뒤의 숫자를 pid 로 읽는다', () => {
    expect(holderPid('My-Mac-Pro.local-4242')).toBe(4242)
    expect(holderPid('host-1')).toBe(1)
  })

  it('끝이 숫자가 아니면 null 이다', () => {
    expect(holderPid('host')).toBeNull()
    expect(holderPid('host-')).toBeNull()
    expect(holderPid('host-12a')).toBeNull()
  })
})

describe('launchServicesKnows', () => {
  it('ASN 줄이 있으면 true, 빈 출력이면 false 다', () => {
    expect(launchServicesKnows(1, () => REGISTERED)).toBe(true)
    expect(launchServicesKnows(1, () => '\n')).toBe(false)
    expect(launchServicesKnows(1, () => '')).toBe(false)
  })

  it('pid 를 find pid=<pid> 로 넘긴다', () => {
    const calls: string[][] = []
    launchServicesKnows(77, (args) => {
      calls.push(args)
      return ''
    })
    expect(calls).toEqual([['find', 'pid=77']])
  })

  it('실행하지 못하면 판정하지 않는다', () => {
    expect(
      launchServicesKnows(1, () => {
        throw new Error('spawn ENOENT')
      })
    ).toBeNull()
  })
})

describe('runLsappinfo', () => {
  it('exit 이 0 이 아니면 던진다', () => {
    expect(() => runLsappinfo('/usr/bin/false')([])).toThrow()
  })

  it('없는 실행 파일이면 던진다', () => {
    expect(() => runLsappinfo('/nonexistent/lsappinfo')([])).toThrow()
  })

  it('표준 출력을 돌려준다', () => {
    expect(runLsappinfo('/bin/echo')(['find', 'pid=1'])).toBe('find pid=1\n')
  })
})

describe('lostInstance', () => {
  it('lock 을 쥔 살아 있는 pid 를 LaunchServices 가 모르면 그 pid 다', () => {
    expect(lostInstance(deps())).toBe(4242)
  })

  it('LaunchServices 가 알면 null 이다', () => {
    expect(lostInstance(deps({ run: () => REGISTERED }))).toBeNull()
  })

  it('lsappinfo 가 실패하면 판정하지 않는다', () => {
    const run = (): string => {
      throw new Error('exit 1')
    }
    expect(lostInstance(deps({ run }))).toBeNull()
  })

  it('macOS 가 아니면 lsappinfo 를 돌리지 않는다', () => {
    let ran = false
    const run = (): string => {
      ran = true
      return ''
    }
    expect(lostInstance(deps({ platform: 'linux', run }))).toBeNull()
    expect(ran).toBe(false)
  })

  it('lock 이 없거나, pid 를 읽지 못하거나, 그 pid 가 끝났거나 자신이면 lsappinfo 를 돌리지 않는다', () => {
    let ran = 0
    const run = (): string => {
      ran++
      return ''
    }
    expect(lostInstance(deps({ userData: userDataWithLock(null), run }))).toBeNull()
    expect(lostInstance(deps({ userData: userDataWithLock('host'), run }))).toBeNull()
    expect(lostInstance(deps({ alive: () => false, run }))).toBeNull()
    expect(lostInstance(deps({ self: 4242, run }))).toBeNull()
    expect(ran).toBe(0)
  })
})

describe('secondInstanceAction', () => {
  it('ready 인 첫 인스턴스는 넘겨받기 요청에 넘기고, 숨겨 띄웠어도 넘긴다', () => {
    expect(secondInstanceAction(TAKEOVER_REQUEST, true, false)).toBe('hand-over')
    expect(secondInstanceAction(TAKEOVER_REQUEST, true, true)).toBe('hand-over')
  })

  it('ready 가 아닌 첫 인스턴스는 넘겨받기 요청을 무시하고 앞으로 나오지도 않는다', () => {
    expect(secondInstanceAction(TAKEOVER_REQUEST, false, false)).toBe('ignore')
  })

  it('넘겨받기 요청이 아니면 창을 앞으로 가져오고, 숨겨 띄웠으면 무시한다', () => {
    for (const data of [undefined, null, {}, { takeover: 'true' }, { takeover: false }]) {
      expect(secondInstanceAction(data, true, false)).toBe('front')
      expect(secondInstanceAction(data, true, true)).toBe('ignore')
    }
  })
})

describe('takeOver', () => {
  function deps(gone: boolean) {
    const calls: string[] = []
    const d: TakeOverDeps = {
      gone: async (pid) => {
        calls.push(`gone ${pid}`)
        return gone
      },
      relaunch: () => calls.push('relaunch'),
      quit: () => calls.push('quit'),
      log: (m) => calls.push(m)
    }
    return { calls, d }
  }

  it('첫 인스턴스가 끝나면 다시 띄운다', async () => {
    const { calls, d } = deps(true)
    await takeOver(4242, d)
    expect(calls).toEqual([
      'maru: instance 4242 has lost its connection to the window server; restarting it',
      'gone 4242',
      'relaunch'
    ])
  })

  it('첫 인스턴스가 상한 안에 끝나지 않으면 다시 띄우지 않고 끝낸다', async () => {
    const { calls, d } = deps(false)
    await takeOver(4242, d)
    expect(calls).toEqual([
      'maru: instance 4242 has lost its connection to the window server; restarting it',
      'gone 4242',
      'maru: instance 4242 did not quit; quitting',
      'quit'
    ])
  })
})

describe('waitGone', () => {
  function clock(onWait: (t: number) => void = () => {}) {
    let t = 0
    return {
      now: () => t,
      wait: async (ms: number) => {
        t += ms
        onWait(t)
      }
    }
  }

  it('상한 안에 pid 가 끝나면 true 다', async () => {
    const c = clock()
    const dir = userDataWithLock('host-4242')
    expect(await waitGone(4242, dir, 10_000, () => c.now() < 3000, c.wait, c.now)).toBe(true)
    expect(c.now()).toBe(3000)
  })

  it('pid 가 살아 있어도 lock 이 풀리면 그때 true 다', async () => {
    const dir = userDataWithLock('host-4242')
    const c = clock((t) => {
      if (t === 300) rmSync(join(dir, 'SingletonLock'))
    })
    expect(await waitGone(4242, dir, 10_000, () => true, c.wait, c.now)).toBe(true)
    expect(c.now()).toBe(300)
  })

  it('pid 가 살아 있어도 lock 이 다른 pid 를 가리키면 true 다', async () => {
    const c = clock()
    expect(
      await waitGone(4242, userDataWithLock('host-5151'), 10_000, () => true, c.wait, c.now)
    ).toBe(true)
    expect(c.now()).toBe(0)
  })

  it('이미 끝났으면 기다리지 않는다', async () => {
    const c = clock()
    const dir = userDataWithLock('host-4242')
    expect(await waitGone(4242, dir, 10_000, () => false, c.wait, c.now)).toBe(true)
    expect(c.now()).toBe(0)
  })

  it('상한까지 pid 가 살아 있고 lock 을 쥐고 있으면 false 다', async () => {
    const c = clock()
    const dir = userDataWithLock('host-4242')
    expect(await waitGone(4242, dir, 10_000, () => true, c.wait, c.now)).toBe(false)
    expect(c.now()).toBe(10_000)
  })
})
