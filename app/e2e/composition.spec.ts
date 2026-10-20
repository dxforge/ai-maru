import type { CDPSession, Page } from '@playwright/test'
import { activeTerminal, expect, test, type Launched } from './app'

// 앱의 테마 배경(GHOSTTY). 이 색과 다른 픽셀을 글자의 잉크로 본다.
const GROUND = [0x28, 0x2c, 0x34]
// 한 = U+D55C. 셸의 locale 과 상관없이 같은 바이트를 내도록 printf 의 8진 escape 로 쓴다.
const PRINT_HAN = "printf '\\355\\225\\234\\n'"

type Box = { x: number; y: number; width: number; height: number }

/** 셀 크기(CSS px). CSS 변수 `--cell`·`--row`(`App.vue`)가 터미널이 마지막으로 잰 셀이다. */
async function cellSize(page: Page): Promise<{ width: number; height: number }> {
  return page.locator('.app').evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      width: parseFloat(s.getPropertyValue('--cell')),
      height: parseFloat(s.getPropertyValue('--row'))
    }
  })
}

/** 커서 셀의 왼쪽 위와 `.xterm-screen` 의 왼쪽 끝. xterm 은 textarea 를 커서 셀에 두고, `alignComposition` 은 조합창만 옮기고 textarea 는 옮기지 않는다. */
async function cursor(page: Page): Promise<{ x: number; y: number; left: number }> {
  return page.locator('.terminal-view.active').evaluate((el) => {
    const r = el.querySelector('textarea')!.getBoundingClientRect()
    return {
      x: r.left,
      y: r.top,
      left: el.querySelector('.xterm-screen')!.getBoundingClientRect().left
    }
  })
}

/** clip 안에서 배경과 다른 첫 픽셀 줄(device px). 글자의 위 끝이다. */
async function inkTop(page: Page, clip: Box): Promise<number> {
  const png = (await page.screenshot({ clip })).toString('base64')
  return page.evaluate(
    async ({ png, ground }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
      const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          const d =
            Math.abs(data[i] - ground[0]) +
            Math.abs(data[i + 1] - ground[1]) +
            Math.abs(data[i + 2] - ground[2])
          if (d > 96) return y
        }
      return -1
    },
    { png, ground: GROUND }
  )
}

async function compose(cdp: CDPSession, text: string): Promise<void> {
  await cdp.send('Input.imeSetComposition', {
    text,
    selectionStart: text.length,
    selectionEnd: text.length
  })
}

async function printHan({ page }: Launched): Promise<void> {
  const { height } = await cellSize(page)
  const top = await page
    .locator('.terminal-view.active .xterm-screen')
    .evaluate((el) => el.getBoundingClientRect().top)
  await page.keyboard.type(`clear; ${PRINT_HAN}\n`)
  await expect.poll(async () => (await cursor(page)).y).toBeCloseTo(top + height, 1)
}

for (const renderer of ['webgl', 'dom'] as const)
  for (const dpr of [1, 2])
    test(`${renderer}, DPR ${dpr}: 조합 중인 한글을 확정된 한글과 같은 높이에 그린다`, async ({
      launch
    }) => {
      const launched = await launch(
        { MARU_DOM_RENDERER: renderer === 'dom' ? '1' : '' },
        undefined,
        [`--force-device-scale-factor=${dpr}`]
      )
      const { page } = launched
      await activeTerminal(page)
      expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr)
      await printHan(launched)
      const cell = await cellSize(page)
      const at = await cursor(page)
      const committed = await inkTop(page, {
        x: at.left,
        y: at.y - cell.height,
        width: 2 * cell.width,
        height: cell.height
      })
      expect(committed).toBeGreaterThan(0)

      const cdp = await page.context().newCDPSession(page)
      await compose(cdp, '한')
      await expect(page.locator('.terminal-view.active .composition-view')).toBeVisible()
      const clip = { x: at.x, y: at.y, width: 2 * cell.width, height: cell.height }
      // 조합창이 보인 뒤 글자가 그려지기 전에 찍히면 잉크가 없다.
      await expect.poll(() => inkTop(page, clip)).toBe(committed)
    })

test('조합창은 터미널 배경에 밑줄로 두 칸을 덮어 그 아래의 커서를 가린다', async ({ launch }) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { page } = launched
  await activeTerminal(page)
  const cell = await cellSize(page)
  const at = await cursor(page)
  const cdp = await page.context().newCDPSession(page)
  await compose(cdp, '한')
  const view = page.locator('.terminal-view.active .composition-view')
  await expect(view).toBeVisible()
  const style = await view.evaluate((el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      background: s.backgroundColor,
      decoration: s.textDecorationLine,
      top: r.top,
      bottom: r.bottom,
      width: r.width
    }
  })
  expect(style.background).toBe(`rgb(${GROUND.join(', ')})`)
  expect(style.decoration).toBe('underline')
  expect(style.width).toBeCloseTo(2 * cell.width, 1)
  expect(style.top).toBeLessThanOrEqual(at.y + 0.01)
  expect(style.bottom).toBeGreaterThanOrEqual(at.y + cell.height - 0.01)
})

test('한글은 설치된 D2Coding 으로, 영문은 Menlo 로 그린다', async ({ launch }) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { page } = launched
  await activeTerminal(page)
  const installed = await page.evaluate(() => {
    let loaded = false
    // Chromium 은 공백이 든 family 를 따옴표로 감싸 돌려준다.
    document.fonts.forEach((f) => {
      if (f.family.replace(/"/g, '') === 'Maru Hangul' && f.status === 'loaded') loaded = true
    })
    return loaded
  })
  test.skip(!installed, 'D2Coding 이 설치돼 있지 않다')

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const fonts = async (selector: string): Promise<string[]> => {
    const { root } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    return fonts.map((f) => f.familyName)
  }
  await compose(cdp, '한')
  await expect(page.locator('.terminal-view.active .composition-view')).toBeVisible()
  expect(await fonts('.terminal-view.active .composition-view')).toContain('D2Coding')
  expect(await fonts('.row-bar-text')).toEqual(['Menlo'])
})
