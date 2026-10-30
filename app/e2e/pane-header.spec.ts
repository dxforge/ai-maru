import { basename } from 'node:path'
import type { Page } from '@playwright/test'
import {
  activeHeader,
  canvasPanel,
  clickMenu,
  expect,
  focusPane,
  newWorkspace,
  paneHeader,
  panes,
  programStatus,
  putCanvas,
  resizeBy,
  run,
  setZoom,
  split,
  test,
  toggleView,
  typesInto,
  cellGroups,
  cellPlaces,
  cellViews,
  writeConfig,
  zshHome
} from './app'
import { ICONS } from '../src/renderer/src/icons'

function headerBelowPane(page: Page): Promise<{ gap: number; above: number }> {
  return page.evaluate(() => {
    const card = document.querySelector('.panes.selected')!
    const r = card.querySelector('.cell-header')!.getBoundingClientRect()
    const pane = card.querySelector('.pane-header')!.getBoundingClientRect()
    return { gap: card.getBoundingClientRect().bottom - r.bottom, above: r.top - pane.bottom }
  })
}

test('pane 헤더는 OSC 0·2 로 받은 제목을, 받기 전에는 셸 이름을 보이고, pane 의 디렉토리 이름을 보인다', async ({
  launch
}) => {
  const { page } = await launch()
  await expect(activeHeader(page).locator('.title')).toHaveText('bash')
  await expect(cellPlaces(page)).not.toHaveText('')
  await expect(activeHeader(page).locator('.cwd')).toHaveText(basename(process.env.HOME!))

  await page.keyboard.type("printf '\\033]2;task-%s\\007' $((1+1))\n")

  await expect(activeHeader(page).locator('.title')).toHaveText('task-2')
  await page.keyboard.type("printf '\\033]2;\\007'\n")
  await expect(activeHeader(page).locator('.title')).toHaveText('bash')
  await page.keyboard.type("printf '\\033]0;both-%s\\007' $((1+1))\n")
  await expect(activeHeader(page).locator('.title')).toHaveText('both-2')
})

test('pane 헤더는 도는 명령과 돈 시간을, 실패한 명령은 종료 코드를 보이고, 셸이 보낸 제목보다 명령을 먼저 쓴다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  const header = activeHeader(page)
  await expect(header.locator('.title')).toHaveText('zsh')

  await page.keyboard.type("printf '\\033]2;my-title\\007'; sleep 30\n")
  await expect(header.locator('.title')).toHaveText("printf '\\033]2;my-title\\007'; sleep 30")
  await expect(header).toHaveClass(/command-running/)
  await expect(header.locator('.row-bar-icon')).toHaveText(ICONS.running)
  await expect(header.locator('.command-tail')).toHaveText('<1m')
  await expect(header.locator('.cwd')).toHaveText(basename(home))

  await page.keyboard.press('Control+C')
  await expect(header.locator('.title')).toHaveText('my-title')
  await expect(header.locator('.command-tail')).toHaveCount(0)

  await page.keyboard.type('false\n')
  await expect(header.locator('.title')).toHaveText('false')
  await expect(header).toHaveClass(/command-failed/)
  await expect(header.locator('.row-bar-icon')).toHaveText(ICONS.error)
  await expect(header.locator('.command-tail')).toHaveText('1')

  await page.keyboard.type('true\n')
  await expect(header.locator('.title')).toHaveText('my-title')
  await expect(header.locator('.command-tail')).toHaveCount(0)
  await expect(header.locator('.row-bar-icon')).toHaveText(ICONS.terminal)
})

test('명령을 주어 띄운 pane 의 헤더는 명령 전체와 돈 시간을 보인다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(`maru pane new bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(2)
  const header = paneHeader(page, 1)
  await expect(header.locator('.title')).toHaveText('bash -c read x')
  await expect(header).toHaveClass(/command-running/)
  await expect(header.locator('.command-tail')).toHaveText('<1m')
})

test('앱이 뜰 때 그린 pane 헤더 아이콘도 함께 실은 Nerd Font 로 그린다', async ({ launch }) => {
  const { page } = await launch()
  await expect(activeHeader(page)).toBeVisible()

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.pane-header .row-bar-icon'
  })
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  expect(fonts.map((f) => f.familyName)).toEqual(['Symbols Nerd Font Mono'])
})

