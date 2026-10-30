import type { ElectronApplication, Page } from '@playwright/test'
import {
  activePane,
  attachFromOutside,
  cellItems,
  cellViews,
  expect,
  gridRows,
  newWorkspace,
  resizeBy,
  resizeFromOutside,
  rows,
  run,
  settled,
  sockets,
  test,
  toggleView
} from './app'

const HEIGHT = 200
const LINE = /^L(\d{3})/

/**
 * 화면 맨 위 행이 scrollback 의 몇째 행인지 센다. `fill` 이 쓰는 줄은 `L<번호>` 로 시작하는 70자라서, 열 수가 70보다 작으면
 * 한 줄이 여러 행으로 접힌다. 그래서 보이는 두 줄의 번호 차와 행 차로 한 줄이 접힌 행 수를 구한다.
 */
async function topRow(page: Page): Promise<number> {
  const starts = (await gridRows(page).allInnerTexts()).flatMap((text, i) => {
    const m = text.match(LINE)
    return m ? [{ line: Number(m[1]), i }] : []
  })
  const [a, b] = starts
  const wrap = (b.i - a.i) / (b.line - a.line)
  return (a.line - 1) * wrap - a.i
}

const settledTop = (page: Page): Promise<number> => settled(() => topRow(page))

async function wheel(page: Page, dy: number): Promise<number> {
  const before = await topRow(page)
  await page.mouse.wheel(0, dy)
  await expect.poll(() => topRow(page)).not.toBe(before)
  return settledTop(page)
}

async function resizeTo(app: ElectronApplication, page: Page, dh: number): Promise<void> {
  const before = await gridRows(page).count()
  await resizeBy(app, 0, dh)
  await expect.poll(() => gridRows(page).count()).not.toBe(before)
}

async function pointAtTerminal(page: Page): Promise<void> {
  const screen = (await activePane(page).locator('.xterm-screen').boundingBox())!
  await page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2)
}

/** 창을 키울 자리가 화면 크기에 따라 모자라지 않도록 먼저 창을 줄이고, 터미널을 `L<번호>` 줄로 채운다. */
async function fill(app: ElectronApplication, page: Page): Promise<void> {
  await resizeTo(app, page, -HEIGHT)
  await run(
    page,
    "for i in $(seq 1 300); do printf 'L%03d%066d\\n' $i 0; done; echo filled-$((1+1))",
    'filled-2'
  )
}

/** 휠 한 번에 올라가는 행 수가 첫 번째와 두 번째에 같은지 잰다. resize 로 스크롤 위치가 어긋나 있으면 첫 휠에서만 튀기 때문이다. */
async function expectWheelFrom(page: Page, top: number): Promise<void> {
  const first = await wheel(page, -100)
  const second = await wheel(page, -100)
  expect(top - first).toBeGreaterThan(0)
  expect(top - first).toBe(first - second)
}

async function wheelAndBack(page: Page): Promise<void> {
  await wheel(page, -100)
  await wheel(page, 100)
}

for (const [label, before] of [
  ['휠을 굴린 적 없는', async () => {}],
  ['휠을 굴렸다 바닥으로 되돌린', wheelAndBack],
  [
    '휠로 위로 올려 둔',
    async (page: Page) => {
      await wheel(page, -100)
      await wheel(page, -100)
    }
  ]
] as const) {
  test(`${label} 터미널은 창이 커졌다 작아진 뒤에도 그 자리에 있고, 휠 한 번에 같은 행 수만큼 올라간다`, async ({
    launch
  }) => {
    const { app, page } = await launch()
    await fill(app, page)
    await pointAtTerminal(page)
    await before(page)
    const here = await settledTop(page)

    await resizeTo(app, page, HEIGHT)
    await resizeTo(app, page, -HEIGHT)
    const top = await settledTop(page)
    expect(top).toBe(here)
    await expectWheelFrom(page, top)
  })
}

test('휠을 굴린 터미널은 창이 좁아져 줄이 접힌 뒤에도 바닥에 있고, 휠 한 번에 같은 행 수만큼 올라간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await fill(app, page)
  await pointAtTerminal(page)
  await wheelAndBack(page)
  const wide = await settledTop(page)

  await resizeBy(app, -400, 0)
  await expect.poll(() => topRow(page)).toBeGreaterThan(wide)
  const top = await settledTop(page)
  await expect(rows(page)).toContainText('filled-2')
  await pointAtTerminal(page)
  await expectWheelFrom(page, top)
})

test('다른 클라이언트가 primary 를 가져가 행 수가 줄어든 터미널도 휠 한 번에 같은 행 수만큼 올라간다', async ({
  launch,
  dataDir,
  defer
}) => {
  const { app, page } = await launch()
  await fill(app, page)
  await pointAtTerminal(page)
  await wheelAndBack(page)

  // 다른 클라이언트가 primary 를 가져갈 때 `attach.ts` 가 쓰는 안내 줄이 xterm 의 스크롤 위치를 buffer 에 다시 맞추므로,
  // 행 수는 안내가 나온 뒤에 줄인다.
  const other = await attachFromOutside(sockets(dataDir)[0], 100, await gridRows(page).count())
  defer(() => other.destroy())
  await expect(rows(page)).toContainText('took over input and size')
  resizeFromOutside(other, 100, 12)
  await expect(gridRows(page)).toHaveCount(12)
  const top = await settledTop(page)
  await pointAtTerminal(page)
  await expectWheelFrom(page, top)
})

test('columns 에서 화면 밖에 있던 터미널은 창이 커졌다 작아진 뒤에도 바닥에 남고, 휠 한 번에 같은 행 수만큼 올라간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await fill(app, page)
  await pointAtTerminal(page)
  await wheelAndBack(page)
  const bottom = await settledTop(page)
  const firstCell = () =>
    cellViews(page)
      .first()
      .evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect)
  for (const count of [2, 3, 4]) await newWorkspace(launched, count)
  await expect.poll(async () => (await firstCell()).right).toBeLessThan(0)

  await resizeTo(app, page, HEIGHT)
  await resizeTo(app, page, -HEIGHT)
  await cellItems(page).first().click()
  await expect.poll(async () => (await firstCell()).left).toBeGreaterThanOrEqual(0)
  const top = await settledTop(page)
  expect(top).toBe(bottom)
  await pointAtTerminal(page)
  await expectWheelFrom(page, top)
})
