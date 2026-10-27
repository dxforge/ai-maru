import type { ElectronApplication, Locator, Page } from '@playwright/test'
import {
  activePane,
  clickMenu,
  expect,
  expectCols,
  focusPane,
  newWorkspace,
  openPalette,
  paneRows,
  panes,
  programStatus,
  resizeBy,
  rows,
  run,
  screenshotPixels,
  shellSize,
  setZoom,
  split,
  test,
  toggleView,
  cellGroups,
  cellItems,
  cellViews,
  zshHome
} from './app'

async function inView(page: Page, el: Locator): Promise<boolean> {
  const area = (await page.locator('.terminals').boundingBox())!
  const box = (await el.boundingBox())!
  return box.x >= area.x - 1 && box.x + box.width <= area.x + area.width + 1
}

// 이 앱을 띄우는 인자로 macOS 의 "스크롤 막대 보기" 설정을 바꾼다. Cocoa 가 `-키 값` 인자를 설정으로 읽기 때문이다.
const CLASSIC_SCROLLBARS = ['-AppleShowScrollBars', 'Always']
const OVERLAY_SCROLLBARS = ['-AppleShowScrollBars', 'WhenScrolling']

// 창을 투명하게 띄우고 마우스 이벤트를 무시하게 해도, 진짜 커서가 창의 화면 영역 안에 있으면 앱이 뜰 때와
// screenshot 을 찍을 때마다 그 자리의 마우스 이벤트가 페이지에 들어와 hover 를 옮긴다.
// 화면이 좁으면 창 일부가 화면 밖으로 나가지만, screenshot 은 화면 밖 부분도 그린다.
async function moveWindowOffCursor(app: ElectronApplication): Promise<void> {
  const outside = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    const { width } = win.getBounds()
    const x =
      cursor.x - area.x > area.width / 2
        ? Math.min(cursor.x - width, area.x + area.width - width)
        : Math.max(cursor.x + 1, area.x)
    win.setPosition(x, area.y)
    const moved = win.getBounds()
    return cursor.x < moved.x || cursor.x >= moved.x + moved.width
  })
  expect(outside, '창을 커서 옆으로 옮기지 못했다').toBe(true)
}

async function scrollbarHeight(page: Page): Promise<number> {
  return page
    .locator('.terminals')
    .evaluate((el) => (el as HTMLElement).offsetHeight - el.clientHeight)
}

async function overflows(page: Page): Promise<boolean> {
  return page.locator('.terminals').evaluate((el) => el.scrollWidth > el.clientWidth)
}

async function scrollArea(page: Page): Promise<{ left: number; right: number; bottom: number }> {
  return page.locator('.terminals').evaluate((el) => {
    const { top, left } = el.getBoundingClientRect()
    const x = left + el.clientLeft
    return { left: x, right: x + el.clientWidth, bottom: top + el.clientTop + el.clientHeight }
  })
}

test('View 메뉴의 Toggle View Mode 는 cell 을 가로로 늘어놓아 80열로 보이고, 다시 누르면 선택한 것만 보인다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'X=a-$((1+1)); echo set-$((1+2))', 'set-3')
  await newWorkspace(launched, 2)
  const single = await shellSize(page)
  expect(single.cols).not.toBe(80)

  await toggleView(launched, 'columns')

  await expect(cellViews(page).nth(0)).toBeVisible()
  await expect(cellViews(page).nth(1)).toBeVisible()
  const [a, b] = [
    (await cellViews(page).nth(0).boundingBox())!,
    (await cellViews(page).nth(1).boundingBox())!
  ]
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)
  expect(b.y).toBe(a.y)
  expect(b.height).toBe(a.height)
  await expectCols(page, 80)
  await cellItems(page).first().click()
  await expectCols(page, 80)
  await run(page, 'echo "x=$X"', 'x=a-2')

  await toggleView(launched, 'single')

  await expect(cellViews(page).nth(0)).toBeVisible()
  await expect(cellViews(page).nth(1)).toBeHidden()
  expect(await page.locator('.terminals').evaluate((el) => el.scrollLeft)).toBe(0)
  await expectCols(page, single.cols)
})

test('팔레트의 Toggle View Mode 도 view mode 를 바꾸고, 키는 터미널로 간다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await page.keyboard.type('view mode')
  await page.keyboard.press('Enter')

  await expect(page.locator('.terminals')).toHaveClass(/columns/)
  await expectCols(page, 80)
})

test('columns 에서 좌우로 나누면 고르지 않게 나눠도 pane 마다 80열이다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')

  await split(app, page, 'split-right', 2)
  await expectCols(page, 80)
  await split(app, page, 'split-right', 3)
  await expectCols(page, 80)
  for (const i of [1, 0]) {
    await focusPane(app, page, 'focus-pane-left', i)
    await expectCols(page, 80)
  }
})

