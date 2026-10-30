import type { Locator, Page } from '@playwright/test'
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
  shellSize,
  setZoom,
  split,
  test,
  toggleView,
  cellGroups,
  cellItems,
  cellViews,
  writeConfig,
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

type Scroll = { left: number; frame: number; time: number }

/** 한 프레임에 페이지 시각이 나아가는 폭의 상한(ms)이다. 60Hz 의 한 프레임이다. */
const FRAME_MS = 16

/**
 * `act` 가 일으킨 `.terminals` 의 가로 스크롤을, 자리가 바뀐 프레임마다 그 프레임 번호와 페이지 시각을 붙여 모은다. 맨 앞은 `act` 전의 자리다.
 *
 * 전체 e2e 를 돌리면 프레임 사이가 300ms 가까이 벌어질 때가 있어, 앱의 300ms 스크롤이 프레임 한두 개 만에 끝난다.
 * 그래서 모으는 동안 페이지의 `requestAnimationFrame`·`cancelAnimationFrame`·`performance.now` 를 바꿔, 한 프레임에
 * 페이지 시각이 `FRAME_MS` 넘게 나아가지 않게 한다. 페이지 시각은 실제 시각을 앞지르지 않는다. 앞지르면 되돌린 뒤
 * `performance.now` 가 뒤로 가기 때문이다. `frameMs` 를 `Infinity` 로 주면 페이지 시각은 프레임마다 그 프레임이 시작한 때의 실제 시각이 된다.
 */
async function scrollsOf(
  page: Page,
  act: () => Promise<unknown>,
  frameMs = FRAME_MS
): Promise<Scroll[]> {
  const area = page.locator('.terminals')
  await area.evaluate((el, frameMs) => {
    const realFrame = window.requestAnimationFrame.bind(window)
    const realCancel = window.cancelAnimationFrame.bind(window)
    const realNow = performance.now.bind(performance)
    const queued = new Map<number, FrameRequestCallback>()
    // `cancelAnimationFrame` 이 바꾸기 전에 앱이 받은 진짜 handle 을 가려 진짜 쪽에 넘길 수 있게, 번호를 진짜 handle 과 겹치지 않는 큰 수에서 시작한다.
    // 번호는 `window` 에 두어 `scrollsOf` 를 다시 불러도 이어 매긴다. 다시 매기면 앞 호출에서 앱이 받아 둔 handle 로 뒤 호출의 다른 콜백을 지우기 때문이다.
    const ids = window as unknown as { scrollsFrameId?: number }
    ids.scrollsFrameId ??= 1e9
    let now = realNow()
    let frame = 0
    const scrolls: Scroll[] = [{ left: el.scrollLeft, frame, time: now }]
    let quietSince = 0
    // 끝내는 조건의 프레임 수는 `act` 가 돌아온 뒤부터 센다. 그 전부터 세면 `act` 도중에 모으기가 끝나 그 뒤의 스크롤을 놓치기 때문이다.
    let acted = -1
    window.requestAnimationFrame = (callback) => {
      const id = ++ids.scrollsFrameId!
      queued.set(id, callback)
      return id
    }
    window.cancelAnimationFrame = (handle) => {
      if (!queued.delete(handle)) realCancel(handle)
    }
    performance.now = () => now
    let done!: () => void
    const finished = new Promise<void>((r) => (done = r))
    const tick = (): void => {
      frame++
      now = Math.min(now + frameMs, realNow())
      const due = [...queued.values()]
      queued.clear()
      for (const callback of due) {
        try {
          callback(now)
        } catch (e) {
          reportError(e)
        }
      }
      if (el.scrollLeft !== scrolls.at(-1)!.left) {
        scrolls.push({ left: el.scrollLeft, frame, time: now })
        quietSince = frame
      }
      const quiet = frame - Math.max(quietSince, acted)
      if (acted >= 0 && ((scrolls.length > 1 && quiet >= 30) || frame - acted > 600)) {
        window.requestAnimationFrame = realFrame
        window.cancelAnimationFrame = realCancel
        delete (performance as { now?: unknown }).now
        for (const callback of queued.values()) realFrame(callback)
        done()
      } else realFrame(tick)
    }
    realFrame(tick)
    ;(window as unknown as { scrollsAfterAct: () => Promise<Scroll[]> }).scrollsAfterAct = () => {
      acted = frame
      return finished.then(() => scrolls)
    }
  }, frameMs)
  await act()
  return area.evaluate(() =>
    (window as unknown as { scrollsAfterAct: () => Promise<Scroll[]> }).scrollsAfterAct()
  )
}

/**
 * `expectSmooth` 는 스크롤이 서로 다른 두 프레임 이상에서 시작과 끝 사이의 자리를 지났는지 본다. 내용이 줄어
 * 브라우저가 scrollLeft 를 자르면 한 프레임에도 시작과 끝 사이의 자리를 지나므로, 한 프레임만으로는 smooth 와 가르지 못한다.
 */
function expectSmooth(scrolls: Scroll[]): void {
  const start = scrolls[0].left
  const end = scrolls.at(-1)!.left
  expect(end, `스크롤하지 않았다: ${JSON.stringify(scrolls)}`).not.toBe(start)
  const between = scrolls.filter((s) => (s.left - start) * (s.left - end) < 0)
  expect(
    new Set(between.map((s) => s.frame)).size,
    `중간 자리를 거치지 않았다: ${JSON.stringify(scrolls)}`
  ).toBeGreaterThanOrEqual(2)
}

