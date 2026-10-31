import type { Page } from '@playwright/test'
import {
  attachFromOutside,
  canvasPanel,
  canvasResizer,
  canvasWidth,
  clickMenu,
  dragCanvas,
  dragHandle,
  grabHandle,
  expect,
  openCanvas,
  putCanvas,
  rows,
  serveRenderer,
  shellSize,
  sockets,
  test,
  watchTerminalWidths
} from './app'

const svg = (width: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20"><rect width="100%" height="100%" fill="red"/></svg>`

const panel = canvasPanel
const titles = (page: Page) => page.locator('.canvas .cards .title')
const markdown = (page: Page) => page.locator('.canvas .markdown')
const card = (page: Page, id: string) => page.locator(`.canvas .card[data-id="${id}"]`)
const reopen = (page: Page) => page.locator('.reopen')

test('문서가 없으면 패널도, 다시 여는 띠도 없다', async ({ launch }) => {
  const { page } = await launch()
  await expect(panel(page)).toBeHidden()
  await expect(reopen(page)).toHaveCount(0)
})

test('마크다운을 넣으면 패널이 열려 GFM 으로 렌더되고, 셸이 보는 폭이 줄어든다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await shellSize(page)

  await putCanvas(app, {
    id: 'a',
    kind: 'markdown',
    text: '# 설계 초안\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~\n\n- [x] done\n'
  })

  await expect(panel(page)).toBeVisible()
  await expect(titles(page)).toHaveText(['설계 초안'])
  await expect(markdown(page).locator('h1')).toHaveText('설계 초안')
  await expect(markdown(page).locator('table td')).toHaveText(['1', '2'])
  await expect(markdown(page).locator('del')).toHaveText('old')
  await expect(markdown(page).locator('input[type=checkbox]')).toBeChecked()
  await expect.poll(async () => (await shellSize(page)).cols).toBeLessThan(before.cols)
})

test('새 문서는 펼친 채 맨 위에 쌓이고, 제목 줄과 모두 접기·펼치기로 접고 펼치고, ✕ 는 지운다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await expect(titles(page)).toHaveText(['B', 'A'])
  await expect(markdown(page)).toHaveText(['second', 'first'])

  await titles(page).filter({ hasText: 'A' }).click()
  await expect(markdown(page)).toHaveText(['second'])
  await expect(card(page, 'a').locator('.head')).toHaveAttribute('aria-expanded', 'false')
  await titles(page).filter({ hasText: 'A' }).click()
  await expect(markdown(page)).toHaveText(['second', 'first'])

  await page.locator('.canvas .collapse-all').click()
  await expect(markdown(page)).toHaveCount(0)
  await page.locator('.canvas .expand-all').click()
  await expect(markdown(page)).toHaveText(['second', 'first'])

  await card(page, 'b').locator('.remove').click()
  await expect(titles(page)).toHaveText(['A'])
})

test('이미지를 넣으면 띄우고, 같은 id 로 다시 넣으면 새 그림으로 바뀐다', async ({ launch }) => {
  const { app, page } = await launch()
  const image = page.locator('.canvas .image')
  const naturalWidth = () => image.evaluate((img: HTMLImageElement) => img.naturalWidth)

  await putCanvas(app, {
    id: 'i',
    kind: 'image',
    name: 'shot.svg',
    mime: 'image/svg+xml',
    svg: svg(40)
  })
  await expect(titles(page)).toHaveText(['shot.svg'])
  await expect.poll(naturalWidth).toBe(40)

  await putCanvas(app, {
    id: 'i',
    kind: 'image',
    name: 'shot.svg',
    mime: 'image/svg+xml',
    svg: svg(60)
  })
  await expect.poll(naturalWidth).toBe(60)
  await expect(titles(page)).toHaveCount(1)
})

test('닫으면 띠만 남아 셸이 보는 폭이 넓어지고, 띠를 누르거나 문서가 오면 다시 열린다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await shellSize(page)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await expect.poll(async () => (await shellSize(page)).cols).toBeLessThan(before.cols)
  const opened = await shellSize(page)

  await page.locator('.canvas .close').click()
  await expect(panel(page)).toBeHidden()
  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(opened.cols)
  await reopen(page).click()
  await expect(panel(page)).toBeVisible()
  await expect(reopen(page)).toHaveCount(0)

  await page.locator('.canvas .close').click()
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await expect(panel(page)).toBeVisible()
  await expect(card(page, 'b').locator('.markdown')).toHaveText('second')
})

