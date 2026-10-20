import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { pastePaths } from './paths'

const NAMES = [
  '/tmp/plain.png',
  '/tmp/My Shot (1).png',
  '/tmp/it\'s $HOME & `x`;|<>*?[]{}!#~"\\.png',
  '/tmp/스크린샷 2026-10-21 오후 3.04.05.png',
  '/tmp/tab\there.png',
  "/tmp/new\nline \u0016it's\\.png",
  '/tmp/del\x7f.png'
]

describe('pastePaths', () => {
  // macOS 의 셸에서만 돌린다. Linux 의 `/bin/sh`(dash)는 `$'…'` 를 모르고, CI 의 Linux 에는 zsh 가 없다.
  for (const shell of ['/bin/sh', '/bin/bash', '/bin/zsh']) {
    it.skipIf(process.platform !== 'darwin')(`${shell} 에서 경로마다 한 인자로 읽힌다`, () => {
      const out = execFileSync(shell, ['-c', `printf '%s\\0' ${pastePaths(NAMES)}`], {
        encoding: 'utf8'
      })
      expect(out.split('\0').slice(0, -1)).toEqual(NAMES)
    })
  }

  it('제어문자를 그대로 내보내지 않는다', () => {
    // eslint-disable-next-line no-control-regex
    expect(pastePaths(NAMES)).not.toMatch(/[\x00-\x1f\x7f]/)
  })

  it('특수문자가 없는 경로는 그대로 둔다', () => {
    expect(pastePaths(['/a/b-c_d.e/f@1+2=3,4%5:6.png'])).toBe('/a/b-c_d.e/f@1+2=3,4%5:6.png ')
  })

  it('한글은 감싸지 않고 NFC 로 바꾼다', () => {
    const nfd = '/tmp/한글.png'.normalize('NFD')
    expect(pastePaths([nfd])).toBe(`${'/tmp/한글.png'.normalize('NFC')} `)
  })

  it('경로 여럿을 공백 하나로 잇고 끝에 공백을 두며, 빈 경로는 뺀다', () => {
    expect(pastePaths(['/a b', '', '/c'])).toBe('/a\\ b /c ')
    expect(pastePaths(['', ''])).toBe('')
  })
})