function expectInstant(scrolls: Scroll[]): void {
  const moved = scrolls.slice(1).filter((s) => s.left !== scrolls[0].left)
  expect(moved.length, `스크롤하지 않았다: ${JSON.stringify(scrolls)}`).toBeGreaterThan(0)
  expect(moved.at(-1)!.frame - moved[0].frame, JSON.stringify(scrolls)).toBeLessThanOrEqual(1)
}

async function expectRevealed(page: Page): Promise<void> {
  await expect.poll(() => inView(page, activePane(page))).toBe(true)
  await expectInstantPlace(page)
}

async function expectInstantPlace(page: Page): Promise<void> {
  const [before, after] = await page.evaluate(() => {
    const area = document.querySelector('.terminals')!
    const before = area.scrollLeft
    document
      .querySelector('.terminal-view.active')!
      .scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    return [before, area.scrollLeft]
  })
  expect(after).toBe(before)
}

async function scrollbarHeight(page: Page): Promise<number> {
  return page
    .locator('.terminals')
    .evaluate((el) => (el as HTMLElement).offsetHeight - el.clientHeight)
}

async function overflows(page: Page): Promise<boolean> {
  return page.locator('.terminals').evaluate((el) => el.scrollWidth > el.clientWidth)
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
  await expect.poll(() => page.locator('.terminals').evaluate((el) => el.scrollLeft)).toBe(0)
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

test('columns 에서 사이드바로 다른 cell 을 고르거나 고른 cell 을 다시 누르거나 pane 을 나누거나 pane 포커스를 옮기면 부드럽게 스크롤해 바로 스크롤한 자리에 선다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await expectRevealed(page)
  const area = page.locator('.terminals')

  expectSmooth(await scrollsOf(page, () => cellItems(page).first().click()))
  await expectRevealed(page)

  await area.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  expectSmooth(await scrollsOf(page, () => cellItems(page).first().click()))
  await expectRevealed(page)

  expectSmooth(await scrollsOf(page, () => split(app, page, 'split-right', 2)))
  await expectRevealed(page)
  expectSmooth(await scrollsOf(page, () => clickMenu(app, 'focus-pane-left')))
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await expectRevealed(page)
})

test('columns 로 바꾸면 바로 스크롤한다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)

  expectInstant(await scrollsOf(page, () => toggleView(launched, 'columns')))
  await expectRevealed(page)
})

test('columns 에서 포커스를 따라 스크롤하는 중에 사용자가 스크롤하면 그 자리를 뺏지 않는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  await toggleView(launched, 'columns')
  await expectRevealed(page)
  const area = page.locator('.terminals')
  const start = await area.evaluate((el) => el.scrollLeft)

  await cellItems(page).first().click()
  const [left, max] = await area.evaluate(async (el, start) => {
    const frame = (): Promise<unknown> => new Promise((r) => requestAnimationFrame(r))
    while (el.scrollLeft === start) await frame()
    el.scrollLeft = el.scrollWidth
    for (let n = 0; n < 40; n++) await frame()
    return [el.scrollLeft, el.scrollWidth - el.clientWidth]
  }, start)
  expect(left).toBe(max)
})

test('columns 에서 포커스를 빠르게 이어 옮겨도 마지막으로 옮긴 뒤 곧 그 pane 에 선다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  for (let n = 2; n <= 8; n++) await newWorkspace(launched, n)
  await toggleView(launched, 'columns')
  await scrollsOf(page, () => cellItems(page).first().click())
  await expectRevealed(page)

  // 700ms 상한은 실제 시각으로 잰다. 페이지 시각을 한 프레임에 `FRAME_MS` 까지만 나아가게 하면, 부하로 프레임이
  // 늦을 때 페이지 시각이 덜 흘러 700ms 를 넘긴 회귀도 통과하기 때문이다.
  let pressed = 0
  const scrolls = await scrollsOf(
    page,
    async () => {
      for (let n = 0; n < 7; n++) await clickMenu(app, 'next-cell')
      // `scrollsOf` 가 바꾼 `performance.now` 는 마지막 프레임의 시각을 돌려주므로, 바꾸지 않은 쪽을 부른다.
      pressed = await page.evaluate(() => Performance.prototype.now.call(performance))
    },
    Infinity
  )
  await expect(cellGroups(page).nth(7)).toHaveClass(/selected/)
  await expectRevealed(page)
  // 앱은 포커스를 옮길 때마다 300ms 안에 끝나는 스크롤을 새로 시작한다. 700ms 에서 300ms 를 뺀 나머지는 프레임과
  // IPC 가 늦어질 몫으로 둔 여유다.
  expect(scrolls.at(-1)!.time - pressed).toBeLessThan(700)
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

test('columns 에서 사이드바로 고른 cell 만 선택 표시를 하고, 다른 cell 을 고르면 표시가 옮겨 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await toggleView(launched, 'columns')

  await cellItems(page).nth(0).click()
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
  await expect(cellViews(page).nth(1)).not.toHaveClass(/selected/)

  await cellItems(page).nth(1).click()
  await expect(cellViews(page).nth(1)).toHaveClass(/selected/)
  await expect(cellViews(page).nth(0)).not.toHaveClass(/selected/)
})

test('columns 에서 줌을 바꿔도 pane 은 80열이다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 80)

  const before = await page.evaluate(() => devicePixelRatio)
  await setZoom(app, 0.5)
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).not.toBe(before)
  await expectCols(page, 80)
})

test('DOM 으로 그려도 글꼴 크기 8 의 columns pane 은 80열이다', async ({ launch, dataDir }) => {
  writeConfig(dataDir, '[terminal]\nfont-size = 8\n')
  const launched = await launch()
  const { page } = launched
  await toggleView(launched, 'columns')
  await expectCols(page, 80)
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