test('pane 헤더를 누르면 그 pane 이 포커스를 받고 키가 그리로 간다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)

  await paneHeader(page, 0).click()

  await typesInto(page, 0, 'header')
  await paneHeader(page, 1).click()
  await typesInto(page, 1, 'again')
})

test('columns 에서 고르지 않은 cell 의 pane 헤더를 누르면 그 cell 을 고르고 키가 그 pane 으로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await toggleView({ app, page }, 'columns')

  await cellViews(page).nth(0).locator('.pane-header').click()

  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)
  await typesInto(page, 0, 'other')
})

test('포커스를 옮기면 pane 헤더의 강조와 다른 pane 을 흐리게 덮는 층이 따라간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  const state = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.panes.selected .pane')].map((p) => [
        p.querySelector('.pane-header')!.classList.contains('focused'),
        getComputedStyle(p.querySelector('.body')!, '::after').content
      ])
    )
  await expect.poll(state).toEqual([
    [false, '""'],
    [true, 'none']
  ])

  await clickMenu(app, 'focus-pane-left')

  await expect.poll(state).toEqual([
    [true, 'none'],
    [false, '""']
  ])
})

test('columns 의 cell 헤더는 pane 상태 가운데 blocked, working 순으로 하나를 보이고, 없으면 비우며, 누르면 그 cell 을 고른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await toggleView({ app, page }, 'columns')
  const headers = page.locator('.cell-header')
  await expect(headers).toHaveCount(2)
  await expect(headers.nth(1).locator('.row-bar-icon svg')).toHaveCount(0)

  await page.keyboard.type(programStatus('working'))
  await expect(headers.nth(1)).toHaveClass(/working/)
  await split(app, page, 'split-down', 2)
  await page.keyboard.type(programStatus('blocked', 'kind=permission'))
  await expect(headers.nth(1)).toHaveClass(/blocked/)
  await expect(headers.nth(0)).not.toHaveClass(/working|blocked|done|error|idle/)
  await expect(headers.nth(0).locator('.row-bar-icon svg')).toHaveCount(0)

  await headers.nth(0).click()

  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)
  await run(page, 'echo first-$((1+1))', 'first-2')
})

test('single 보기에서도 선택된 cell 의 헤더만 이름·상태를 보이고, 카드 맨 아래 pane 헤더 아래에 놓이며, 사이드바를 접어도 남고, 눌러도 키 입력이 터미널에 남는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  const headers = page.locator('.cell-header')
  await expect(headers).toHaveCount(2)
  await expect(headers.nth(1)).toBeVisible()
  await expect(headers.nth(0)).toBeHidden()
  await expect(headers.nth(1)).toHaveClass(/focused/)
  await expect(headers.nth(1).locator('.name')).toHaveText(basename(process.env.HOME!))
  await expect(headers.nth(1).locator('.row-bar-icon svg')).toHaveCount(0)

  await page.keyboard.type(programStatus('working'))
  await expect(headers.nth(1)).toHaveClass(/working/)
  expect(await headerBelowPane(page)).toEqual({ gap: 0, above: 0 })

  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  await expect(headers.nth(1)).toBeVisible()

  await headers.nth(1).click()
  await run(page, 'echo keep-$((1+1))', 'keep-2')
})

test('columns 의 cell 헤더는 idle 만 있으면 pane 헤더와 같은 idle 아이콘을 보인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await toggleView({ app, page }, 'columns')
  await page.keyboard.type(programStatus('idle'))
  const cellIcon = page.locator('.cell-header .row-bar-icon')
  const paneIcon = activeHeader(page).locator('.row-bar-icon')
  await expect(page.locator('.cell-header')).toHaveClass(/idle/)
  await expect(activeHeader(page)).toHaveClass(/idle/)

  await expect(cellIcon.locator('svg')).toHaveAttribute('data-state', 'idle')
  await expect(paneIcon.locator('svg')).toHaveAttribute('data-state', 'idle')
})

