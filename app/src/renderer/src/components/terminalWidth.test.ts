// @vitest-environment jsdom
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { coreFile } from '../../../shared/core-source'

type Sample = { name: string; text: string; xterm: number; maru_pty: number }

// `maru-pty` 가 세는 폭(`maru_pty`)은 `vt/mod.rs` 가 같은 fixture 로 잰다.
const samples: Sample[] = JSON.parse(coreFile('crates/maru-pty/tests/widths.json'))

describe('글자 폭', () => {
  it('fixture 를 읽는다', () => expect(samples.length).toBeGreaterThan(0))

  // `TerminalView.vue` 와 같이 `UnicodeGraphemesAddon` 을 붙인 xterm 이다.
  it.each(samples.map((s) => [s.name, s] as const))(
    'xterm 은 %s 를 fixture 의 폭으로 센다',
    async (_, s) => {
      const term = new Terminal({ cols: 20, rows: 4, allowProposedApi: true })
      term.loadAddon(new UnicodeGraphemesAddon())
      await new Promise<void>((resolve) => term.write(s.text, resolve))
      expect(term.buffer.active.cursorX).toBe(s.xterm)
      term.dispose()
    }
  )
})