test('columns 에서 위아래 두 쪽의 늘어선 pane 수가 다르면 적은 쪽 pane 이 넓어진다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')

  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-down', 3)
  await split(app, page, 'split-right', 4)
  await expectCols(page, 80)
  await focusPane(app, page, 'focus-pane-up', 1)
  // 오른쪽 아래에 pane 이 둘 늘어서 있어 위쪽 pane 은 pane 두 개 폭이다.
  const wide = (await shellSize(page)).cols
  expect(wide).toBeGreaterThan(155)
  expect(wide).toBeLessThan(170)
})

test('columns 에서 다른 cell 의 pane 을 누르면 그 cell 을 선택하고 키가 그리로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'X=a-$((1+1)); echo set-$((1+2))', 'set-3')
  await newWorkspace(launched, 2)
  await run(page, 'X=b-$((2+2)); echo set-$((2+3))', 'set-5')
  await toggleView(launched, 'columns')

  await cellViews(page).nth(0).locator('.pane').click()

  await expect(cellGroups(page).first()).toHaveClass(/selected/)
  await expect(cellGroups(page).nth(1)).not.toHaveClass(/selected/)
  await run(page, 'echo "x=$X"', 'x=a-2')
  await split(launched.app, page, 'split-right', 2)
  await expect(cellViews(page).nth(1).locator('.pane')).toHaveCount(1)
})

test('columns 에서 위아래로 나눈 pane 도 80열이고, pane 을 닫으면 cell 폭이 다시 준다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  const one = (await cellViews(page).first().boundingBox())!.width

  await split(app, page, 'split-right', 2)
  expect((await cellViews(page).first().boundingBox())!.width).toBeGreaterThan(one * 1.9)
  await clickMenu(app, 'close-pane')
  await expect(panes(page)).toHaveCount(1)
  await expect.poll(async () => (await cellViews(page).first().boundingBox())!.width).toBe(one)

  await split(app, page, 'split-down', 2)
  await expectCols(page, 80)
  expect((await cellViews(page).first().boundingBox())!.width).toBe(one)
})

test('columns 에서 넘치면 가로로 스크롤하고, 포커스가 간 pane 이 보이도록 따라간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  const area = page.locator('.terminals')
  expect(await overflows(page)).toBe(true)
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
  await expect.poll(() => inView(page, cellViews(page).nth(0))).toBe(false)

  await cellItems(page).first().click()
  await expect.poll(() => inView(page, cellViews(page).nth(0))).toBe(true)

  await newWorkspace(launched, 4)
  await expect.poll(() => inView(page, cellViews(page).nth(3))).toBe(true)

  await cellItems(page).first().click()
  await split(app, page, 'split-right', 2)
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
  await expect.poll(() => inView(page, panes(page).nth(0))).toBe(false)
  await clickMenu(app, 'focus-pane-left')
  await expect.poll(() => inView(page, panes(page).nth(0))).toBe(true)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)

  await area.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect.poll(() => inView(page, activePane(page))).toBe(false)
  await cellItems(page).first().click()
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
})

test('columns 에서 포커스가 같은 pane 으로 돌아와도 스크롤한 자리는 그대로고, 사이드바의 pane 줄을 누르면 그 pane 을 보인다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await page.keyboard.type(programStatus('working'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await cellItems(page).first().click()
  await expect.poll(() => inView(page, activePane(page))).toBe(true)

  const area = page.locator('.terminals')
  const scrolled = await area.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
    return el.scrollLeft
  })
  await expect.poll(() => inView(page, activePane(page))).toBe(false)
  // 브라우저가 focus() 로 스스로 스크롤하지 않게 해서 앱이 하는 스크롤만 잰다.
  await activePane(page)
    .locator('textarea')
    .evaluate(async (el) => {
      el.blur()
      el.focus({ preventScroll: true })
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
  expect(await area.evaluate((el) => el.scrollLeft)).toBe(scrolled)

  await paneRows(page).click()
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
})

test('columns 에서 pane 의 디렉토리가 바뀌어도 스크롤한 자리는 그대로다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch({ SHELL: '/bin/zsh', HOME: zshHome(dataDir, 'notes') })
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  const names = page.locator('.cell-header .name')
  await expect(names).toHaveText(['home', 'home', 'home'])
  await page.keyboard.type('sleep 2; cd notes\n')

  const area = page.locator('.terminals')
  await area.evaluate((el) => (el.scrollLeft = 0))
  await expect.poll(() => inView(page, activePane(page))).toBe(false)
  await expect(names).toHaveText(['home', 'home', 'notes'])
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  )
  expect(await area.evaluate((el) => el.scrollLeft)).toBe(0)
})

