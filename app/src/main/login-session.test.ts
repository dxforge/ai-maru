import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { etimeSeconds, fromEarlierLogin, loginStartedMs, readLoginStartedMs } from './login-session'

const LOGINWINDOW = '/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow'
const NOW = 1_800_000_000_000

describe('etimeSeconds', () => {
  it('mm:ss·hh:mm:ss·dd-hh:mm:ss 를 초로 바꾼다', () => {
    expect(etimeSeconds('00:07')).toBe(7)
    expect(etimeSeconds('12:34')).toBe(12 * 60 + 34)
    expect(etimeSeconds('05:00:00')).toBe(5 * 60 * 60)
    expect(etimeSeconds('03-02:10:00')).toBe(((3 * 24 + 2) * 60 + 10) * 60)
  })

  it('형식이 다르면 null 이다', () => {
    for (const s of ['', '7', '1-02:03', '-01:02', 'ab:cd', '01:02:03:04', ' 01:02'])
      expect(etimeSeconds(s)).toBeNull()
  })

  it('ps 가 쓰는 모양으로 적은 경과 시간을 그대로 되읽는다', () => {
    const two = (n: number) => String(n).padStart(2, '0')
    fc.assert(
      fc.property(fc.nat(10_000_000), (sec) => {
        const d = Math.floor(sec / 86400)
        const h = Math.floor(sec / 3600) % 24
        const m = Math.floor(sec / 60) % 60
        const s = sec % 60
        const text =
          d > 0
            ? `${two(d)}-${two(h)}:${two(m)}:${two(s)}`
            : h > 0
              ? `${two(h)}:${two(m)}:${two(s)}`
              : `${two(m)}:${two(s)}`
        expect(etimeSeconds(text)).toBe(sec)
      })
    )
  })
})

describe('loginStartedMs', () => {
  it('uid 가 같은 loginwindow 의 경과 시간을 지금에서 뺀 시각이다', () => {
    const ps = [
      `    0 03-02:10:00 /sbin/launchd`,
      `  502    05:00:00 ${LOGINWINDOW}`,
      `  502 01-06:20:00 /System/Library/Frameworks/CryptoTokenKit.framework/ctkd`
    ].join('\n')
    expect(loginStartedMs(ps, 502, NOW)).toBe(NOW - 5 * 60 * 60 * 1000)
  })

  it('다른 uid 의 loginwindow 는 보지 않는다', () => {
    const ps = `    0    00:10 ${LOGINWINDOW}\n  503    00:20 ${LOGINWINDOW}`
    expect(loginStartedMs(ps, 502, NOW)).toBeNull()
  })

  it('이름이 loginwindow 로 끝나기만 하는 다른 프로그램은 보지 않는다', () => {
    const ps = `  502    00:10 /Users/me/bin/not-loginwindow\n  502    00:20 /Users/me/loginwindow.app`
    expect(loginStartedMs(ps, 502, NOW)).toBeNull()
  })

  it('같은 uid 의 loginwindow 가 여럿이면 가장 늦게 뜬 것이다', () => {
    const ps = `  502 01:00:00 ${LOGINWINDOW}\n  502    00:30 ${LOGINWINDOW}`
    expect(loginStartedMs(ps, 502, NOW)).toBe(NOW - 30_000)
  })

  it('경과 시간을 읽지 못한 줄은 건너뛴다', () => {
    const ps = `  502 ?? ${LOGINWINDOW}\n  502    00:30 ${LOGINWINDOW}`
    expect(loginStartedMs(ps, 502, NOW)).toBe(NOW - 30_000)
  })

  it('빈 출력이면 null 이다', () => {
    expect(loginStartedMs('', 502, NOW)).toBeNull()
  })
})

describe('readLoginStartedMs', () => {
  let dir: string | undefined
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  function fakePs(body: string): string {
    dir = mkdtempSync(join(tmpdir(), 'maru-ps-'))
    const bin = join(dir, 'ps')
    writeFileSync(bin, `#!/bin/sh\n${body}\n`)
    chmodSync(bin, 0o755)
    return bin
  }

  it('ps 의 출력에서 loginwindow 가 뜬 시각을 읽는다', async () => {
    const bin = fakePs(
      `[ "$*" = "-A -o uid=,etime=,comm=" ] && echo "  502    00:30 ${LOGINWINDOW}"`
    )
    const before = Date.now()
    const t = await readLoginStartedMs(bin, 502)
    expect(t).toBeGreaterThanOrEqual(before - 30_000)
    expect(t).toBeLessThanOrEqual(Date.now() - 30_000)
  })

  it('ps 가 실패하면 null 이다', async () => {
    expect(
      await readLoginStartedMs(fakePs(`echo "  502 00:30 ${LOGINWINDOW}"; exit 1`), 502)
    ).toBeNull()
  })

  it('ps 가 없으면 null 이다', async () => {
    expect(await readLoginStartedMs('/nonexistent/ps', 502)).toBeNull()
  })
})

describe('fromEarlierLogin', () => {
  const rec = (id: string, created_at_ms: number) => ({ id, created_at_ms })

  it('남길 pty 가운데 로그인보다 먼저 뜬 것이 있으면 true 다', () => {
    expect(fromEarlierLogin([rec('p-1', 50), rec('p-2', 200)], ['p-1', 'p-2'], 100)).toBe(true)
  })

  it('남길 pty 가 모두 로그인 뒤에 떴으면 false 다', () => {
    expect(fromEarlierLogin([rec('p-1', 100), rec('p-2', 200)], ['p-1', 'p-2'], 100)).toBe(false)
  })

  it('먼저 뜬 pty 가 남길 것이 아니면 보지 않는다', () => {
    expect(fromEarlierLogin([rec('p-1', 50), rec('p-2', 200)], ['p-2'], 100)).toBe(false)
  })

  it('로그인 시각을 모르면 판정하지 않는다', () => {
    expect(fromEarlierLogin([rec('p-1', 50)], ['p-1'], null)).toBe(false)
  })
})
