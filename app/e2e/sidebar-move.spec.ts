import type { Locator, Page } from '@playwright/test'
import {
  cellViews,
  clickMenu,
  collapseSidebar,
  expect,
  grabHandle,
  newCell,
  newWorkspace,
  recordPtys,
  resizeBy,
  restartWith,
  rows,
  run,
  screenshotPixels,
  test,
  toggleView,
  workspaceHeads,
  type Launched
} from './app'

/** 사이드바 목록의 cell 카드다. 끄는 동안 붙는 사본(`.ghost`)은 `.list` 밖에 있어 세지 않는다. */
const cards = (page: Page) => page.locator('.sidebar .list .group')
const grip = (page: Page, i: number) => cards(page).nth(i).locator('.grip')
const opacity = (el: Locator) => el.evaluate((e) => Number(getComputedStyle(e).opacity))
const hovered = (el: Locator) => el.evaluate((e) => e.matches(':hover'))
const ghost = (page: Page) => page.locator('.sidebar .ghost')
const line = (page: Page) => page.locator('.sidebar .drop-line')
const slot = (page: Page) => page.locator('.sidebar .new-workspace')
const list = (page: Page) => page.locator('.sidebar .list')

function shape(page: Page): Promise<string[][]> {
  return page
    .locator('.sidebar .list > .workspace')
    .evaluateAll((ws) =>
      ws.map((w) =>
        Array.from(
          w.querySelectorAll(':scope > .group > .pane-row:first-of-type .title'),
          (t) => t.textContent!
        )
      )
    )
}

async function title(page: Page, name: string): Promise<void> {
  await run(page, `printf '\\033]2;%s\\007' ${name}; echo titled-$((1+1))`, 'titled-2')
  await page.keyboard.type('clear\n')
}

/** 마지막에 연 cell 이 선택된다. */
async function arrange(launched: Launched, layout: string[][]): Promise<void> {
  const { page } = launched
  let count = 0
  for (const [wi, names] of layout.entries()) {
    for (const [ci, name] of names.entries()) {
      count++
      if (count > 1) await (ci === 0 && wi > 0 ? newWorkspace : newCell)(launched, count)
      await title(page, name)
    }
  }
  await expect.poll(() => shape(page)).toEqual(layout)
}

async function moveTo(page: Page, target: Locator, frac: number): Promise<void> {
  const b = (await target.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * frac, { steps: 6 })
}

test('손잡이로 cell 을 끌어 같은 workspace 의 다른 자리에 놓으면 사이드바·columns·Next Cell 이 그 순서를 따르고, 터미널은 다시 열리지 않고 내용과 키 입력이 남는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await arrange(launched, [['alpha', 'bravo', 'charlie']])
  await cards(page).nth(0).locator('.pane-row').click()
  await run(page, 'echo kept-$((1+1))', 'kept-2')
  await cards(page).nth(2).locator('.pane-row').click()
  const events = await recordPtys(app)

  await grabHandle(page, grip(page, 2), 0)
  await moveTo(page, cards(page).nth(0), 0.25)
  await expect(cards(page).nth(2)).toHaveClass(/dragging/)
  await expect(grip(page, 2)).toHaveCSS('opacity', '0')
  await expect(ghost(page)).toHaveCount(1)
  await expect(line(page)).toBeVisible()
  await page.mouse.up()

  await expect.poll(() => shape(page)).toEqual([['charlie', 'alpha', 'bravo']])
  await expect(ghost(page)).toHaveCount(0)
  await expect(line(page)).toHaveCount(0)
  await expect(cards(page).nth(0)).toHaveClass(/selected/)
  await expect(cellViews(page).nth(0).locator('.pane-header')).toContainText('charlie')
  await expect(cellViews(page).nth(1).locator('.pane-header')).toContainText('alpha')
  await expect(cellViews(page).nth(1).locator('.xterm-rows')).toContainText('kept-2')
  await run(page, 'echo typed-$((1+1))', 'typed-2')
  await expect(cellViews(page).nth(0).locator('.xterm-rows')).toContainText('typed-2')
  expect(await events()).toEqual({ opens: [], kills: [] })

  await clickMenu(app, 'next-cell')
  await expect(cards(page).nth(1)).toHaveClass(/selected/)
})

