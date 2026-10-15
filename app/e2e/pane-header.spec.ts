import type { Page } from '@playwright/test'
import {
  activeHeader,
  claudeHook,
  clickMenu,
  expect,
  newWorkspace,
  paneHeader,
  panes,
  resizeBy,
  run,
  setZoom,
  split,
  test,
  toggleView,
  typesInto,
  workspaceItems,
  workspaceViews
} from './app'

test('칸 머리는 OSC 0·2 로 받은 제목을, 받기 전에는 Shell 을 보이고, 칸의 디렉토리 이름을 보인다', async ({
  launch
}) => {
  const { page } = await launch()
  await expect(activeHeader(page).locator('.title')).toHaveText('Shell')
  await expect(workspaceItems(page)).not.toHaveText('Shell')
  await expect(activeHeader(page).locator('.cwd')).toHaveText(
    await workspaceItems(page).innerText()
  )

  await page.keyboard.type("printf '\\033]2;task-%s\\007' $((1+1))\n")

  await expect(activeHeader(page).locator('.title')).toHaveText('task-2')
  await page.keyboard.type("printf '\\033]2;\\007'\n")
  await expect(activeHeader(page).locator('.title')).toHaveText('Shell')
  await page.keyboard.type("printf '\\033]0;both-%s\\007' $((1+1))\n")
  await expect(activeHeader(page).locator('.title')).toHaveText('both-2')
})

test('칸 머리를 누르면 그 칸이 포커스를 받고 키가 그리로 간다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)

  await paneHeader(page, 0).click()

  await typesInto(page, 0, 'header')
  await paneHeader(page, 1).click()
  await typesInto(page, 1, 'again')
})

test('columns 에서 고르지 않은 workspace 의 칸 머리를 누르면 그 workspace 를 고르고 키가 그 칸으로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await toggleView({ app, page }, 'columns')

  await workspaceViews(page).nth(0).locator('.pane-header').click()

  await expect(workspaceItems(page).nth(0)).toHaveClass(/selected/)
  await typesInto(page, 0, 'other')
})

test('포커스를 옮기면 칸 머리의 강조와 다른 칸을 흐리게 덮는 층이 따라간다', async ({ launch }) => {
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

test('columns 의 workspace 머리는 칸 상태 가운데 waiting, working 순으로 하나를 보이고, 없으면 비우며, 누르면 그 workspace 를 고른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await toggleView({ app, page }, 'columns')
  const headers = page.locator('.workspace-header')
  await expect(headers).toHaveCount(2)
  await expect(headers.nth(1).locator('.row-bar-icon')).toHaveText('')

  await page.keyboard.type(claudeHook('UserPromptSubmit', 'c-1'))
  await expect(headers.nth(1)).toHaveClass(/working/)
  await split(app, page, 'split-down', 2)
  await page.keyboard.type(claudeHook('PermissionRequest', 'c-2'))
  await expect(headers.nth(1)).toHaveClass(/waiting/)
  await expect(headers.nth(0)).not.toHaveClass(/working|waiting|idle/)
  await expect(headers.nth(0).locator('.row-bar-icon')).toHaveText('')

  await headers.nth(0).click()

  await expect(workspaceItems(page).nth(0)).toHaveClass(/selected/)
  await run(page, 'echo first-$((1+1))', 'first-2')
})

test('columns 의 workspace 머리는 idle 만 있으면 칸 머리와 같은 idle 아이콘을 같은 크기로 보인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await toggleView({ app, page }, 'columns')
  await page.keyboard.type(claudeHook('Stop'))
  const workspaceIcon = page.locator('.workspace-header .row-bar-icon')
  const paneIcon = activeHeader(page).locator('.row-bar-icon')
  await expect(page.locator('.workspace-header')).toHaveClass(/idle/)
  await expect(activeHeader(page)).toHaveClass(/idle/)

  await expect(workspaceIcon).toHaveText(await paneIcon.innerText())
  expect(await workspaceIcon.evaluate((e) => getComputedStyle(e).fontSize)).toBe(
    await paneIcon.evaluate((e) => getComputedStyle(e).fontSize)
  )
})

