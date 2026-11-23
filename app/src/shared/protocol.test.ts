import { describe, expect, it } from 'vitest'
import { coreMatch } from './core-source'
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from './protocol'

const rustVersion = (name: string): number =>
  Number(
    coreMatch('crates/maru-pty/src/lib.rs', new RegExp(`^pub const ${name}: u32 = (\\d+);$`, 'm'))
  )

describe('프로토콜 버전', () => {
  it('앱과 maru-pty 의 PROTOCOL_VERSION·MIN_PROTOCOL_VERSION 이 같다', () => {
    expect(PROTOCOL_VERSION).toBe(rustVersion('PROTOCOL_VERSION'))
    expect(MIN_PROTOCOL_VERSION).toBe(rustVersion('MIN_PROTOCOL_VERSION'))
  })
})