test('cell 을 다른 workspace 의 cell 사이에 놓으면 그리로 옮기고, 마지막 cell 이 빠진 workspace 는 닫는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha'], ['bravo', 'charlie']])

  await grabHandle(page, grip(page, 0), 0)
  await moveTo(page, cards(page).nth(2), 0.25)
  await page.mouse.up()

  await expect.poll(() => shape(page)).toEqual([['bravo', 'alpha', 'charlie']])
  await expect(workspaceHeads(page)).toHaveCount(1)
  await expect(cards(page).nth(2)).toHaveClass(/selected/)
  await run(page, 'echo typed-$((1+1))', 'typed-2')
})

test('끄는 동안에만 목록 끝에 New Workspace 칸이 보이고, 거기 놓으면 그 cell 하나로 된 workspace 를 목록 끝에 만든다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha', 'bravo'], ['charlie']])
  await expect(slot(page)).toHaveCount(0)

  await grabHandle(page, grip(page, 0), 0)
  await expect(slot(page)).toBeVisible()
  await moveTo(page, slot(page), 0.5)
  await expect(slot(page)).toHaveClass(/target/)
  await expect(line(page)).toHaveCount(0)
  await page.mouse.up()

  await expect.poll(() => shape(page)).toEqual([['bravo'], ['charlie'], ['alpha']])
  await expect(slot(page)).toHaveCount(0)
})

test('workspace 이름 줄을 4px 넘게 끌면 workspace 를 옮기고 접지 않으며, 그보다 덜 움직이고 떼면 접는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha'], ['bravo'], ['charlie']])

  await grabHandle(page, workspaceHeads(page).nth(2), 0)
  await moveTo(page, workspaceHeads(page).nth(0), 0.25)
  await expect(page.locator('.sidebar .list > .workspace').nth(2)).toHaveClass(/dragging/)
  await expect(line(page)).toBeVisible()
  await expect(slot(page)).toHaveCount(0)
  await page.mouse.up()

  await expect.poll(() => shape(page)).toEqual([['charlie'], ['alpha'], ['bravo']])
  await run(page, 'echo typed-$((1+1))', 'typed-2')
  for (const i of [0, 1, 2])
    await expect(workspaceHeads(page).nth(i)).toHaveAttribute('aria-expanded', 'true')

  const head = workspaceHeads(page).nth(0)
  await grabHandle(page, head, 0)
  const b = (await head.boundingBox())!
  await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 2)
  await page.mouse.up()
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  await expect(ghost(page)).toHaveCount(0)
})

test('Esc 를 누르면 끌기를 그만두어 순서가 그대로이고, 그 Esc 는 터미널에 가지 않으며 뗀 뒤 접지도 않는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha', 'bravo'], ['charlie']])
  await page.keyboard.type('cat -v\n')

  await grabHandle(page, grip(page, 0), 0)
  await moveTo(page, cards(page).nth(1), 0.75)
  await expect(line(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ghost(page)).toHaveCount(0)
  await expect(line(page)).toHaveCount(0)
  await expect(slot(page)).toHaveCount(0)
  await page.mouse.up()
  await expect.poll(() => shape(page)).toEqual([['alpha', 'bravo'], ['charlie']])

  await grabHandle(page, workspaceHeads(page).nth(1), 0)
  await moveTo(page, workspaceHeads(page).nth(0), 0.25)
  await expect(line(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(workspaceHeads(page).nth(1)).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => shape(page)).toEqual([['alpha', 'bravo'], ['charlie']])

  await page.keyboard.type('z-$((1+1))\n')
  await expect(rows(page)).toContainText('z-$((1+1))')
  await expect(rows(page)).not.toContainText('^[')
  await page.keyboard.press('Control+C')
})

