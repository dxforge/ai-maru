import type { CDPSession, Page } from '@playwright/test'
import {
  cellSize,
  expect,
  GROUND,
  isInk,
  screenshotPixels,
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

async function inkLeft(page: Page, clip: Box): Promise<number> {
  const { data, width, height } = await screenshotPixels(page, clip)
  for (let x = 0; x < width; x++)
    for (let y = 0; y < height; y++) if (isInk(data, (y * width + x) * 4)) return x
  return -1
}

/**
 * `ink` 가 세 번 연달아 같게 잰 값. WebGL renderer 는 커서(textarea)가 옮겨 간 다음 프레임에 캔버스를 그린다.
 * 그 사이에 찍으면 지우기 전의 글자나 빈 화면이 잡힌다.
 */
async function settledInk(
  page: Page,
  clip: Box,
  ink: (page: Page, clip: Box) => Promise<number>
): Promise<number> {
  const seen: number[] = []
  await expect
    .poll(async () => {
      seen.push(await ink(page, clip))
      return seen.length >= 3 && seen.slice(-3).every((v) => v === seen.at(-1))
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

/**
 * `renderer`·`dpr` 로 앱을 띄워 첫 줄에 한을 찍는다. `clip` 은 커서 뒤 두 글자 칸이다. `committedClip` 은 그 위 줄의
 * 첫 두 글자 칸으로, 찍은 한이 있다.
 */
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
      const committed = await settledInk(page, committedClip, inkTop)
      expect(committed).toBeGreaterThan(0)

      const cdp = await page.context().newCDPSession(page)
      await compose(cdp, '한')
      await expect(page.locator('.terminal-view.active .composition-view')).toBeVisible()
      expect(await settledInk(page, clip, inkTop)).toBe(committed)
    })

// 글꼴 크기 15, DPR 1 에서는 WebGL renderer 가 글자 칸 폭을 device px 로 내림하므로 한글이 두 글자 칸보다 넓다.
for (const size of [undefined, 15])
  for (const renderer of ['webgl', 'dom'] as const)
    for (const dpr of [1, 2])
      test(`글꼴 크기 ${size ?? '기본값'}, ${renderer}, DPR ${dpr}: 조합 중인 한글을 확정되면 그려질 가로 위치에 그린다`, async ({
        launch,
        dataDir
      }) => {
        if (size !== undefined) writeConfig(dataDir, `[terminal]\nfont-size = ${size}\n`)
        // DOM renderer 의 글자 칸 폭은 소수일 수 있어, 열마다 글자가 놓이는 px 안의 자리가 다르다. 그래서 찍은 한이 있는
        // `committedClip` 이 아니라, 조합한 글자를 그 자리에서 확정해 같은 글자 칸에서 견준다.
        const { page, at, clip } = await launchWithHan(launch, renderer, dpr)

        const cdp = await page.context().newCDPSession(page)
        await compose(cdp, '한')
        const view = page.locator('.terminal-view.active .composition-view')
        await expect(view).toBeVisible()
        // 밑줄이 조합창의 왼쪽 끝부터 그어져, `inkLeft` 가 글자 대신 밑줄의 왼쪽 끝을 잰다.
        await view.evaluate((el) => (el.style.textDecoration = 'none'))
        const composing = await settledInk(page, clip, inkLeft)

        await cdp.send('Input.insertText', { text: '한' })
        await expect(view).toBeHidden()
        await expect.poll(async () => (await cursor(page)).x).toBeGreaterThan(at.x)
        expect(composing).toBeGreaterThanOrEqual(0)
        expect(await settledInk(page, clip, inkLeft)).toBe(composing)
      })

// 기본 글꼴 크기와 13·15·16 에서 잰다. DPR 1 에서는 WebGL renderer 가 글자 칸 폭을 device px 로 내림하므로 13·15 에서는
// 한글이 두 글자 칸보다 넓고, 16 에서는 두 글자 칸과 같다.
for (const size of [undefined, 13, 15, 16])
  test(`글꼴 크기 ${size ?? '기본값'}: 조합창은 터미널 배경에 밑줄로 두 글자 칸을 덮어 그 아래의 커서를 가린다`, async ({
    launch,
    dataDir
  }) => {
    if (size !== undefined) writeConfig(dataDir, `[terminal]\nfont-size = ${size}\n`)
    const launched = await launch({ MARU_DOM_RENDERER: '' })
    const { page } = launched
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
        fontSize: s.fontSize,
        left: r.left,
        top: r.top,
        bottom: r.bottom,
        width: r.width
      }
    })
    if (size !== undefined) expect(style.fontSize).toBe(`${size}px`)
    expect(style.background).toBe(`rgb(${GROUND.join(', ')})`)
    expect(style.decoration).toBe('underline')
    expect(style.left).toBeCloseTo(at.x, 1)
    expect(style.width).toBeCloseTo(2 * cell.width, 1)
    expect(style.top).toBeLessThanOrEqual(at.y + 0.01)
    expect(style.bottom).toBeGreaterThanOrEqual(at.y + cell.height - 0.01)
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

test('한글과 영문을 설치된 D2Coding 으로 그린다', async ({ launch }) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { page } = launched
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
