import { describe, expect, it } from 'vitest'
import { coreMatch } from '../shared/core-source'
import { JOB_REPLY_MS } from './job'
import { WINDOW_WAIT_MS } from './window-ready'

describe('창과 pty 를 기다리는 상한', () => {
  it('maru 의 TIMEOUT 보다 짧아 main 의 오류가 maru 에 닿는다', () => {
    const timeoutMs =
      Number(
        coreMatch(
          'crates/maru/src/main.rs',
          /^const TIMEOUT: Duration = Duration::from_secs\((\d+)\);$/m
        )
      ) * 1000
    expect(WINDOW_WAIT_MS).toBeLessThan(timeoutMs)
    expect(JOB_REPLY_MS).toBeLessThan(timeoutMs)
  })
})
