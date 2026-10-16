import type { Page } from '@playwright/test'
import { activeTerminal, expect, run, test } from './app'

async function brightPixelsAtRightEdge(page: Page): Promise<number> {
  const bar = page.locator('.terminal-view.active .xterm-scrollbar.xterm-vertical')
  const png = await page.screenshot({ clip: (await bar.boundingBox())! })
  return page.evaluate(
    async (bytes) => {
      const img = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, img.width, img.height)
      let n = 0
      for (let i = 0; i < data.length; i += 4)
        if (Math.min(data[i], data[i + 1], data[i + 2]) > 200) n++
      return n
    },
    [...png]
  )
}

test('alt screen 에 들어갔다 나와도 터미널 오른쪽 끝에 밝은 세로줄이 생기지 않는다', async ({
  launch
}) => {
  const { page } = await launch()
  await activeTerminal(page)
  expect(await brightPixelsAtRightEdge(page)).toBe(0)

  await run(page, "printf '\\e[?1049h'; sleep 0.3; printf '\\e[?1049l'; echo alt-$((1+1))", 'alt-2')
  await expect(page.locator('.terminal-view.active .xterm-decoration-overview-ruler')).toBeVisible()
  expect(await brightPixelsAtRightEdge(page)).toBe(0)
})
