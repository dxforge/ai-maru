import type { Page } from '@playwright/test'
import {
  cellSize,
  cellViews,
  expect,
  paneBox,
  panes,
  restartWith,
  run,
  screen,
  screenText,
  shellSize,
  split,
  test,
  toggleView
} from './app'

const handle = (page: Page) => page.locator('.panes.selected .split-handle.right')
const badges = (page: Page) => page.locator('.panes.selected .size-badge')

// 셸이 받은 SIGWINCH 를 센다. 끄는 동안 pty 크기가 바뀌면 이 수가 는다.
async function countResizes(page: Page): Promise<void> {
  await run(page, "n=0; trap 'n=$((n+1))' WINCH; echo trap-$((1+1))", 'trap-2')
}

async function resizes(page: Page, marker: string): Promise<number> {
  await run(page, `clear; echo ${marker}=$n`, new RegExp(`${marker}=\\d+`))
  const text = await screenText(screen(page))
  return Number(text.match(new RegExp(`${marker}=(\\d+)`))![1])
}

async function center(page: Page) {
  const box = (await handle(page).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('경계를 끄는 동안은 cols×rows 만 보이고, 놓을 때 pty 크기가 한 번 바뀐다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await countResizes(page)
  const before = await shellSize(page)
  const cell = await cellSize(page)
  const from = await center(page)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x - 10 * cell.width, from.y, { steps: 10 })
  await expect(badges(page)).toHaveCount(2)
  await expect(badges(page).nth(1)).toHaveText(`${before.cols + 10}×${before.rows}`)
  await page.mouse.up()
  await expect(badges(page)).toHaveCount(0)

  expect((await shellSize(page)).cols).toBe(before.cols + 10)
  expect(await resizes(page, 'drag')).toBe(1)
})

test('⌃⌘방향키를 누르고 있는 동안은 경계만 움직이고, ⌃⌘ 를 놓을 때 한 번 반영한다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await countResizes(page)
  const before = await shellSize(page)

  await page.keyboard.down('Control')
  await page.keyboard.down('Meta')
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
  await expect(badges(page).nth(1)).toHaveText(`${before.cols + 4}×${before.rows}`)
  await page.keyboard.up('Meta')
  await page.keyboard.up('Control')
  await expect(badges(page)).toHaveCount(0)

  expect((await shellSize(page)).cols).toBe(before.cols + 4)
  expect(await resizes(page, 'keys')).toBe(1)
})

test('경계를 더블클릭하면 그 줄이 다시 같은 크기가 되고, 끈 크기는 재시작 뒤에도 남는다', async ({
  launch
}) => {
  const first = await launch()
  await split(first.app, first.page, 'split-right', 2)
  const cell = await cellSize(first.page)
  const from = await center(first.page)
  await first.page.mouse.move(from.x, from.y)
  await first.page.mouse.down()
  await first.page.mouse.move(from.x + 12 * cell.width, from.y, { steps: 4 })
  await first.page.mouse.up()
  const dragged = [await paneBox(first.page, 0), await paneBox(first.page, 1)]
  expect(dragged[0].width - dragged[1].width).toBeGreaterThan(20 * cell.width)
  const before = await shellSize(first.page)

  await restartWith(first.app)
  const { page } = await launch()
  await expect.poll(() => paneBox(page, 0)).toEqual(dragged[0])
  await expect.poll(() => shellSize(page)).toEqual(before)

  await handle(page).dblclick()
  await expect
    .poll(async () => Math.abs((await paneBox(page, 0)).width - (await paneBox(page, 1)).width))
    .toBeLessThanOrEqual(cell.width)
})

test('columns 보기에서 cell 오른쪽 끝을 끌면 마지막 pane 의 열 수와 카드 폭이 그만큼 바뀐다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await toggleView(launched, 'columns')
  await expect(panes(page)).toHaveCount(1)
  const before = await shellSize(page)
  const cell = await cellSize(page)
  const card = (await cellViews(page).first().boundingBox())!
  const edge = (await page.locator('.cell-edge').first().boundingBox())!

  const y = edge.y + edge.height / 2
  await page.mouse.move(edge.x + edge.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(edge.x + edge.width / 2 + 6 * cell.width, y, { steps: 3 })
  await page.mouse.up()

  await expect.poll(async () => (await shellSize(page)).cols).toBe(before.cols + 6)
  expect((await cellViews(page).first().boundingBox())!.width).toBeCloseTo(
    card.width + 6 * cell.width,
    0
  )
})