test('Canvas 패널 머리에는 칸 머리의 모양이 걸리지 않는다', async ({ launch }) => {
  const { app, page } = await launch()
  await clickMenu(app, 'toggle-canvas')
  const header = page.locator('.canvas header')
  await expect(header).toBeVisible()

  const head = (await header.boundingBox())!
  const close = (await header.locator('.close').boundingBox())!
  expect(close.y).toBeGreaterThanOrEqual(head.y)
  expect(close.y + close.height).toBeLessThanOrEqual(head.y + head.height)
  expect(await header.evaluate((h) => getComputedStyle(h).fontFamily)).not.toContain(
    'Symbols Nerd Font Mono'
  )
})

test('명령 팔레트와 Canvas 패널은 앱 테마 색을 쓴다', async ({ launch }) => {
  const { app, page } = await launch()
  await clickMenu(app, 'toggle-canvas')
  await clickMenu(app, 'command-palette')
  await expect(page.locator('.palette')).toBeVisible()

  const colors = await page.evaluate(() => {
    const token = (name: string) => {
      const probe = document.createElement('div')
      probe.style.color = `var(${name})`
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const css = (s: string) => getComputedStyle(document.querySelector(s)!)
    return {
      palette: [css('.palette').backgroundColor, css('.palette').borderTopColor],
      canvas: [css('.canvas').color, css('.canvas').borderLeftColor],
      tokens: [token('--raised'), token('--line'), token('--fg')]
    }
  })
  const [raised, line, fg] = colors.tokens
  expect(colors.palette).toEqual([raised, line])
  expect(colors.canvas).toEqual([fg, line])
})

test('터미널 스크롤바는 칸 폭에서 8px 를 차지하고, 막대는 그 안쪽에 그린다', async ({ launch }) => {
  const { page } = await launch()
  const [width, clip] = await page.evaluate(() => {
    const bar = document.querySelector('.terminal-view.active .xterm-scrollbar.xterm-vertical')!
    return [
      bar.getBoundingClientRect().width,
      getComputedStyle(bar.querySelector('.xterm-slider')!).backgroundClip
    ]
  })
  expect(width).toBe(8)
  expect(clip).toBe('padding-box')
})

test('터미널 왼쪽 여백도 터미널 배경으로 칠한다', async ({ launch }) => {
  const { page } = await launch()
  const [viewport, xterm, scrollable] = await page.evaluate(() =>
    ['.xterm-viewport', '.xterm', '.xterm-scrollable-element'].map(
      (s) => getComputedStyle(document.querySelector(s)!).backgroundColor
    )
  )
  expect(viewport).toBe('rgba(0, 0, 0, 0)')
  expect(xterm).toBe(scrollable)
})

test('칸 머리의 아이콘 글꼴을 불러온다', async ({ launch }) => {
  const { page } = await launch()
  const status = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].find((f) => f.family.includes('Symbols Nerd Font Mono'))?.status
  })
  expect(status).toBe('loaded')
})

