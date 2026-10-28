import type { Locator, Page } from '@playwright/test'
import { SCROLLBAR_WIDTH } from '../src/renderer/src/workspace/columns'
import {
  activeTerminal,
  expect,
  newWorkspace,
  panes,
  split,
  sttySize,
  test,
  toggleView,
  WEBGL_CANVAS,
  cellItems,
  cellViews
} from './app'

type Renderer = 'webgl' | 'dom'

async function renderer(terminal: Locator): Promise<Renderer | 'none'> {
  return terminal.evaluate((el, webgl) => {
    if (el.querySelector(webgl)) return 'webgl'
    return el.querySelector('.xterm-rows') ? 'dom' : 'none'
  }, WEBGL_CANVAS)
}

function terminals(scope: Page | Locator): Locator {
  return scope.locator('.terminal-view')
}

async function renderers(scope: Page | Locator): Promise<Renderer[]> {
  const all = await terminals(scope).all()
  return Promise.all(all.map(renderer)) as Promise<Renderer[]>
}

// 3초 안에 되살아나지 않으면 addon 이 onContextLoss 를 낸다.
async function loseContext(terminal: Locator): Promise<void> {
  await terminal.evaluate((el, webgl) => {
    const canvas = el.querySelector<HTMLCanvasElement>(webgl)!
    canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext()
  }, WEBGL_CANVAS)
}

test('선택된 cell 의 터미널은 WebGL 로, 선택되지 않은 cell 의 터미널은 DOM 으로 그리고, 선택을 바꾸면 따라 바뀐다', async ({
  launch
}) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { app, page } = launched
  await split(app, page, 'split-right', 2)
  await expect.poll(() => renderers(cellViews(page).nth(0))).toEqual(['webgl', 'webgl'])

  await newWorkspace(launched, 2)
  await expect.poll(() => renderers(cellViews(page).nth(1))).toEqual(['webgl'])
  await expect.poll(() => renderers(cellViews(page).nth(0))).toEqual(['dom', 'dom'])

  await cellItems(page).first().click()
  await expect.poll(() => renderers(cellViews(page).nth(0))).toEqual(['webgl', 'webgl'])
  await expect.poll(() => renderers(cellViews(page).nth(1))).toEqual(['dom'])
})

test('columns 에서는 화면에 보이는 cell 의 터미널만 WebGL 로 그리고, 스크롤해서 보이면 WebGL 로 바뀐다', async ({
  launch
}) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  const area = page.locator('.terminals')
  await area.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect.poll(() => renderers(cellViews(page).nth(0))).toEqual(['dom'])
  await expect.poll(() => renderers(cellViews(page).nth(2))).toEqual(['webgl'])

  await area.evaluate((el) => (el.scrollLeft = 0))
  await expect.poll(() => renderers(cellViews(page).nth(0))).toEqual(['webgl'])
  await expect.poll(() => renderers(cellViews(page).nth(2))).toEqual(['dom'])

  await toggleView(launched, 'single')
  await expect.poll(() => renderers(page)).toEqual(['dom', 'dom', 'webgl'])
})

test('WebGL context 를 잃은 터미널은 보이는 동안 DOM 으로 그리고, 숨었다 다시 보이면 WebGL 로 돌아온다', async ({
  launch
}) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { page } = launched
  const first = terminals(cellViews(page).nth(0))
  await expect.poll(() => renderer(first)).toBe('webgl')

  await loseContext(first)
  await expect.poll(() => renderer(first), { timeout: 10_000 }).toBe('dom')
  await page.waitForTimeout(500)
  expect(await renderer(first)).toBe('dom')
  await expect(panes(page).first().locator('.xterm-screen')).toBeVisible()

  await newWorkspace(launched, 2)
  await cellItems(page).first().click()
  await expect.poll(() => renderer(first)).toBe('webgl')
})