test('pane 헤더와 columns 의 cell 헤더는 글자 위에서도 기본 커서를 보이고, Canvas 글자에서 헤더로 끌어도 헤더 글자는 선택되지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await toggleView({ app, page }, 'columns')
  await putCanvas(app, { id: 'a', kind: 'markdown', text: '# canvas-heading\n' })
  const heading = page.locator('.canvas .markdown h1')
  await expect(heading).toBeVisible()
  // 패널이 열리는 transition 동안 제목이 왼쪽으로 움직여, 잰 자리에서 누르면 다른 글자가 잡힌다.
  await expect.poll(() => canvasPanel(page).evaluate((el) => el.getAnimations().length)).toBe(0)
  for (const s of ['.pane-header .title', '.pane-header .cwd', '.cell-header .name']) {
    const text = page.locator(s)
    expect(await text.evaluate((e) => getComputedStyle(e).cursor)).toBe('default')

    // columns 뷰의 pane 은 보이는 폭보다 넓을 수 있으므로, 끝점을 화면 안에 두고 그 점의 요소가 헤더 안에 있는지 확인한다.
    await text.evaluate((e) => e.scrollIntoView({ inline: 'nearest' }))
    const box = (await text.boundingBox())!
    const end = { x: box.x + 8, y: box.y + box.height / 2 }
    expect(
      await page.evaluate(
        ({ s, end }) =>
          document.querySelector(s)!.contains(document.elementFromPoint(end.x, end.y)),
        { s, end }
      )
    ).toBe(true)
    // 제목을 처음부터 끝까지 고른 뒤 Canvas 안에서 헤더 높이까지 내려가 헤더 행을 따라 끈다. 터미널 위를 지나면 선택이
    // 풀리기 때문이다. 앞 반복의 선택이 남은 글자를 누르면 drag-and-drop 이 시작되므로 먼저 지운다.
    await page.evaluate(() => getSelection()!.removeAllRanges())
    const from = (await heading.boundingBox())!
    await page.mouse.move(from.x + 1, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width - 1, from.y + from.height / 2, { steps: 4 })
    await page.mouse.move(from.x + 1, end.y, { steps: 4 })
    await page.mouse.move(end.x, end.y, { steps: 10 })
    await page.mouse.up()

    // 사이드바도 같은 이름을 보여 주므로 선택된 글자만으로는 구별할 수 없다.
    // 그래서 선택의 anchor·focus 가 헤더 안에 있지 않은지 확인한다.
    const selection = await page.evaluate((s) => {
      const header = document.querySelector(s)!
      const sel = getSelection()!
      return {
        text: sel.toString(),
        inHeader: header.contains(sel.anchorNode) || header.contains(sel.focusNode)
      }
    }, s)
    expect(selection.text).toContain('canvas-heading')
    expect(selection.inHeader).toBe(false)
  }
})

async function measure(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.panes.selected .grid')!.getBoundingClientRect()
    // pane 경계가 맞추는 격자. DOM 의 행 높이는 행 수에 따라 반올림이 달라 1px 의 몇 % 씩 어긋난다.
    const vars = getComputedStyle(document.querySelector('.panes.selected')!)
    const cellWidth = parseFloat(vars.getPropertyValue('--cell'))
    const unit = parseFloat(vars.getPropertyValue('--row'))
    return [...document.querySelectorAll('.panes.selected .pane')].map((pane) => {
      const box = pane.getBoundingClientRect()
      const head = pane.querySelector('.pane-header')!.getBoundingClientRect()
      const row = pane.querySelector('.xterm-rows > div')!.getBoundingClientRect()
      const rows = pane.querySelector('.xterm-rows')!.children.length
      return {
        left: box.left - grid.left,
        right: box.right - grid.left,
        top: box.top - grid.top,
        bottom: box.bottom - grid.top,
        headTop: head.top - grid.top,
        headHeight: head.height,
        rows,
        firstRow: row.top - grid.top,
        rowHeight: row.height,
        unit,
        cellWidth,
        gridWidth: grid.width,
        gridHeight: grid.height
      }
    })
  })
}