test('columns 에서 앞의 cell 이 닫혀도 포커스된 pane 이 화면에 남고 키를 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await cellItems(page).first().click()
  await page.keyboard.type('sleep 1.5; exit\n')
  await cellItems(page).nth(1).click()
  await expect.poll(() => inView(page, activePane(page))).toBe(true)

  await expect(cellItems(page)).toHaveCount(2)

  await expect.poll(() => inView(page, activePane(page))).toBe(true)
  await expect(cellGroups(page).first()).toHaveClass(/selected/)
  await run(page, 'echo typed-$((1+1))', 'typed-2')
})

test('고전 스크롤바 설정의 columns 에서 가로 스크롤바는 기본보다 낮고, cell 이 넘치기 시작하거나 넘침이 그쳐도 그 높이와 터미널의 줄 수는 그대로다', async ({
  launch
}) => {
  const launched = await launch({}, undefined, CLASSIC_SCROLLBARS)
  const { page } = launched
  await toggleView(launched, 'columns')
  const standard = await page.evaluate(() => {
    const el = document.createElement('div')
    el.style.overflowX = 'scroll'
    document.body.append(el)
    const height = el.offsetHeight - el.clientHeight
    el.remove()
    return height
  })
  const bar = await scrollbarHeight(page)
  expect(bar).toBeGreaterThan(0)
  expect(bar).toBeLessThan(standard)
  const before = await shellSize(page)

  await newWorkspace(launched, 2)
  expect(await overflows(page)).toBe(true)
  await cellItems(page).first().click()

  expect(await scrollbarHeight(page)).toBe(bar)
  expect((await shellSize(page)).rows).toBe(before.rows)

  await cellItems(page).nth(1).click()
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(1)
  expect(await overflows(page)).toBe(false)

  expect(await scrollbarHeight(page)).toBe(bar)
  expect((await shellSize(page)).rows).toBe(before.rows)
})

test('고전 스크롤바 설정에서 columns 가 넘치지 않을 때도 가로 스크롤바의 트랙이 바탕과 다른 색으로 보이고, 넘치면 thumb 이 트랙과 다른 색으로 보인다', async ({
  launch
}) => {
  const launched = await launch({}, undefined, CLASSIC_SCROLLBARS)
  const { page } = launched
  await toggleView(launched, 'columns')
  expect(await overflows(page)).toBe(false)
  const area = await scrollArea(page)
  const bar = await scrollbarHeight(page)
  const reds = async (x: number): Promise<{ ground: number; bar: number }> => {
    const { data } = await screenshotPixels(
      page,
      { x, y: area.bottom - 1, width: 1, height: bar + 1 },
      'css'
    )
    return { ground: data[0], bar: data[(1 + Math.floor(bar / 2)) * 4] }
  }

  const empty = await reds(area.left + 40)
  expect(empty.bar).not.toBe(empty.ground)

  await newWorkspace(launched, 2)
  await cellItems(page).first().click()
  await expect.poll(() => page.locator('.terminals').evaluate((el) => el.scrollLeft)).toBe(0)
  const thumb = await reds(area.left + 40)
  const track = await reds(area.right - 40)
  expect(track.bar).toBe(empty.bar)
  expect(thumb.bar).not.toBe(track.bar)
})

test('overlay 스크롤바 설정에서 columns 의 가로 스크롤바는 넘쳐도 자리를 차지하지 않는다', async ({
  launch
}) => {
  const launched = await launch({}, undefined, OVERLAY_SCROLLBARS)
  const { page } = launched
  await newWorkspace(launched, 2)
  await toggleView(launched, 'columns')

  expect(await overflows(page)).toBe(true)
  expect(await scrollbarHeight(page)).toBe(0)
})

