import type { Page } from '@playwright/test'
import { cellSize, expect, isInk, screenshotPixels, test, WEBGL_CANVAS, type Box } from './app'

// `shellEnv` 가 넣는 CLAUDE_CODE_FORCE_STRIKETHROUGH 는 xterm.js 가 SGR 9 를 그린다는 전제 위에 있다.
// xterm.js 를 올려 전제가 깨지면 claude 의 취소선이 글자 그대로도, 취소선으로도 보이지 않으므로 여기서 잰다.

const COLS = 10
const TEXT = 'X'.repeat(COLS)

/** 픽셀 줄마다 글자가 그려진 픽셀의 비율. 취소선은 글자 칸 사이의 빈 곳도 지나므로 그 줄만 1 에 닿는다. */
async function inkFractions(page: Page, clip: Box): Promise<number[]> {
  const { data, width, height } = await screenshotPixels(page, clip)
  return Array.from({ length: height }, (_, y) => {
    let inked = 0
    for (let x = 0; x < width; x++) if (isInk(data, (y * width + x) * 4)) inked++
    return inked / width
  })
}

for (const renderer of ['webgl', 'dom'] as const) {
  test(`${renderer}: SGR 9 는 글자 칸 폭 전체를 가로지르는 줄로 그려진다`, async ({ launch }) => {
    const { page } = await launch({ MARU_DOM_RENDERER: renderer === 'dom' ? '1' : '' })
    if (renderer === 'webgl') await expect(page.locator(WEBGL_CANVAS)).toHaveCount(1)
    await page.keyboard.type(`clear; printf '\\033[9m${TEXT}\\033[0m\\n${TEXT}\\n'\n`)
    const screen = (await page.locator('.terminal-view.active .xterm-screen').boundingBox())!
    const cell = await cellSize(page)
    const clip = { x: screen.x, y: screen.y, width: COLS * cell.width, height: 2 * cell.height }
    let rows: number[] = []
    await expect
      .poll(
        async () => {
          rows = await inkFractions(page, clip)
          return rows.some((f) => f > 0.95)
        },
        { timeout: 10_000 }
      )
      .toBe(true)
    const half = Math.floor(rows.length / 2)
    // 취소선은 글자 칸의 가운데 띠에만 있다. 밑줄은 아래 띠에, 반전은 글자 칸 전체에 걸린다.
    const full = rows.slice(0, half).flatMap((f, y) => (f > 0.95 ? [y / half] : []))
    expect(full.length).toBeGreaterThan(0)
    for (const y of full) {
      expect(y).toBeGreaterThanOrEqual(0.3)
      expect(y).toBeLessThan(0.7)
    }
    const plain = Math.max(...rows.slice(half))
    expect(plain).toBeGreaterThan(0.5)
    expect(plain).toBeLessThan(0.95)
  })
}