/** 레이아웃이 px 를 1/64 단위로 반올림하므로, 글자 칸의 배수에서 벗어난 정도를 글자 칸에 대한 비율로 본다. */
const offGrid = (px: number, cell: number): number => Math.abs(px / cell - Math.round(px / cell))

function expectOnGrid(
  boxes: Awaited<ReturnType<typeof measure>>,
  header: 'bottom' | 'top' = 'bottom'
) {
  for (const b of boxes) {
    expect(b.headHeight).toBeCloseTo(b.rowHeight, 1)
    if (header === 'bottom') {
      expect(b.headTop).toBeCloseTo(b.bottom - b.rowHeight, 1)
      expect(b.firstRow).toBeCloseTo(b.top, 1)
    } else {
      expect(b.headTop).toBeCloseTo(b.top, 1)
      expect(b.firstRow).toBeCloseTo(b.top + b.rowHeight, 1)
    }
    expect(offGrid(b.top, b.unit)).toBeLessThan(0.01)
    expect(offGrid(b.left, b.cellWidth)).toBeLessThan(0.01)
  }
}

function expectRowsMatch(boxes: Awaited<ReturnType<typeof measure>>) {
  for (const b of boxes) expect(b.rows).toBe(Math.floor((b.bottom - b.top) / b.unit + 1e-6) - 1)
}

for (const header of ['bottom', 'top'] as const) {
  test(`헤더가 ${header === 'bottom' ? '아래' : '위'}일 때 pane 을 나누면 경계가 행·열 격자에 놓여 나란한 pane 의 행이 이어지고, 경계선은 좌우 pane 사이에만 자리를 차지하지 않고 긋는다`, async ({
    launch,
    dataDir
  }) => {
    if (header === 'top') writeConfig(dataDir, '[layout]\nheader = "top"\n')
    const { app, page } = await launch()
    await split(app, page, 'split-right', 2)
    await split(app, page, 'split-down', 3)

    const [left, topRight, bottomRight] = await measure(page)
    expectOnGrid([left, topRight, bottomRight], header)
    expect(topRight.left).toBeCloseTo(left.right, 1)
    expect(bottomRight.top).toBeCloseTo(topRight.bottom, 1)
    expect(topRight.right).toBeCloseTo(left.gridWidth, 1)
    expect(bottomRight.bottom).toBeCloseTo(left.gridHeight, 1)
    expect(left.bottom).toBeCloseTo(left.gridHeight, 1)
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('.panes.selected .pane')].map(
        (p) => getComputedStyle(p, '::before').content
      )
    )
    expect(lines).toEqual(['none', '""', '""'])
    await expect(async () => expectRowsMatch(await measure(page))).toPass()
  })
}

test('창 크기를 바꿔도 pane 경계는 행·열 격자에 놓인다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-down', 2)
  await clickMenu(app, 'focus-pane-up')
  await split(app, page, 'split-right', 3)
  const before = await measure(page)

  await resizeBy(app, -137, -91)

  await expect.poll(async () => (await measure(page))[0].gridWidth).not.toBe(before[0].gridWidth)
  expectOnGrid(await measure(page))
  await expect(panes(page)).toHaveCount(3)
})

test('사이드바나 Canvas 를 열고 닫아도 pane 경계는 행·열 격자에 놓인다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-down', 3)

  for (const id of ['toggle-sidebar', 'toggle-canvas'] as const) {
    const before = await measure(page)
    await clickMenu(app, id)
    await expect.poll(async () => (await measure(page))[0].gridWidth).not.toBe(before[0].gridWidth)
    expectOnGrid(await measure(page))
  }
})

test('pane 을 닫으면 남은 pane 이 다시 행·열 격자에 놓이고 행을 채운다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-down', 3)

  await clickMenu(app, 'close-pane')

  await expect(panes(page)).toHaveCount(2)
  await expect(async () => expectRowsMatch(await measure(page))).toPass()
  expectOnGrid(await measure(page))
})