test('포인터가 사이드바 밖에 있을 때 떼면 끌기를 그만두어 cell 도 workspace 도 옮기지 않는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha', 'bravo'], ['charlie']])
  const sidebar = (await page.locator('.sidebar').boundingBox())!
  const outside = async (target: Locator): Promise<void> => {
    const b = (await target.boundingBox())!
    await page.mouse.move(sidebar.x + sidebar.width + 120, b.y + b.height * 0.25, { steps: 6 })
  }

  await grabHandle(page, grip(page, 2), 0)
  await moveTo(page, cards(page).nth(0), 0.25)
  await expect(line(page)).toBeVisible()
  await outside(cards(page).nth(0))
  await expect(ghost(page)).toHaveCount(1)
  await expect(line(page)).toHaveCount(0)
  await moveTo(page, cards(page).nth(0), 0.25)
  await expect(line(page)).toBeVisible()
  await outside(cards(page).nth(0))
  await expect(line(page)).toHaveCount(0)
  await page.mouse.up()
  await expect(ghost(page)).toHaveCount(0)
  await expect(slot(page)).toHaveCount(0)
  await expect.poll(() => shape(page)).toEqual([['alpha', 'bravo'], ['charlie']])

  await grabHandle(page, workspaceHeads(page).nth(1), 0)
  await moveTo(page, workspaceHeads(page).nth(0), 0.25)
  await expect(line(page)).toBeVisible()
  await outside(workspaceHeads(page).nth(0))
  await expect(line(page)).toHaveCount(0)
  await page.mouse.up()
  await expect(ghost(page)).toHaveCount(0)
  await expect(workspaceHeads(page).nth(1)).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => shape(page)).toEqual([['alpha', 'bravo'], ['charlie']])
})

test('접힌 workspace 의 이름 줄에 놓으면 그 workspace 의 끝에 넣는다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha', 'bravo'], ['charlie']])
  await workspaceHeads(page).nth(0).click()
  await expect(cards(page)).toHaveCount(1)

  await grabHandle(page, grip(page, 0), 0)
  await moveTo(page, workspaceHeads(page).nth(0), 0.5)
  await expect(line(page)).toBeVisible()
  await page.mouse.up()

  await expect(workspaceHeads(page)).toHaveCount(1)
  await expect(workspaceHeads(page).nth(0)).toHaveAttribute('aria-expanded', 'false')
  await workspaceHeads(page).nth(0).click()
  await expect.poll(() => shape(page)).toEqual([['alpha', 'bravo', 'charlie']])
})

test('끄는 동안 포인터가 목록의 아래·위 끝 가까이 오면 그쪽으로 목록을 굴린다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await resizeBy(app, 0, -450)
  for (let n = 2; n <= 8; n++) await newWorkspace(launched, n)
  const scroll = (): Promise<number> => list(page).evaluate((el) => el.scrollTop)
  const max = await list(page).evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(max).toBeGreaterThan(0)
  await list(page).evaluate((el) => el.scrollTo(0, 0))

  await grabHandle(page, grip(page, 0), 0)
  const box = (await list(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4, { steps: 4 })
  // 끄는 동안 목록 끝에 New Workspace 칸이 붙으므로 스크롤할 수 있는 길이가 그만큼 늘어난다.
  await expect.poll(scroll).toBeGreaterThan(max)
  await page.mouse.move(box.x + box.width / 2, box.y + 4, { steps: 4 })
  await expect.poll(scroll).toBe(0)
  await page.keyboard.press('Escape')
  await page.mouse.up()
})

