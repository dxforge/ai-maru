import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CDPSession, Page } from '@playwright/test'
import {
  cellSize,
  expect,
  isInk,
  screenshotPixels,
  settled,
  test,
  writeConfig,
  type Box,
  type Launched
} from './app'

// 한 = U+D55C. 셸의 locale 과 상관없이 같은 바이트를 내도록 printf 의 8진 escape 로 쓴다.
const PRINT_HAN = "printf '\\355\\225\\234\\n'"

/**
 * 커서 글자 칸의 왼쪽 위와 `.xterm-screen` 의 왼쪽 끝. xterm 은 textarea 를 커서 글자 칸에 둔다. `alignComposition` 은
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
  const { data, width, height } = await screenshotPixels(page, clip)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (isInk(data, (y * width + x) * 4)) return y
  return -1
}

async function glyphInk(
  page: Page,
  clip: Box,
  cellWidth: number,
  cells: number[]
): Promise<{ starts: number[]; end: number }> {
  const { data, width, height } = await screenshotPixels(page, clip)
  const ink = Array.from({ length: width }, (_, x) => {
    for (let y = 0; y < height; y++) if (isInk(data, (y * width + x) * 4)) return true
    return false
  })
  const scale = width / clip.width
  let at = 0
  const starts = cells.map((n) => {
    const from = Math.round(at * cellWidth * scale)
    at += n
    const to = Math.round(at * cellWidth * scale)
    const x = ink.slice(from, to).indexOf(true)
    return x < 0 ? -1 : from + x
  })
  return { starts, end: ink.lastIndexOf(true) }
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

async function launchWithHan(
  launch: (
    env?: Record<string, string>,
    executablePath?: string,
    args?: string[]
  ) => Promise<Launched>,
  renderer: 'webgl' | 'dom',
  dpr: number
) {
  const launched = await launch({ MARU_DOM_RENDERER: renderer === 'dom' ? '1' : '' }, undefined, [
    `--force-device-scale-factor=${dpr}`
  ])
  const { page } = launched
  expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr)
  await printHan(launched)
  const cell = await cellSize(page)
  const at = await cursor(page)
  return {
    page,
    at,
    clip: { x: at.x, y: at.y, width: 2 * cell.width, height: cell.height },
    committedClip: { x: at.left, y: at.y - cell.height, width: 2 * cell.width, height: cell.height }
  }
}

for (const renderer of ['webgl', 'dom'] as const)
  for (const dpr of [1, 2])
    test(`${renderer}, DPR ${dpr}: 조합 중인 한글을 확정된 한글과 같은 높이에 그린다`, async ({
      launch
    }) => {
      const { page, clip, committedClip } = await launchWithHan(launch, renderer, dpr)
      const committed = await settled(() => inkTop(page, committedClip))
      expect(committed).toBeGreaterThan(0)

      const cdp = await page.context().newCDPSession(page)
      await compose(cdp, '한')
      await expect(page.locator('.terminal-view.active .composition-view')).toBeVisible()
      expect(await settled(() => inkTop(page, clip))).toBe(committed)
    })

// 일본어·중국어 입력은 여러 글자를 한 번에 조합하고, 로마자 입력 중에는 영문이 섞인다. 확정되면 두 글자 칸을 차지하는 한글·가나와
// 한 글자 칸을 차지하는 영문을 섞는다.
const MIXED = ['한', '글', 'に', 'ほ', 'w', 'o', 'か', 'く']

// 글꼴 크기 13·15, DPR 1 에서는 WebGL renderer 가 글자 칸 폭을 device px 로 내림하므로 한글·가나가 두 글자 칸보다 넓다.
for (const size of [undefined, 13, 15, 16])
  for (const renderer of ['webgl', 'dom'] as const)
    for (const dpr of [1, 2])
      test(`글꼴 크기 ${size ?? '기본값'}, ${renderer}, DPR ${dpr}: 여러 글자를 조합하면 글자마다 확정되면 그려질 가로 위치에 그리고 끝을 자르지 않는다`, async ({
        launch,
        dataDir
      }) => {
        if (size !== undefined) writeConfig(dataDir, `[terminal]\nfont-size = ${size}\n`)
        const { page, at } = await launchWithHan(launch, renderer, dpr)
        const cell = await cellSize(page)
        const cells = MIXED.map((c) => (c.length === 1 && c.charCodeAt(0) < 0x80 ? 1 : 2))
        const total = cells.reduce((a, b) => a + b, 0)
        // 마지막 글자가 글자 칸 밖으로 넘친 것까지 보도록 한 글자 칸을 더 잰다.
        const clip = { x: at.x, y: at.y, width: (total + 1) * cell.width, height: cell.height }
        const ink = (): Promise<{ starts: number[]; end: number }> =>
          glyphInk(page, clip, cell.width, cells)

        const cdp = await page.context().newCDPSession(page)
        await compose(cdp, MIXED.join(''))
        const view = page.locator('.terminal-view.active .composition-view')
        await expect(view).toBeVisible()
        // 밑줄은 조합창의 왼쪽 끝부터 그어지므로, 밑줄을 두면 글자 대신 밑줄의 왼쪽 끝을 잰다. 그래서 밑줄을 지운다.
        await view.evaluate((el) => (el.style.textDecoration = 'none'))
        const composing = await settled(ink)

        // 커서가 마지막 글자 뒤에 남으면 잰 영역 끝에 그려진 커서가 글자 픽셀로 잡히므로, 확정한 뒤 Enter 로 커서를 다음 줄로
        // 보낸다.
        await cdp.send('Input.insertText', { text: MIXED.join('') })
        await expect(view).toBeHidden()
        await expect
          .poll(async () => (await cursor(page)).x)
          .toBeGreaterThan(at.x + total * cell.width - 1)
        await page.keyboard.press('Enter')
        await expect.poll(async () => (await cursor(page)).y).toBeGreaterThan(at.y)
        expect(composing.starts.every((x) => x >= 0)).toBe(true)
        expect(await settled(ink)).toEqual(composing)
      })

test('조합창은 설정한 글꼴 크기로 쓴다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 16\n')
  const { page } = await launch({ MARU_DOM_RENDERER: '' })
  const cdp = await page.context().newCDPSession(page)
  await compose(cdp, '한')
  const view = page.locator('.terminal-view.active .composition-view')
  await expect(view).toBeVisible()
  await expect(view).toHaveCSS('font-size', '16px')
})

test('마지막 열에서 조합해도 조합창이 터미널 밖으로 넘치지 않고, 남은 폭보다 긴 조합은 끝을 보인다', async ({
  launch
}) => {
  const { page } = await launch({ MARU_DOM_RENDERER: '' })
  const cell = await cellSize(page)
  const cdp = await page.context().newCDPSession(page)
  const view = page.locator('.terminal-view.active .composition-view')
  const direction = (): Promise<string> => view.evaluate((el) => getComputedStyle(el).direction)
  // 남은 폭에 들어가는 조합은 확정되면 그려질 자리에 맞춰 ltr 로 그린다. 이 조합을 먼저 해 두어, 같은 조합창이 마지막
  // 열에서 rtl 로 돌아오는지 본다.
  await compose(cdp, '한')
  await expect(view).toBeVisible()
  expect(await direction()).toBe('ltr')
  await cdp.send('Input.insertText', { text: '한' })
  await expect(view).toBeHidden()
  await page.keyboard.press('Control+U')

  // CUF 999 는 커서를 마지막 열에 둔다.
  await page.keyboard.type(`clear; printf '\\033[999C'; read -rs\n`)
  const right = await page
    .locator('.terminal-view.active .xterm-screen')
    .evaluate((el) => el.getBoundingClientRect().right)
  await expect.poll(async () => (await cursor(page)).x).toBeGreaterThan(right - 2 * cell.width)
  await compose(cdp, '한')
  await expect(view).toBeVisible()
  expect(await view.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(
    right + 0.5
  )
  expect(await direction()).toBe('rtl')
})

test('조합 중에 커서가 마지막 열로 옮겨지면 조합창을 남은 폭에 다시 맞춘다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch({ MARU_DOM_RENDERER: '' })
  const cell = await cellSize(page)
  const cdp = await page.context().newCDPSession(page)
  const view = page.locator('.terminal-view.active .composition-view')
  const direction = (): Promise<string> => view.evaluate((el) => getComputedStyle(el).direction)
  const screen = page.locator('.terminal-view.active .xterm-screen')
  const { left, right } = await screen.evaluate((el) => el.getBoundingClientRect())
  const go = join(dataDir, 'go')
  // 조합하는 동안 테스트가 `go` 를 만들면 CUF 999 가 커서를 마지막 열로 옮긴다.
  await page.keyboard.type(
    `clear; while [ ! -e '${go}' ]; do sleep 0.1; done; printf '\\033[999C'; read -rs\n`
  )
  await expect.poll(async () => (await cursor(page)).x - left).toBeLessThan(1)
  await compose(cdp, '한')
  await expect(view).toBeVisible()
  expect(await direction()).toBe('ltr')

  writeFileSync(go, '')
  await expect.poll(async () => (await cursor(page)).x).toBeGreaterThan(right - 2 * cell.width)
  await expect.poll(direction).toBe('rtl')
  expect(await view.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(
    right + 0.5
  )
})