for (const level of [1.5, 0.5, -0.5]) {
  test(`줌 ${level} 에서 행 높이가 소수이고 영역 높이가 행의 배수 근처여도, 모든 pane 이 격자에 놓이고 헤더를 뺀 높이를 행으로 채운다`, async ({
    launch
  }) => {
    const { app, page } = await launch()
    await setZoom(app, level)
    await split(app, page, 'split-right', 2)
    await split(app, page, 'split-down', 3)
    expect((await measure(page))[0].rowHeight % 1).not.toBe(0)

    for (const offset of [0, 0.25, 0.5, 0.75]) {
      const [box] = await measure(page)
      const target = (Math.floor(box.gridHeight / box.unit) + offset) * box.unit
      const factor = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
      )
      await resizeBy(app, 0, Math.round((target - box.gridHeight) * factor))
      await expect(async () => {
        const boxes = await measure(page)
        expectOnGrid(boxes)
        expectRowsMatch(boxes)
      }).toPass()
    }
  })
}

test('columns 에서 줌과 창 크기를 바꿔도 pane 경계는 행·열 격자에 놓인다', async ({ launch }) => {
  const { app, page } = await launch()
  await toggleView({ app, page }, 'columns')
  await split(app, page, 'split-down', 2)
  const dpr = await page.evaluate(() => devicePixelRatio)

  await setZoom(app, -0.5)

  await expect.poll(() => page.evaluate(() => devicePixelRatio)).not.toBe(dpr)
  await expect(async () => expectOnGrid(await measure(page))).toPass()
  const zoomed = await measure(page)
  await resizeBy(app, -137, -91)
  await expect.poll(async () => (await measure(page))[0].gridHeight).not.toBe(zoomed[0].gridHeight)
  await expect(async () => expectOnGrid(await measure(page))).toPass()
})

for (const header of ['bottom', 'top'] as const) {
  test(`columns 에서 위아래로 나눈 위 pane 에 포커스가 가도 pane 헤더는 pane 맨 ${header === 'bottom' ? '아래' : '위'}에 있다`, async ({
    launch,
    dataDir
  }) => {
    if (header === 'top') writeConfig(dataDir, '[layout]\nheader = "top"\n')
    const { app, page } = await launch()
    await toggleView({ app, page }, 'columns')
    await split(app, page, 'split-down', 2)
    await focusPane(app, page, 'focus-pane-up', 0)

    for (const b of await measure(page))
      expect(
        header === 'bottom' ? b.bottom - b.headTop - b.headHeight : b.headTop - b.top
      ).toBeCloseTo(0, 1)
  })
}

test('pane 헤더는 기본으로 pane 맨 아래에 있고 본문은 헤더 위에서 끝나며, 위아래로 나누면 위 pane 의 헤더가 경계가 된다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-down', 2)
  const [top, bottom] = await measure(page)
  expectOnGrid([top, bottom])
  expect(top.headTop + top.headHeight).toBeCloseTo(bottom.top, 1)

  const covered = await page.evaluate(() => {
    const pane = document.querySelector('.panes.selected .pane')!
    const head = pane.querySelector('.pane-header')!
    const body = pane.querySelector('.body')!.getBoundingClientRect()
    const r = head.getBoundingClientRect()
    return {
      overlap: body.bottom - r.top,
      hit: head.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    }
  })
  expect(covered.overlap).toBeCloseTo(0, 1)
  expect(covered.hit).toBe(true)
})

test('columns 의 cell 헤더는 기본으로 카드 맨 아래, pane 헤더 아래에 놓인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await toggleView({ app, page }, 'columns')
  await expect(page.locator('.cell-header')).toHaveCount(1)
  expect(await headerBelowPane(page)).toEqual({ gap: 0, above: 0 })
})

test('헤더가 위면 columns 의 cell 헤더는 카드 맨 위, pane 헤더 위에 놓인다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[layout]\nheader = "top"\n')
  const { app, page } = await launch()
  await toggleView({ app, page }, 'columns')
  const header = page.locator('.cell-header')
  await expect(header).toHaveCount(1)

  const layout = await page.evaluate(() => {
    const card = document.querySelector('.panes.selected')!.getBoundingClientRect()
    const r = document.querySelector('.cell-header')!.getBoundingClientRect()
    const pane = document.querySelector('.pane-header')!.getBoundingClientRect()
    return { gap: r.top - card.top, below: pane.top - r.bottom }
  })
  expect(layout).toEqual({ gap: 0, below: 0 })
})