test('문서 안의 링크를 누르면 창은 그대로이고 그 주소를 바깥에서 연다', async ({ launch }) => {
  const { app, page } = await launch()
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => void opened.push(url)
  })
  const url = page.url()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: '[site](https://example.com/x)' })
  await expect(markdown(page).locator('a')).toHaveCount(1)

  // 막힌 이동 뒤에는 playwright 의 locator 가 멈춰서, 누르는 것부터는 페이지 안에서 한다.
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('.markdown a')!.click()
    window.open('https://example.com/y')
    location.href = 'file:///etc/hosts'
  })

  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened?.toSorted()))
    .toEqual(['https://example.com/x', 'https://example.com/y'])
  expect(
    await page.evaluate(() => [location.href, document.querySelectorAll('.xterm-screen').length])
  ).toEqual([url, 1])
})

test('dev 서버에서 뜬 창에서도 상대 링크는 창을 옮기지 않고 바깥에서 열고, 새로 고침만 창 안에서 한다', async ({
  launch,
  defer
}) => {
  const dev = await serveRenderer(defer)
  const { app, page } = await launch({ ELECTRON_RENDERER_URL: dev })
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => void opened.push(url)
  })
  await page.evaluate(() => ((window as { marker?: number }).marker = 1))
  await putCanvas(app, { id: 'a', kind: 'markdown', text: '[notes](notes.md)' })
  await expect(markdown(page).locator('a')).toHaveCount(1)

  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('.markdown a')!.click())
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual([`${dev}notes.md`])
  expect(
    await page.evaluate(() => [location.href, (window as { marker?: number }).marker])
  ).toEqual([dev, 1])

  // Vite 는 location.reload() 로 새로 고친다.
  const reloaded = page.waitForEvent('load')
  await page.evaluate(() => setTimeout(() => location.reload()))
  await reloaded
  await page.waitForSelector('.xterm-screen')
  expect(
    await page.evaluate(() => [location.href, (window as { marker?: number }).marker ?? null])
  ).toEqual([dev, null])
})

test('문서 안의 스크립트는 돌지 않고, 이미지는 대체 텍스트만 남는다', async ({ launch }) => {
  const { app, page } = await launch()
  await putCanvas(app, {
    id: 'a',
    kind: 'markdown',
    text: [
      'before',
      '<img src="x" onerror="window.pwned = 1"> <img src="https://example.com/raw.png">',
      '<script>window.pwned = 2</script>',
      '![원격 그림](https://example.com/a.png) ![상대 그림](./a.png)',
      'after'
    ].join('\n\n')
  })

  await expect(markdown(page)).toContainText('after')
  await expect(markdown(page)).toContainText('원격 그림 상대 그림')
  await expect(markdown(page).locator('script, img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined()
})

test('목록의 제목은 본문 heading 과 같은 글자로 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await putCanvas(app, {
    id: 'a',
    kind: 'markdown',
    text: '# Tom &amp; *J &lt;3&gt;* [&copy;](https://x) &#38; `&amp;` \\&amp;'
  })

  const body = await markdown(page).locator('h1').textContent()
  expect(body).toBe('Tom & J <3> © & &amp; &amp;')
  await expect(titles(page)).toHaveText(body!)
})

test('문서가 들어오거나 패널의 버튼을 눌러도 키 입력은 터미널로 간다', async ({ launch }) => {
  const { app, page } = await launch()
  let n = 0
  const typesIntoTerminal = async () => {
    n += 1
    await page.keyboard.type(`echo typed-$((${n}+1000))\n`)
    await expect(rows(page)).toContainText(`typed-${n + 1000}`)
  }
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'doc', title: 'A' })
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'doc', title: 'B' })
  await expect(panel(page)).toBeVisible()
  await typesIntoTerminal()

  await titles(page).filter({ hasText: 'A' }).click()
  await typesIntoTerminal()
  await page.locator('.canvas .collapse-all').click()
  await typesIntoTerminal()
  await page.locator('.canvas .expand-all').click()
  await typesIntoTerminal()
  await card(page, 'b').locator('.remove').click()
  await expect(titles(page)).toHaveText(['A'])
  await typesIntoTerminal()
  await page.locator('.canvas .close').click()
  await typesIntoTerminal()
  await reopen(page).click()
  await typesIntoTerminal()
})

