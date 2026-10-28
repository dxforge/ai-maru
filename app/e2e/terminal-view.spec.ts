import type { Page } from '@playwright/test'
import { expect, run, screenshotPixels, test } from './app'

async function brightPixelsAtRightEdge(page: Page): Promise<number> {
  const bar = page.locator('.terminal-view.active .xterm-scrollbar.xterm-vertical')
  const { data } = await screenshotPixels(page, (await bar.boundingBox())!)
  let n = 0
  for (let i = 0; i < data.length; i += 4)
    if (Math.min(data[i], data[i + 1], data[i + 2]) > 200) n++
  return n
}

test('alt screen 에 들어갔다 나와도 터미널 오른쪽 끝에 밝은 세로줄이 생기지 않는다', async ({
  launch
}) => {
  const { page } = await launch()
  expect(await brightPixelsAtRightEdge(page)).toBe(0)

  await run(page, "printf '\\e[?1049h'; sleep 0.3; printf '\\e[?1049l'; echo alt-$((1+1))", 'alt-2')
  await expect(page.locator('.terminal-view.active .xterm-decoration-overview-ruler')).toBeVisible()
  expect(await brightPixelsAtRightEdge(page)).toBe(0)
})
