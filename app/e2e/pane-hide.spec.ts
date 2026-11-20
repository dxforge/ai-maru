import {
  activePane,
  cellGroups,
  clickMenu,
  cli,
  expect,
  focusPane,
  paneBox,
  panes,
  restartWith,
  screen,
  settled,
  split,
  test,
  toggleView,
  typesInto
} from './app'

test('Hide Pane 으로 숨긴 pane 은 화면에서 빠져도 pty 가 돌고 사이드바 줄에 숨김 표시가 붙으며, 그 줄을 누르면 그 자리에 다시 보이며 포커스된다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-right', 3)
  await focusPane(app, page, 'focus-pane-left', 1)
  await typesInto(page, 1, 'middle')
  const middle = (await panes(page).nth(1).getAttribute('data-pty'))!
  const before = await paneBox(page, 1)

  await clickMenu(app, 'hide-pane')
  await expect(panes(page).nth(1)).toHaveClass(/hidden/)
  await expect(panes(page).nth(1)).toBeHidden()
  const [left, right] = [await paneBox(page, 0), await paneBox(page, 2)]
  expect(right.x).toBeLessThan(left.x + left.width + 20)
  await expect(activePane(page)).toHaveCount(1)
  await expect(panes(page).nth(1).locator('.terminal-view')).not.toHaveClass(/active/)
  await page.keyboard.type('echo typed-$((2+3))\n')
  await expect(screen(page, activePane(page))).toShow('typed-5')

  await cli(dataDir, middle, ['pty', 'send', middle, 'echo while-hidden-$((1+1))\r'])
  const listed = await cli(dataDir, middle, ['pane', 'list'])
  expect(
    listed
      .split('\n')
      .find((l) => l.includes(middle))!
      .split('\t')
      .at(-1)
  ).toBe('hidden')

  const rows = cellGroups(page).nth(0).locator('.pane-row')
  await expect(rows.nth(1).locator('.hidden-mark')).toHaveCount(1)
  await expect(rows.locator('.hidden-mark')).toHaveCount(1)
  await expect(rows.nth(1)).toHaveAttribute('aria-label', /\. Hidden$/)

  await rows.nth(1).click()
  await expect(panes(page).nth(1)).not.toHaveClass(/hidden/)
  await expect(rows.locator('.hidden-mark')).toHaveCount(0)
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await expect(screen(page, 1)).toShow('while-hidden-2')
  expect(await paneBox(page, 1)).toEqual(before)
})

test('숨긴 채 재시작해도 숨긴 채 뜨고, 꺼내면 같은 pty 다', async ({ launch }) => {
  const first = await launch()
  const { app, page } = first
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'kept')
  const pty = await panes(page).nth(1).getAttribute('data-pty')
  await panes(page).nth(1).locator('.pane-header').hover()
  await panes(page).nth(1).locator('.hide-button').click()
  await expect(panes(page).nth(1)).toHaveClass(/hidden/)

  await restartWith(app)
  const { page: again } = await launch()
  await expect(panes(again)).toHaveCount(2)
  await expect(panes(again).nth(1)).toHaveClass(/hidden/)
  await cellGroups(again).nth(0).locator('.pane-row').nth(1).click()
  await expect(panes(again).nth(1)).not.toHaveClass(/hidden/)
  await expect(panes(again).nth(1)).toHaveAttribute('data-pty', pty!)
  await expect(screen(again, 1)).toShow('kept-2')
})

test('columns 보기에서 가운데 pane 을 숨겨도 이미 보이는 오른쪽 pane 으로 포커스가 가므로 가로 스크롤은 움직이지 않는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await toggleView(launched, 'columns')
  await split(app, page, 'split-right', 2)
  await split(app, page, 'split-right', 3)
  await focusPane(app, page, 'focus-pane-left', 1)
  // 포커스를 따라가는 스크롤이 멈춘 뒤에 숨긴다.
  await settled(() => page.evaluate(() => document.querySelector('.terminals')!.scrollLeft))
  const scrolls = await page.evaluate(async () => {
    const area = document.querySelector('.terminals')!
    const out = [area.scrollLeft]
    ;(document.querySelectorAll('.pane .hide-button')[1] as HTMLElement).click()
    const end = performance.now() + 600
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r))
      out.push(area.scrollLeft)
    }
    return out
  })
  expect(scrolls[0]).toBeGreaterThan(0)
  expect(new Set(scrolls).size).toBe(1)
})