test('다른 클라이언트가 터미널을 넓게 잡고 있어도 패널을 누를 수 있다', async ({
  launch,
  dataDir,
  defer
}) => {
  const { app, page } = await launch()
  await page.keyboard.type('echo ready-$((1+1))\n')
  await expect(rows(page)).toContainText('ready-2')
  const other = await attachFromOutside(sockets(dataDir)[0], 300, 12)
  defer(() => other.destroy())
  await expect(rows(page)).toContainText('took over input and size')

  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await titles(page).filter({ hasText: 'A' }).click()
  await expect(markdown(page)).toHaveText(['second'])
  await page.locator('.canvas .close').click()
  await expect(panel(page)).toBeHidden()
})

const long = (tag: string) => Array.from({ length: 200 }, (_, i) => `${tag} line ${i}`).join('\n\n')

// 패널 폭 transition 이 끝나기 전에 스크롤하면 폭이 넓어지면서 줄이 다시 감겨 scrollTop 이 맞지 않는다.
const settle = (page: Page) =>
  expect.poll(() => panel(page).evaluate((el) => el.getAnimations().length)).toBe(0)

test('보던 문서가 바뀌거나 새 문서가 위에 들어와도 읽던 내용은 화면에서 움직이지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const scroller = page.locator('.canvas .scroll')
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop)
  const screenTop = () => card(page, 'a').evaluate((el) => el.getBoundingClientRect().top)

  await putCanvas(app, { id: 'b', kind: 'markdown', text: long('b'), title: 'B' })
  await putCanvas(app, { id: 'a', kind: 'markdown', text: long('a'), title: 'A' })
  await expect(card(page, 'a').locator('.markdown')).toContainText('a line 0')
  await settle(page)
  await scroller.evaluate((el) => el.scrollTo(0, 1000))
  await expect.poll(scrollTop).toBe(1000)

  await putCanvas(app, { id: 'a', kind: 'markdown', text: long('a2'), title: 'A' })
  await expect(card(page, 'a').locator('.markdown')).toContainText('a2 line 0')
  expect(await scrollTop()).toBe(1000)
  await expect(titles(page)).toHaveText(['A', 'B'])

  const before = await screenTop()
  await putCanvas(app, { id: 'c', kind: 'markdown', text: 'new', title: 'C' })
  await expect(titles(page)).toHaveText(['C', 'A', 'B'])
  await expect(card(page, 'c').locator('.row')).toHaveClass(/flash/)
  // scrollTop 은 장치 픽셀 단위로 맞춰진다. 그래서 소수 위치에 놓인 카드의 화면 위치가 장치 픽셀 하나(0.5px 미만)
  // 안에서 어긋나므로 근삿값으로 잰다.
  expect(await screenTop()).toBeCloseTo(before, 0)
  expect(await scrollTop()).toBeGreaterThan(1000)
})

test('닫힌 패널에 새 문서가 들어와 다시 열려도 읽던 내용이 같은 자리에 보인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const scroller = page.locator('.canvas .scroll')
  const reading = () =>
    scroller.evaluate((el) => {
      const top = el.getBoundingClientRect().top
      const p = [...el.querySelectorAll('p')].find((x) => x.getBoundingClientRect().bottom > top)!
      return { text: p.textContent, top: p.getBoundingClientRect().top - top }
    })

  await putCanvas(app, { id: 'b', kind: 'markdown', text: long('b'), title: 'B' })
  await putCanvas(app, { id: 'a', kind: 'markdown', text: long('a'), title: 'A' })
  await expect(card(page, 'a').locator('.markdown')).toContainText('a line 0')
  await settle(page)
  // 1000·5000 에서는 Chromium 의 scroll anchoring 이 폭 변화를 보정해, 읽던 자리가 어긋나도 이 테스트가 잡지 못한다.
  // 3000 은 어긋남이 드러나는 값이다.
  await scroller.evaluate((el) => el.scrollTo(0, 3000))
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(3000)
  const before = await reading()

  await page.locator('.canvas .close').click()
  await expect(panel(page)).toBeHidden()
  await settle(page)
  await putCanvas(app, { id: 'c', kind: 'markdown', text: 'new', title: 'C' })
  await expect(titles(page)).toHaveText(['C', 'A', 'B'])
  await settle(page)

  const after = await reading()
  expect(after.text).toBe(before.text)
  expect(after.top).toBeCloseTo(before.top, 0)
})

