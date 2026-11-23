import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, restartWith, test } from './app'

type Sample = { name: string; text: string; xterm: number; maru_pty: number }

const SAMPLES = (
  JSON.parse(
    readFileSync(join(__dirname, '../../core/crates/maru-pty/tests/widths.json'), 'utf8')
  ) as Sample[]
)
  .filter((s) => s.xterm === s.maru_pty)
  .map((s) => [s.name, s.text, s.xterm] as const)

// 셸의 locale·버전과 상관없이 같은 바이트를 내도록 printf 의 8진 escape 로 쓴다.
function octal(text: string): string {
  return [...Buffer.from(text)].map((b) => `\\${b.toString(8).padStart(3, '0')}`).join('')
}

/** 커서가 있는 열. xterm 은 커서가 움직이면 textarea 를 `커서 열 × 글자 칸 폭` 에 둔다. */
async function cursorColumn(page: Page): Promise<number> {
  return page.locator('.terminal-view.active').evaluate((el) => {
    const cell = parseFloat(getComputedStyle(el).getPropertyValue('--cell'))
    return Math.round(parseFloat(el.querySelector('textarea')!.style.left) / cell)
  })
}

test('emoji·한글을 찍은 뒤 커서를 Claude Code 가 세는 열에 둔다', async ({ launch }) => {
  const { page } = await launch()
  for (const [name, text, cells] of SAMPLES) {
    // read 가 Enter 를 기다리는 동안 커서는 글자 바로 뒤에 있다.
    await page.keyboard.type(`clear; printf '${octal(text)}'; read -rs\n`)
    await expect.poll(() => cursorColumn(page), { message: name }).toBe(cells)
    await page.keyboard.press('Enter')
  }
})

test('emoji 를 찍고 재시작하면 maru-pty 가 재생한 커서가 xterm 이 센 열과 같다', async ({
  launch
}) => {
  const first = await launch()
  await first.page.keyboard.type(`clear; printf '${octal('👨‍👩‍👧👍🏽❤️')}'; read -rs\n`)
  await expect.poll(() => cursorColumn(first.page)).toBe(6)

  await restartWith(first.app)
  const again = await launch()
  await expect.poll(() => cursorColumn(again.page)).toBe(6)
})
