import type { CDPSession, Page } from '@playwright/test'
import { activeTerminal, expect, test, type Launched } from './app'

// 앱의 테마 배경(GHOSTTY). 이 색과 다른 픽셀을 글자가 그려진 픽셀로 본다.
const GROUND = [0x28, 0x2c, 0x34]
// 한 = U+D55C. 셸의 locale 과 상관없이 같은 바이트를 내도록 printf 의 8진 escape 로 쓴다.
const PRINT_HAN = "printf '\\355\\225\\234\\n'"

type Box = { x: number; y: number; width: number; height: number }

async function cellSize(page: Page): Promise<{ width: number; height: number }> {
  return page.locator('.app').evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      width: parseFloat(s.getPropertyValue('--cell')),
      height: parseFloat(s.getPropertyValue('--row'))
    }
  })
}

/**
 * 커서 셀의 왼쪽 위와 `.xterm-screen` 의 왼쪽 끝. xterm 은 textarea 를 커서 셀에 둔다. `alignComposition` 은
 * 조합창만 옮기고 textarea 는 옮기지 않는다.
 */
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

/**
 * 세 번 연달아 같게 잰 `inkTop`. WebGL renderer 는 커서(textarea)가 옮겨 간 다음 프레임에 캔버스를 그린다.
 * 그 사이에 찍으면 지우기 전의 글자나 빈 화면이 잡힌다.
 */
async function settledInkTop(page: Page, clip: Box): Promise<number> {
  const seen: number[] = []
  await expect
    .poll(async () => {
      seen.push(await inkTop(page, clip))
      return seen.length >= 3 && seen.slice(-3).every((y) => y === seen.at(-1))
    })
    .toBe(true)
  return seen.at(-1)!
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
  let last = ''
  await expect
    .poll(async () => {
      const at = await cursor(page)
      const now = `${at.x},${at.y}`
      const settled = now === last && Math.abs(at.y - (top + height)) < 0.1 && at.x > at.left
      last = now
      return settled
    })
    .toBe(true)
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
      const committedClip = {
        x: at.left,
        y: at.y - cell.height,
        width: 2 * cell.width,
        height: cell.height
      }
      const committed = await settledInkTop(page, committedClip)
      expect(committed).toBeGreaterThan(0)

      const cdp = await page.context().newCDPSession(page)
      await compose(cdp, '한')
      await expect(page.locator('.terminal-view.active .composition-view')).toBeVisible()
      const clip = { x: at.x, y: at.y, width: 2 * cell.width, height: cell.height }
      expect(await settledInkTop(page, clip)).toBe(committed)
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

test('마지막 열에서 조합해도 조합창이 터미널 밖으로 넘치지 않는다', async ({ launch }) => {
  const { page } = await launch({ MARU_DOM_RENDERER: '' })
  await activeTerminal(page)
  const cell = await cellSize(page)
  // CUF 999 는 커서를 마지막 열에 둔다.
  await page.keyboard.type(`clear; printf '\\033[999C'; read -rs\n`)
  const right = await page
    .locator('.terminal-view.active .xterm-screen')
    .evaluate((el) => el.getBoundingClientRect().right)
  await expect.poll(async () => (await cursor(page)).x).toBeGreaterThan(right - 2 * cell.width)
  const cdp = await page.context().newCDPSession(page)
  await compose(cdp, '한')
  const view = page.locator('.terminal-view.active .composition-view')
  await expect(view).toBeVisible()
  expect(await view.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(
    right + 0.5
  )
})

test('한글과 영문을 설치된 D2Coding 으로 그린다', async ({ launch }) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { page } = launched
  await activeTerminal(page)
  // 설치되지 않은 글꼴을 앞에 두면 뒤의 글꼴로 그려 폭이 같다.
  const installed = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')!
    const width = (font: string): number => {
      ctx.font = font
      return ctx.measureText('abc 한').width
    }
    return width('14px D2Coding, serif') !== width('14px serif')
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
  expect(await fonts('.terminal-view.active .composition-view')).toEqual(['D2Coding'])
  expect(await fonts('.row-bar-text')).toEqual(['D2Coding'])
})