async function measure(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.panes.selected .grid')!.getBoundingClientRect()
    // 칸 경계가 맞추는 격자. DOM 의 행 높이는 행 수에 따라 반올림이 달라 1px 의 몇 % 씩 어긋난다.
    const vars = getComputedStyle(document.querySelector('.app')!)
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

/** 레이아웃이 px 를 1/64 단위로 반올림하므로, 셀의 배수에서 벗어난 정도를 셀에 대한 비율로 본다. */
const offGrid = (px: number, cell: number): number => Math.abs(px / cell - Math.round(px / cell))

function expectOnGrid(boxes: Awaited<ReturnType<typeof measure>>) {
  for (const b of boxes) {
    expect(b.headHeight).toBeCloseTo(b.rowHeight, 1)
    expect(b.firstRow).toBeCloseTo(b.top + b.rowHeight, 1)
    expect(offGrid(b.top, b.unit)).toBeLessThan(0.01)
    expect(offGrid(b.left, b.cellWidth)).toBeLessThan(0.01)
  }
}

function expectRowsMatch(boxes: Awaited<ReturnType<typeof measure>>) {
  for (const b of boxes) expect(b.rows).toBe(Math.floor((b.bottom - b.top) / b.unit + 1e-6) - 1)
}

test('칸을 나누면 경계가 행·열 격자에 놓여 나란한 칸의 행이 이어지고, 경계선은 좌우 칸 사이에만 자리를 차지하지 않고 긋는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-down', 3)

  const [left, topRight, bottomRight] = await measure(page)
  expectOnGrid([left, topRight, bottomRight])
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

test('창 크기를 바꿔도 칸 경계는 행·열 격자에 놓인다', async ({ launch }) => {
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

test('사이드바나 Canvas 를 열고 닫아도 칸 경계는 행·열 격자에 놓인다', async ({ launch }) => {
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

test('칸을 닫으면 남은 칸이 다시 행·열 격자에 놓이고 행을 채운다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-down', 3)

  await clickMenu(app, 'close-pane')

  await expect(panes(page)).toHaveCount(2)
  await expect(async () => expectRowsMatch(await measure(page))).toPass()
  expectOnGrid(await measure(page))
})

for (const level of [1, 0.5, -0.5]) {
  test(`줌 ${level} 에서 행 높이가 소수이고 영역 높이가 행의 배수 근처여도, 모든 칸이 격자에 놓이고 머리를 뺀 높이를 행으로 채운다`, async ({
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

test('포커스 없는 칸의 스크롤바도 흐리게 덮는다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await run(page, 'seq 1 300', '300')
  const sliderRect = () =>
    page.evaluate(() => {
      const track = document
        .querySelectorAll('.panes.selected .pane')[1]
        .querySelector('.xterm-vertical')!
      const r = track.querySelector('.xterm-slider')!.getBoundingClientRect()
      return {
        x: Math.floor(r.left + r.width / 2),
        y: Math.floor(r.top + r.height / 2),
        shrunk: r.height < track.getBoundingClientRect().height
      }
    })
  // 출력이 뜬 직후에는 스크롤바가 아직 갱신되지 않아 슬라이더가 트랙 전체를 차지한다.
  await expect.poll(async () => (await sliderRect()).shrunk).toBe(true)
  const slider = await sliderRect()
  const background = await pixel(page, slider.x - 40, slider.y)
  const hovered = async () => {
    await page.mouse.move(slider.x - 40, slider.y)
    await page.mouse.move(slider.x, slider.y)
    await expect.poll(() => pixel(page, slider.x, slider.y)).not.toEqual(background)
    return pixel(page, slider.x, slider.y)
  }
  const focused = await hovered()

  await clickMenu(app, 'focus-pane-left')
  await expect(paneHeader(page, 1)).not.toHaveClass(/focused/)

  await expect.poll(async () => (await hovered())[0]).toBeLessThan(focused[0])
})

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }, png.toString('base64'))
}

test('columns 에서 줌과 창 크기를 바꿔도 칸 경계는 행·열 격자에 놓인다', async ({ launch }) => {
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

test('columns 에서 위아래로 나눈 위 칸에 포커스가 가도 칸 머리는 칸 맨 위에 있다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await toggleView({ app, page }, 'columns')
  await split(app, page, 'split-down', 2)
  await clickMenu(app, 'focus-pane-up')
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)

  const offsets = await page.evaluate(() =>
    [...document.querySelectorAll('.panes.selected .pane')].map(
      (p) =>
        p.querySelector('.pane-header')!.getBoundingClientRect().top - p.getBoundingClientRect().top
    )
  )
  expect(offsets).toEqual([0, 0])
})

test('칸 머리는 터미널과 같은 글꼴·크기로 쓰고, columns 의 workspace 머리는 굵게 쓰며 한 행 안쪽에 밑줄을 긋는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await toggleView({ app, page }, 'columns')
  await expect(page.locator('.workspace-header')).toHaveCount(1)

  const style = await page.evaluate(() => {
    const css = (s: string) => getComputedStyle(document.querySelector(s)!)
    const [terminal, title, name, header] = [
      css('.xterm-rows'),
      css('.pane-header .title'),
      css('.workspace-header .name'),
      css('.workspace-header')
    ]
    return {
      terminal: [terminal.fontFamily, terminal.fontSize],
      title: [title.fontFamily, title.fontSize],
      name: [name.fontFamily, name.fontSize, name.fontWeight],
      underline: header.boxShadow,
      headerHeight: document.querySelector('.workspace-header')!.getBoundingClientRect().height,
      paneHeaderHeight: document.querySelector('.pane-header')!.getBoundingClientRect().height
    }
  })
  expect(style.title).toEqual(style.terminal)
  expect(style.name).toEqual([...style.terminal, '700'])
  expect(style.underline).toContain('inset')
  expect(style.headerHeight).toBe(style.paneHeaderHeight)
})