test('붙은 제목을 누르면 그 문서로 가서, 그 제목이 위쪽 묶음 바로 아래에 온다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const scroller = page.locator('.canvas .scroll')
  const bottom = (sel: string) =>
    page.locator(sel).evaluate((el) => el.getBoundingClientRect().bottom)
  const top = (sel: string) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().top)

  await putCanvas(app, { id: 'b', kind: 'markdown', text: long('b'), title: 'B' })
  // 패널이 열리는 동안 누르면 Playwright 가 제목을 화면에 넣으려고 긴 문서를 몇 px 스크롤해, 제목이 패널 위에 붙고
  // 누를 카드의 제목 줄은 숨는다.
  await settle(page)
  await titles(page).filter({ hasText: 'B' }).click()
  await expect(card(page, 'b').locator('.markdown')).toHaveCount(0)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: long('a'), title: 'A' })
  await settle(page)
  await scroller.evaluate((el) => el.scrollTo(0, 1000))

  const pinned = page.locator('.canvas .pins.bottom .row[data-id="b"]')
  await expect(pinned).toBeVisible()
  await expect(card(page, 'b').locator('.row')).toHaveClass(/ghost/)
  await pinned.locator('.head').click()

  await expect(card(page, 'b').locator('.markdown')).toContainText('b line 0')
  await expect(page.locator('.canvas .pins.top .row[data-id="a"]')).toBeVisible()
  await expect
    .poll(() => top('.canvas .card[data-id="b"]'))
    .toBeCloseTo(await bottom('.canvas .pins.top'), 0)
})

test('모든 제목이 위에 붙은 채 붙은 제목의 ✕ 를 누르면 그 문서가 화면에서 빠진다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const errors: Error[] = []
  page.on('pageerror', (e) => errors.push(e))
  const scroller = page.locator('.canvas .scroll')
  for (const id of ['c', 'b', 'a'])
    await putCanvas(app, { id, kind: 'markdown', text: long(id), title: id.toUpperCase() })
  await settle(page)
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight))

  const pinnedB = page.locator('.canvas .pins.top .row[data-id="b"]')
  await expect(pinnedB).toBeVisible()
  await pinnedB.locator('.remove').click()

  await expect(page.locator('.canvas .card')).toHaveCount(2)
  await expect(page.locator('.canvas .card[data-id="b"]')).toHaveCount(0)
  await expect(page.locator('.canvas .pins .row[data-id="b"]')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('넘친 제목은 「더」 줄로 묶이고, 누르면 뜨는 목록에서 고른 문서로 간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const scroller = page.locator('.canvas .scroll')
  for (const id of ['e', 'd', 'c', 'b', 'a'])
    await putCanvas(app, { id, kind: 'markdown', text: long(id), title: id.toUpperCase() })
  await settle(page)
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight))

  const more = page.locator('.canvas .pins.top .more')
  await expect(more).toContainText('3')
  await expect(page.locator('.canvas .pins.top .row')).toHaveCount(2)
  await more.click()
  await expect(page.locator('.canvas .popover button')).toHaveText(['A', 'B', 'C'])

  await page.locator('.canvas .popover button', { hasText: 'A' }).click()
  const topOf = (sel: string) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().top)
  await expect
    .poll(
      async () =>
        (await topOf('.canvas .card[data-id="a"] .row')) - (await topOf('.canvas .scroll'))
    )
    .toBeCloseTo(0, 0)
  await expect(page.locator('.canvas .popover')).toHaveCount(0)
})

test('터미널에서 maru canvas put 으로 보낸 마크다운이 패널에 렌더되고 id 가 찍힌다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type("printf '# From CLI\\n\\nbody' | maru canvas put; echo code-$?\n")
  await expect(panel(page)).toBeVisible()
  await expect(titles(page)).toHaveText(['From CLI'])
  await expect(markdown(page).locator('h1')).toHaveText('From CLI')
  await expect(rows(page)).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  await expect(rows(page)).toContainText('code-0')
})

const mcpLine = (msg: object) => `'${JSON.stringify({ jsonrpc: '2.0', ...msg })}'`

test('maru mcp 에 canvas_put 을 부르면 패널에 렌더되고 문서 id 를 답한다', async ({ launch }) => {
  const { page } = await launch()
  const init = mcpLine({ id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
  const put = mcpLine({
    id: 1,
    method: 'tools/call',
    params: { name: 'canvas_put', arguments: { text: '# From MCP', id: 'mcp-doc' } }
  })
  await page.keyboard.type(`printf '%s\\n' ${init} ${put} | maru mcp; echo code-$?\n`)
  await expect(titles(page)).toHaveText(['From MCP'])
  await expect(markdown(page).locator('h1')).toHaveText('From MCP')
  await expect(rows(page)).toContainText('"text":"mcp-doc"')
  await expect(rows(page)).toContainText('code-0')
})

test('입력이 16 MiB 아래여도 escape 한 요청 줄이 넘으면 앱의 이유와 함께 실패한다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(
    "head -c 9000000 /dev/zero | tr '\\0' '\"' | maru canvas put; echo code-$?\n"
  )
  await expect(rows(page)).toContainText('code-1', { timeout: 20_000 })
  await expect(rows(page)).toContainText('request line exceeds')
  await expect(panel(page)).toBeHidden()
})