test('pane 줄을 끌어도 아무것도 옮기지 않고, 손잡이는 마우스를 올린 cell 에만 흐리게 보이다가 손잡이에 올리면 진해지며 창을 끄는 영역이 아니다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha', 'bravo']])

  await grabHandle(page, cards(page).nth(0).locator('.pane-row'), 0)
  await moveTo(page, cards(page).nth(1), 0.75)
  await expect(ghost(page)).toHaveCount(0)
  await expect(line(page)).toHaveCount(0)
  await page.mouse.up()
  await expect.poll(() => shape(page)).toEqual([['alpha', 'bravo']])

  await cards(page).nth(1).hover()
  await expect.poll(() => opacity(grip(page, 1))).toBeGreaterThan(0)
  await expect(grip(page, 0)).toHaveCSS('opacity', '0')
  const faint = await opacity(grip(page, 1))
  await grip(page, 1).hover()
  await expect.poll(() => opacity(grip(page, 1))).toBeGreaterThan(faint)
  expect(
    await grip(page, 0).evaluate((el) =>
      getComputedStyle(el).getPropertyValue('-webkit-app-region')
    )
  ).toBe('no-drag')
})

test('마우스를 첫 행에서 손잡이 위로 옮겨도 첫 행은 hover 배경을 지키고, 고른 pane 의 행은 선택 배경을 지킨다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha', 'bravo']])
  const background = (i: number) =>
    cards(page)
      .nth(i)
      .locator('.pane-row')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)

  const handle = (await grip(page, 0).boundingBox())!
  await page.mouse.move(handle.x + handle.width + 4, handle.y + handle.height / 2)
  const hoverBackground = await background(0)
  const focused = await background(1)
  await cards(page).nth(1).locator('.pane-row').hover()
  expect(await background(0)).not.toBe(hoverBackground)

  await page.mouse.move(handle.x + handle.width + 4, handle.y + handle.height / 2)
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2, { steps: 4 })
  await expect.poll(() => hovered(grip(page, 0))).toBe(true)
  expect(await background(0)).toBe(hoverBackground)

  await grip(page, 1).hover()
  await expect.poll(() => hovered(grip(page, 1))).toBe(true)
  expect(await background(1)).toBe(focused)
})

async function dotSizes(page: Page, i: number): Promise<string[]> {
  await grip(page, i).evaluate((el) => ((el as HTMLElement).style.opacity = '1'))
  const b = (await grip(page, i).boundingBox())!
  // 손잡이 아래쪽에는 첫 행 제목의 글자가 걸리므로, 위쪽 여백과 점을 그리는 `::before` 의 높이까지만 찍는다.
  const dots = await grip(page, i).evaluate(
    (el) =>
      parseFloat(getComputedStyle(el).paddingTop) +
      parseFloat(getComputedStyle(el, '::before').height)
  )
  const clip = {
    x: Math.floor(b.x),
    y: Math.floor(b.y),
    width: Math.ceil(b.width) + 1,
    height: dots
  }
  const { data, width, height } = await screenshotPixels(page, clip, 'css')
  const ink = (x: number, y: number) => data[(y * width + x) * 4] > data[0] + 60
  const seen = new Set<number>()
  const sizes: string[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (seen.has(y * width + x) || !ink(x, y)) continue
      const box = { x0: x, x1: x, y0: y, y1: y }
      const todo = [[x, y]]
      seen.add(y * width + x)
      while (todo.length) {
        const [px, py] = todo.pop()!
        box.x0 = Math.min(box.x0, px)
        box.x1 = Math.max(box.x1, px)
        box.y0 = Math.min(box.y0, py)
        box.y1 = Math.max(box.y1, py)
        for (const [nx, ny] of [
          [px + 1, py],
          [px - 1, py],
          [px, py + 1],
          [px, py - 1]
        ])
          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < width &&
            ny < height &&
            !seen.has(ny * width + nx) &&
            ink(nx, ny)
          ) {
            seen.add(ny * width + nx)
            todo.push([nx, ny])
          }
      }
      sizes.push(`${box.x1 - box.x0 + 1}x${box.y1 - box.y0 + 1}`)
    }
  return sizes
}

test('1x 화면에서 손잡이의 점은 펼친 사이드바와 접은 사이드바 모두 같은 크기의 정사각형으로 찍힌다', async ({
  launch
}) => {
  const launched = await launch(undefined, undefined, ['--force-device-scale-factor=1'])
  const { app, page } = launched
  await arrange(launched, [['alpha', 'bravo']])
  expect(await page.evaluate(() => devicePixelRatio)).toBe(1)

  const expanded = await dotSizes(page, 1)
  await collapseSidebar(app, page)
  const collapsed = await dotSizes(page, 1)

  expect(expanded.length).toBeGreaterThan(0)
  expect(collapsed).toEqual(expanded)
  const [size, ...others] = new Set(expanded)
  expect(others).toEqual([])
  const [w, h] = size.split('x')
  expect(w).toBe(h)
})