test('overlay 스크롤바 설정에서 columns 의 트랙은 스크롤할 때 보이지 않고, 스크롤바에 마우스를 올린 채 스크롤하면 칠해진다', async ({
  launch
}) => {
  const launched = await launch({}, undefined, OVERLAY_SCROLLBARS)
  const { app, page } = launched
  await moveWindowOffCursor(app)
  await newWorkspace(launched, 2)
  await toggleView(launched, 'columns')
  const area = await scrollArea(page)
  const red = async (x: number): Promise<number> =>
    (await screenshotPixels(page, { x, y: area.bottom - 4, width: 1, height: 1 }, 'css')).data[0]
  // 새 cell 의 pane 을 따라 맨 오른쪽까지 스크롤했으므로 thumb 은 오른쪽 끝에 있다.
  const [track, thumb] = [area.left + 40, area.right - 40]
  const middle = (area.left + area.right) / 2
  // 처음 넘칠 때 나타난 스크롤바가 사라지면 두 자리 모두 바탕색이다.
  await expect.poll(async () => (await red(thumb)) - (await red(track))).toBe(0)
  const ground = await red(track)

  await page.mouse.move(middle, area.bottom - 200)
  await page.mouse.wheel(-60, 0)
  await expect.poll(() => red(thumb)).not.toBe(ground)
  expect(await red(track)).toBe(ground)

  await expect.poll(() => red(thumb)).toBe(ground)
  await page.mouse.move(middle, area.bottom - 4)
  await page.mouse.wheel(-60, 0)
  await expect.poll(() => red(track)).not.toBe(ground)
})

test('columns 에서 선택한 cell 의 테두리는 아래 변도 스크롤 영역 안에 그려진다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await toggleView(launched, 'columns')

  // 테두리는 카드 바깥 1px 의 box-shadow 라, 스크롤 영역이 자르지 않으려면 그 1px 이 영역 안에 있어야 한다.
  const area = await scrollArea(page)
  const card = (await cellViews(page).first().boundingBox())!
  expect(card.y + card.height + 1).toBeLessThanOrEqual(area.bottom)
  expect(card.x - 1).toBeGreaterThanOrEqual(area.left)
})

test('columns 에서 포커스를 따라 스크롤해도 선택한 cell 의 옆 테두리는 스크롤 영역 안에 그려진다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await cellItems(page).first().click()
  await expect.poll(() => inView(page, cellViews(page).nth(0))).toBe(true)

  const area = await scrollArea(page)
  const right = async (): Promise<number> => {
    const card = (await cellViews(page).nth(2).boundingBox())!
    return card.x + card.width + 1
  }
  await cellItems(page).nth(2).click()
  await expect.poll(right).toBeLessThanOrEqual(area.right)

  const left = async (): Promise<number> => (await cellViews(page).nth(0).boundingBox())!.x - 1
  await cellItems(page).first().click()
  await expect.poll(left).toBeGreaterThanOrEqual(area.left)
})

test('columns 에서 줌을 바꿔도 pane 은 80열이다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 80)

  for (const level of [0.5, 1, 1.5, 2, 2.5, 3, -0.5, -1, -1.5, -2, -2.5, -3]) {
    const before = await page.evaluate(() => devicePixelRatio)
    await setZoom(app, level)
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).not.toBe(before)
    await expectCols(page, 80)
  }
})

test('columns 에서 창 크기를 바꿔도 pane 은 80열이다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  const before = await shellSize(page)

  await resizeBy(app, -200, -180)

  await expect.poll(async () => (await shellSize(page)).rows).toBeLessThan(before.rows)
  expect((await shellSize(page)).cols).toBe(80)
})

test('columns 에서 마우스 트래킹을 켠 터미널 위에서도 가로 스와이프로 스크롤하고, 세로 wheel 은 프로그램에 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await cellItems(page).first().click()
  const area = page.locator('.terminals')
  await expect.poll(() => area.evaluate((el) => el.scrollLeft)).toBe(0)
  await run(page, "printf '\\033[?1000h'; echo on-$((1+1))", 'on-2')
  await expect(activePane(page).locator('.xterm')).toHaveClass(/enable-mouse-events/)
  const box = (await activePane(page).locator('.xterm-screen').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

  await page.mouse.wheel(300, 0)
  await expect.poll(() => area.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)

  await area.evaluate((el) => (el.scrollLeft = 0))
  await page.keyboard.type('cat -v\n')
  await page.mouse.wheel(0, 100)
  await expect(rows(page)).toContainText('^[[M')
  expect(await area.evaluate((el) => el.scrollLeft)).toBe(0)
})

test('columns 에서 마우스 트래킹 없는 alt buffer 위의 가로 스와이프는 화살표 키가 되지 않고 스크롤한다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await cellItems(page).first().click()
  const area = page.locator('.terminals')
  await expect.poll(() => area.evaluate((el) => el.scrollLeft)).toBe(0)
  await run(page, "printf '\\033[?1049h'; echo alt-$((1+1)); cat -v", 'alt-2')
  const box = (await activePane(page).locator('.xterm-screen').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

  await page.mouse.wheel(300, 60)
  await expect.poll(() => area.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)

  await area.evaluate((el) => (el.scrollLeft = 0))
  await page.mouse.wheel(0, 100)
  await expect(rows(page)).toContainText('^[[B')
})
