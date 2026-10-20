import type { Page } from '@playwright/test'
import { activeTerminal, expect, restartWith, test } from './app'

// Unicode 14 이후에 추가된 emoji(🫠 등)는 `@xterm/addon-unicode-graphemes` 의 폭 표에 없어 1칸으로 세므로
// 넣지 않는다.
const SAMPLES: [name: string, text: string, cells: number][] = [
  ['check', '✅', 2],
  ['skin tone', '👍🏽', 2],
  ['ZWJ family', '👨‍👩‍👧', 2],
  ['VS16 heart', '❤️', 2],
  ['hangul', '한', 2],
  ['record', '⏺', 1],
  ['circled', '①', 1]
]

// 셸의 locale·버전과 상관없이 같은 바이트를 내도록 printf 의 8진 escape 로 쓴다.
function octal(text: string): string {
  return [...Buffer.from(text)].map((b) => `\\${b.toString(8).padStart(3, '0')}`).join('')
}

/** 커서가 있는 열. xterm 은 커서가 움직이면 textarea 를 `커서 열 × 셀 폭` 에 둔다. */
async function cursorColumn(page: Page): Promise<number> {
  return page.locator('.terminal-view.active').evaluate((el) => {
    const cell = parseFloat(
      getComputedStyle(document.querySelector('.app')!).getPropertyValue('--cell')
    )
    return Math.round(parseFloat(el.querySelector('textarea')!.style.left) / cell)
  })
}

test('emoji·한글을 찍은 뒤 커서를 Claude Code 가 세는 칸에 둔다', async ({ launch }) => {
  const { page } = await launch()
  await activeTerminal(page)
  for (const [name, text, cells] of SAMPLES) {
    // read 가 Enter 를 기다리는 동안 커서는 글자 바로 뒤에 있다.
    await page.keyboard.type(`clear; printf '${octal(text)}'; read -rs\n`)
    await expect.poll(() => cursorColumn(page), { message: name }).toBe(cells)
    await page.keyboard.press('Enter')
  }
})

test('emoji 를 찍고 재시작하면 maru-session 이 재생한 커서가 xterm 이 센 칸과 같다', async ({
  launch
}) => {
  const first = await launch()
  await activeTerminal(first.page)
  await first.page.keyboard.type(`clear; printf '${octal('👨‍👩‍👧👍🏽❤️')}'; read -rs\n`)
  await expect.poll(() => cursorColumn(first.page)).toBe(6)

  await restartWith(first.app)
  const again = await launch()
  await activeTerminal(again.page)
  await expect.poll(() => cursorColumn(again.page)).toBe(6)
})