test('왼쪽 경계를 끌어 Canvas 폭을 바꾸고, 터미널 영역이 0 이 되는 데서 멈춘다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await openCanvas(launched)
  const beforeCols = (await shellSize(page)).cols

  await dragCanvas(page, -100)
  await expect.poll(async () => (await shellSize(page)).cols).toBeLessThan(beforeCols)
  await dragHandle(page, canvasResizer(page), -3000)

  await expect.poll(async () => (await page.locator('.terminals').boundingBox())!.width).toBe(0)
  const innerWidth = await page.evaluate(() => window.innerWidth)
  const box = (await panel(page).boundingBox())!
  expect(box.x + box.width).toBe(innerWidth)
})

test('Canvas 경계를 끄는 동안에는 폭이 transition 없이 바로 따라가고, 왼쪽 버튼으로만 끌린다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await openCanvas(launched)
  const before = await canvasWidth(page)

  await dragHandle(page, canvasResizer(page), -80, { button: 'right' })
  expect(await canvasWidth(page)).toBe(before)

  await grabHandle(page, canvasResizer(page), -60)
  await expect(panel(page)).toHaveClass(/resizing/)
  expect(await panel(page).evaluate((el) => el.getAnimations().length)).toBe(0)
  expect(await canvasWidth(page)).toBe(before + 60)
  await page.mouse.up()
  await expect(panel(page)).not.toHaveClass(/resizing/)
})

test('Canvas 를 열고 닫는 동안에는 터미널 크기를 맞추지 않고, 폭이 다 바뀐 뒤 한 번 맞춘다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const widths = await watchTerminalWidths(page)

  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first' })
  await expect(panel(page)).toBeVisible()
  await expect.poll(widths).toHaveLength(2)
  await page.waitForTimeout(300)
  expect(await widths()).toHaveLength(2)

  await clickMenu(app, 'toggle-canvas')
  await expect(panel(page)).toBeHidden()
  await expect.poll(widths).toHaveLength(3)
  await page.waitForTimeout(300)
  expect(await widths()).toHaveLength(3)
})

test('Canvas 를 닫다가 열고 다시 닫아도, 끝난 뒤 터미널은 닫힌 폭에 맞는다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await openCanvas(launched)
  await clickMenu(app, 'toggle-canvas')
  await expect(panel(page)).toBeHidden()
  const closed = await shellSize(page)
  await clickMenu(app, 'toggle-canvas')
  await expect.poll(() => panel(page).evaluate((el) => el.getAnimations().length)).toBe(0)

  await clickMenu(app, 'toggle-canvas')
  // 폭의 transition(180ms, `App.vue` 의 `--panel-duration`)이 도는 도중에 되돌린다.
  await page.waitForTimeout(60)
  await clickMenu(app, 'toggle-canvas')
  await page.waitForTimeout(60)
  await clickMenu(app, 'toggle-canvas')

  await expect(panel(page)).toBeHidden()
  await expect.poll(async () => (await shellSize(page)).cols).toBe(closed.cols)
})

test('사이드바·Canvas 경계는 터미널 카드에 걸치지 않아, 카드의 양 끝은 터미널이 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await openCanvas(launched)

  const hits = await page.evaluate(() => {
    const card = document.querySelector('.terminals')!.getBoundingClientRect()
    const y = card.top + card.height / 2
    return [card.left + 1, card.right - 1].map(
      (x) => !!document.elementFromPoint(x, y)?.closest('.terminals')
    )
  })
  expect(hits).toEqual([true, true])
})

test('끄는 도중 Canvas 를 닫으면 끌기가 끝나, 닫힌 뒤의 움직임은 폭을 바꾸지 않는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await openCanvas(launched)
  const before = await canvasWidth(page)
  await grabHandle(page, canvasResizer(page), -50)

  await clickMenu(app, 'toggle-canvas')
  await expect(panel(page)).toBeHidden()
  await page.mouse.move(100, 300, { steps: 4 })
  await page.mouse.up()

  await expect(panel(page)).not.toHaveClass(/resizing/)
  await clickMenu(app, 'toggle-canvas')
  await expect.poll(() => panel(page).evaluate((el) => el.getAnimations().length)).toBe(0)
  expect(await canvasWidth(page)).toBe(before + 50)
})
