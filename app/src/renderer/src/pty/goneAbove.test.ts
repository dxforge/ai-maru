// @vitest-environment jsdom
import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { goneAbove } from './attach'

const NOTICE = '[the pty had ended; trying to start a new shell]'

async function draw(
  cols: number,
  rows: number,
  replay: string,
  cursorY: number,
  typed = 'echo hi'
): Promise<{ screen: string[]; scrollback: string[] }> {
  const term = new Terminal({ cols, rows, allowProposedApi: true })
  term.write(replay)
  term.write(goneAbove(cols, rows, cursorY))
  await new Promise<void>((done) => term.write(typed, done))
  const b = term.buffer.active
  const line = (y: number): string => b.getLine(y)!.translateToString(true)
  const screen = Array.from({ length: rows }, (_, y) => line(b.baseY + y))
  const scrollback = Array.from({ length: b.baseY }, (_, y) => line(y))
  term.dispose()
  return { screen, scrollback }
}

describe('goneAbove', () => {
  it('셸이 그린 프롬프트 위에 문구를 끼우고, 친 글자는 프롬프트 뒤에 붙는다', async () => {
    const { screen } = await draw(80, 6, '% ', 0)
    expect(screen.slice(0, 3)).toEqual(['', NOTICE, '% echo hi'])
  })

  it('셸이 아직 아무것도 그리지 않았으면 문구 아래에서 이어 그린다', async () => {
    const { screen } = await draw(80, 6, '', 0, '% echo hi')
    expect(screen.slice(0, 3)).toEqual(['', NOTICE, '% echo hi'])
  })

  it('문구보다 좁은 pane 에서는 접힌 줄 수만큼 끼워 프롬프트를 덮지 않는다', async () => {
    const { screen } = await draw(30, 6, '% ', 0)
    expect(screen.slice(0, 4)).toEqual(['', NOTICE.slice(0, 30), NOTICE.slice(30), '% echo hi'])
  })

  it('화면이 차 있으면 위 줄을 스크롤백으로 올리고 끼워, 셸이 그린 줄을 잃지 않는다', async () => {
    const { screen, scrollback } = await draw(80, 6, 'l1\r\nl2\r\nl3\r\nl4\r\nl5\r\n% ', 5)
    expect([...scrollback, ...screen]).toEqual([
      'l1',
      'l2',
      '',
      NOTICE,
      'l3',
      'l4',
      'l5',
      '% echo hi'
    ])
  })
})