async function screenWidth(
  terminal: Locator
): Promise<{ screen: number; room: number; cell: number }> {
  return terminal.evaluate((el) => {
    const xterm = el.querySelector<HTMLElement>('.xterm')!
    const style = getComputedStyle(xterm)
    const room =
      el.getBoundingClientRect().width -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight)
    const cell = parseFloat(getComputedStyle(el).getPropertyValue('--cell'))
    return { screen: el.querySelector('.xterm-screen')!.getBoundingClientRect().width, room, cell }
  })
}

test('WebGL 터미널은 pane 폭을 글자 칸 단위로 채우고, renderer 가 바뀌어도 셸이 보는 열 수는 그대로다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { page } = launched
  const first = terminals(cellViews(page).nth(0))
  await expect.poll(() => renderer(first)).toBe('webgl')
  const w = await screenWidth(first)
  const spare = w.room - SCROLLBAR_WIDTH - w.screen
  expect(spare).toBeGreaterThanOrEqual(0)
  expect(spare).toBeLessThan(w.cell)
  const before = await sttySize(page, dataDir)

  await newWorkspace(launched, 2)
  await expect.poll(() => renderer(first)).toBe('dom')
  await cellItems(page).first().click()
  await expect.poll(() => renderer(first)).toBe('webgl')
  expect(await sttySize(page, dataDir)).toEqual(before)

  await loseContext(first)
  await expect.poll(() => renderer(first), { timeout: 10_000 }).toBe('dom')
  expect(await sttySize(page, dataDir)).toEqual(before)
})

test('WebGL2 를 쓸 수 없으면 DOM 으로 그리고, pane 폭을 DOM 의 글자 칸 단위로 채우며 columns 의 pane 은 80열이다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { page } = launched
  // 첫 터미널이 열리기 전에 막아야 하므로, init script 를 걸고 페이지를 다시 불러온다.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      id: string,
      ...rest
    ) {
      return id === 'webgl2' ? null : getContext.call(this, id, ...rest)
    } as typeof getContext
  })
  await page.reload()
  await activeTerminal(page)
  const first = terminals(page)
  await page.waitForTimeout(500)
  expect(await renderer(first)).toBe('dom')
  await expect
    .poll(async () => {
      const w = await screenWidth(first)
      const spare = w.room - SCROLLBAR_WIDTH - w.screen
      return spare >= 0 && spare < w.cell
    })
    .toBe(true)

  await newWorkspace(launched, 2)
  await toggleView(launched, 'columns')
  await expect.poll(async () => (await sttySize(page, dataDir)).cols).toBe(80)
})

test('WebGL 로 그려도 columns 의 pane 은 80열이다', async ({ launch, dataDir }) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  await toggleView(launched, 'columns')
  await expect.poll(async () => (await sttySize(launched.page, dataDir)).cols).toBe(80)
})

test('pane 이 많은 cell 사이를 한도보다 많이 오가도 WebGL context 가 한도를 넘지 않는다', async ({
  launch
}) => {
  const launched = await launch({ MARU_DOM_RENDERER: '' })
  const { app, page } = launched
  const warnings: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('Too many active WebGL contexts')) warnings.push(m.text())
  })
  for (let w = 0; w < 4; w++) {
    if (w > 0) await newWorkspace(launched, w + 1)
    for (let i = 0; i < 3; i++) await split(app, page, i % 2 ? 'split-down' : 'split-right', i + 2)
  }
  for (let i = 0; i < 40; i++)
    await cellItems(page)
      .nth(i % 4)
      .click()
  await expect
    .poll(() => renderers(cellViews(page).nth(3)))
    .toEqual(['webgl', 'webgl', 'webgl', 'webgl'])
  expect(warnings).toEqual([])
})

test('MARU_DOM_RENDERER 를 주고 띄우면 보이는 터미널도 DOM 으로 그린다', async ({ launch }) => {
  const { page } = await launch()
  await page.waitForTimeout(500)
  expect(await renderers(page)).toEqual(['dom'])
})
