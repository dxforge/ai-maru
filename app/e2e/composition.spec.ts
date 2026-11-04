import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CDPSession, Page } from '@playwright/test'
import {
  cellSize,
  expect,
  isInk,
  resizeBy,
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

/**
 * `clip` 안의 글자마다 잉크가 시작하는 픽셀 열과 마지막 잉크 픽셀 열을, 넓힌 영역의 왼쪽 끝부터 센 device px 로 잰다.
 * xterm 은 캔버스의 CSS 폭을 정수 px 로 반올림한 뒤 터미널 열 수로 나눠 글자 칸 폭을 셈한다. 그래서 DPR 2 에서 터미널 열
 * 수와 device px 글자 칸 폭이 둘 다 홀수면 글자 칸 폭과 커서의 x 가 device px 경계에 맞지 않는다. 그 x 에서 잘라 찍으면
 * screenshot 배율이 dpr 에서 벗어나 글자 경계가 1 device px 어긋난다. 그래서 잘라 찍는 영역을 device px 경계까지 넓힌다.
 */
async function glyphInk(
  page: Page,
  clip: Box,
  dpr: number,
  cellWidth: number,
  cells: number[]
): Promise<{ starts: number[]; end: number }> {
  const left = Math.floor(clip.x * dpr) / dpr
  const top = Math.floor(clip.y * dpr) / dpr
  const { data, width, height } = await screenshotPixels(page, {
    x: left,
    y: top,
    width: Math.ceil((clip.x + clip.width) * dpr) / dpr - left,
    height: Math.ceil((clip.y + clip.height) * dpr) / dpr - top
  })
  const ink = Array.from({ length: width }, (_, x) => {
    for (let y = 0; y < height; y++) if (isInk(data, (y * width + x) * 4)) return true
    return false
  })
  let at = 0
  const starts = cells.map((n) => {
    const from = Math.round((clip.x - left + at * cellWidth) * dpr)
    at += n
    const to = Math.round((clip.x - left + at * cellWidth) * dpr)
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

/** 터미널 열 수가 `odd` 의 홀짝과 맞을 때까지 창을 줄인다. 한 번에 글자 칸 폭 이상 줄이므로 줄일 때마다 열 수가 줄어든다. */
async function setColsParity({ app, page }: Launched, odd: boolean): Promise<void> {
  const cell = await cellSize(page)
  const cols = (): Promise<number> =>
    page
      .locator('.terminal-view.active .xterm-screen')
      .evaluate((el, width) => Math.round(el.getBoundingClientRect().width / width), cell.width)
  for (let n = await cols(); (n % 2 === 1) !== odd; n = await cols()) {
    await resizeBy(app, -Math.ceil(cell.width), 0)
    await expect.poll(cols).toBeLessThan(n)
  }
}

async function launchWithHan(
  launch: (
    env?: Record<string, string>,
    executablePath?: string,
    args?: string[]
  ) => Promise<Launched>,
  renderer: 'webgl' | 'dom',
  dpr: number,
  odd?: boolean
) {
  const launched = await launch({ MARU_DOM_RENDERER: renderer === 'dom' ? '1' : '' }, undefined, [
    `--force-device-scale-factor=${dpr}`
  ])
  const { page } = launched
  expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr)
  if (odd !== undefined) await setColsParity(launched, odd)
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
// 글꼴 크기 13·15, DOM renderer, DPR 2 에서는 터미널 열 수가 홀수면 글자 칸 폭과 커서의 x 가 device px 경계에 맞지 않으므로,
// 열 수를 짝수와 홀수로 맞춰 둘 다 잰다.
for (const size of [undefined, 13, 15, 16])
  for (const renderer of ['webgl', 'dom'] as const)
    for (const dpr of [1, 2])
      for (const odd of (size === 13 || size === 15) && renderer === 'dom' && dpr === 2
        ? [false, true]
        : [undefined])
        test(`글꼴 크기 ${size ?? '기본값'}, ${renderer}, DPR ${dpr}${odd === undefined ? '' : `, 터미널 열 수 ${odd ? '홀수' : '짝수'}`}: 여러 글자를 조합하면 글자마다 확정되면 그려질 가로 위치에 그리고 끝을 자르지 않는다`, async ({
          launch,
          dataDir
        }) => {
          if (size !== undefined) writeConfig(dataDir, `[terminal]\nfont-size = ${size}\n`)
          const { page, at } = await launchWithHan(launch, renderer, dpr, odd)
          const cell = await cellSize(page)
          const cells = MIXED.map((c) => (c.length === 1 && c.charCodeAt(0) < 0x80 ? 1 : 2))
          const total = cells.reduce((a, b) => a + b, 0)
          // 마지막 글자가 글자 칸 밖으로 넘친 것까지 보도록 한 글자 칸을 더 잰다.
          const clip = { x: at.x, y: at.y, width: (total + 1) * cell.width, height: cell.height }
          const ink = (): Promise<{ starts: number[]; end: number }> =>
            glyphInk(page, clip, dpr, cell.width, cells)

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
          // 터미널 열 수가 홀수면 글자 칸 폭이 정수 device px 가 아니어서, 조합 중인 글자와 확정된 글자의 가로 위치가 1
          // device px 보다 작게 갈린다. 그러면 글자 가장자리의 옅은 픽셀 하나가 한쪽에서만 잉크로 잡히기도 한다. 그래서 1
          // device px 안의 차이는 같은 자리로 본다.
          const want = [...composing.starts, composing.end]
          const committed = await settled(ink)
          const got = [...committed.starts, committed.end]
          expect(got.map((x, i) => (x >= 0 && Math.abs(x - want[i]) <= 1 ? want[i] : x))).toEqual(
            want
          )
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