test('첫 행의 위쪽이라도 손잡이 밖을 누르면 cell 을 끌지 않고 그 pane 을 고른다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha', 'bravo']])
  await expect(cards(page).nth(1)).toHaveClass(/selected/)

  const handle = (await grip(page, 0).boundingBox())!
  const beside: [number, number] = [handle.x + handle.width + 4, handle.y + handle.height / 2]
  const below: [number, number] = [handle.x + handle.width / 2, handle.y + handle.height + 4]
  for (const [x, y] of [beside, below]) {
    await cards(page).nth(1).locator('.pane-row').click()
    await expect(cards(page).nth(1)).toHaveClass(/selected/)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 10, y, { steps: 4 })
    await expect(ghost(page)).toHaveCount(0)
    await page.mouse.up()
    await expect(cards(page).nth(0)).toHaveClass(/selected/)
  }
  await expect.poll(() => shape(page)).toEqual([['alpha', 'bravo']])
})

test('끄는 동안 같은 workspace 의 다른 cell 이 닫힌 뒤 놓아도 끌던 cell 과 그 터미널이 남는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha', 'bravo']])

  await grabHandle(page, grip(page, 0), 0)
  await moveTo(page, cards(page).nth(1), 0.75)
  await expect(line(page)).toBeVisible()
  await page.keyboard.type('exit\n')
  await expect(cards(page)).toHaveCount(1)
  await page.mouse.up()

  await expect.poll(() => shape(page)).toEqual([['alpha']])
  await expect(cellViews(page)).toHaveCount(1)
  await run(page, 'echo alive-$((1+1))', 'alive-2')
})

test('workspace 이름 줄을 마지막 workspace 아래로 끌면 목록 끝으로 옮긴다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await arrange(launched, [['alpha'], ['bravo'], ['charlie']])

  await grabHandle(page, workspaceHeads(page).nth(0), 0)
  await moveTo(page, page.locator('.sidebar .list > .workspace').nth(2), 0.9)
  await page.mouse.up()

  await expect.poll(() => shape(page)).toEqual([['bravo'], ['charlie'], ['alpha']])
})

test('접은 사이드바에서도 손잡이로 cell 을 끌어 옮긴다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await arrange(launched, [['alpha', 'bravo']])
  await collapseSidebar(app, page)
  const side = (await page.locator('.sidebar').boundingBox())!
  const handle = (await grip(page, 1).boundingBox())!
  expect(Math.abs(handle.x + handle.width / 2 - (side.x + side.width / 2))).toBeLessThanOrEqual(1)
  await cards(page).nth(1).hover()
  await expect.poll(() => opacity(grip(page, 1))).toBeGreaterThan(0)

  await grabHandle(page, grip(page, 1), 0)
  await moveTo(page, cards(page).nth(0), 0.25)
  await page.mouse.up()

  await expect.poll(() => shape(page)).toEqual([['bravo', 'alpha']])
})

test('옮긴 workspace·cell 의 순서는 재시작한 뒤에도 남는다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await arrange(launched, [['alpha'], ['bravo', 'charlie']])
  await grabHandle(page, grip(page, 2), 0)
  await moveTo(page, cards(page).nth(0), 0.25)
  await page.mouse.up()
  await grabHandle(page, workspaceHeads(page).nth(1), 0)
  await moveTo(page, workspaceHeads(page).nth(0), 0.25)
  await page.mouse.up()
  const moved = [['bravo'], ['charlie', 'alpha']]
  await expect.poll(() => shape(page)).toEqual(moved)

  await restartWith(app)
  const { page: again } = await launch()
  await expect.poll(() => shape(again)).toEqual(moved)
})
