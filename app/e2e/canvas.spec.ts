import type { Page } from '@playwright/test'
import {
  activePane,
  attachFromOutside,
  canvasButton,
  canvasPanel,
  canvasResizer,
  canvasWidth,
  cellItems,
  CLASSIC_SCROLLBARS,
  clickMenu,
  DOM_RENDERER,
  dragCanvas,
  dragHandle,
  grabHandle,
  expect,
  newCell,
  newWorkspace,
  openCanvas,
  OVERLAY_SCROLLBARS,
  putCanvas,
  resizeBy,
  rows,
  run,
  screen,
  serveRenderer,
  shellSize,
  sockets,
  test,
  watchTerminalWidths,
  workspaceNames,
  zshHome
} from './app'

const svg = (width: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20"><rect width="100%" height="100%" fill="red"/></svg>`

const panel = canvasPanel
const titles = (page: Page) => page.locator('.canvas .cards .title')
const markdown = (page: Page) => page.locator('.canvas .markdown')
const card = (page: Page, id: string) => page.locator(`.canvas .card[data-id="${id}"]`)

test('문서가 없어도 panel bar 의 Canvas 아이콘이 보이고, 아이콘이나 메뉴로 열고 닫으면 아이콘의 눌림 표시와 툴팁이 따라간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const expectOpen = async (open: boolean): Promise<void> => {
    await expect(panel(page)).toBeVisible({ visible: open })
    await expect(canvasButton(page)).toHaveAttribute('aria-pressed', String(open))
    await expect(canvasButton(page)).toHaveAttribute(
      'data-tooltip',
      open ? 'Close Canvas' : 'Open Canvas'
    )
  }
  await expect(canvasButton(page)).toBeVisible()
  await expect(canvasButton(page)).toHaveAttribute('data-tooltip-keys', '⌥⌘B')
  await expectOpen(false)

  await canvasButton(page).click()
  await expectOpen(true)
  await canvasButton(page).click()
  await expectOpen(false)

  await clickMenu(app, 'toggle-canvas')
  await expectOpen(true)
  await clickMenu(app, 'toggle-canvas')
  await expectOpen(false)
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

test('닫으면 셸이 보는 폭이 넓어지고, panel bar 의 Canvas 아이콘을 누르거나 문서가 오면 다시 열린다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await shellSize(page)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await expect.poll(async () => (await shellSize(page)).cols).toBeLessThan(before.cols)
  await expect(canvasButton(page)).toHaveAttribute('aria-pressed', 'true')
  const opened = await shellSize(page)

  await canvasButton(page).click()
  await expect(panel(page)).toBeHidden()
  await expect(canvasButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(opened.cols)
  await canvasButton(page).click()
  await expect(panel(page)).toBeVisible()
  await expect(card(page, 'a').locator('.markdown')).toHaveText('first')

  await canvasButton(page).click()
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await expect(panel(page)).toBeVisible()
  await expect(canvasButton(page)).toHaveAttribute('aria-pressed', 'true')
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

test('문서 안의 HTML 은 허용한 태그만 요소로 남고 스크립트는 돌지 않으며, 이미지는 대체 텍스트만 남는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, {
    id: 'a',
    kind: 'markdown',
    text: [
      'before <kbd>⌘K</kbd>',
      '<div class="palette-backdrop" popover><input placeholder="fake">backdrop</div>',
      '<img src="x" onerror="window.pwned = 1"> <img src="https://example.com/raw.png">',
      '<script>window.pwned = 2</script>',
      '![원격 그림](https://example.com/a.png) ![상대 그림](./a.png)',
      'after'
    ].join('\n\n')
  })

  await expect(markdown(page)).toContainText('after')
  await expect(markdown(page).locator('kbd')).toHaveText('⌘K')
  await expect(markdown(page)).toContainText('backdrop')
  await expect(markdown(page)).toContainText('원격 그림 상대 그림')
  await expect(page.locator('.palette-backdrop, [placeholder="fake"]')).toHaveCount(0)
  await expect(markdown(page).locator('[popover]')).toHaveCount(0)
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

function mixedDoc(bytes: number): string {
  const blocks: string[] = []
  for (let n = 0, length = 0; length < bytes; n++) {
    const b = [
      `## Section ${n}`,
      `Paragraph ${n} with **bold**, *em*, \`code\` and [a link](https://example.com/${n}). ` +
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.',
      `- item ${n}\n- item with \`code\`\n- item three`,
      '```ts\nconst x = ' +
        n +
        '\nfunction f() {\n  return x * 2 // ' +
        'wide '.repeat(30) +
        '\n}\n```',
      '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |',
      `> quote ${n}\n> more`
    ].join('\n\n')
    blocks.push(b)
    length += b.length + 2
  }
  return [...blocks, 'END-MARK'].join('\n\n')
}

// 한 번에 렌더하면 1 MB 문서에서 창이 1.3 초 넘게 멈추고, 묶음으로 나눠 렌더하면 5 MB 문서에서도 가장 긴 longtask 가
// 229 ms 였다(잰 값). 한도는 그 사이로 잡는다.
const LONG_TASK_LIMIT = 1_000

async function watchLongTasks(page: Page): Promise<() => Promise<number[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] }
    w.longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks.push(e.duration)
    }).observe({ type: 'longtask' })
  })
  return () => page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks)
}

test('큰 문서를 넣으면 위에서부터 채워 끝까지 그리고, 그동안 터미널은 입력을 받아 보인다', async ({
  launch
}) => {
  test.setTimeout(120_000)
  const { app, page } = await launch()
  const longTasks = await watchLongTasks(page)
  const end = markdown(page).getByText('END-MARK')
  await putCanvas(app, { id: 'a', kind: 'markdown', text: mixedDoc(5_000_000), title: 'A' })
  await expect(markdown(page).locator('h2').first()).toHaveText('Section 0')
  await expect(end).toHaveCount(0)
  await page.keyboard.type('echo typed-$((1+1000))\n')
  await expect(screen(page)).toShow('typed-1001')
  await expect(end).toHaveCount(0)

  await expect(end).toBeVisible({ timeout: 60_000 })
  expect(await markdown(page).locator('h2').count()).toBe(
    await markdown(page).locator('pre').count()
  )
  expect(Math.max(...(await longTasks()))).toBeLessThan(LONG_TASK_LIMIT)
})

test('채우는 도중 같은 id 로 이미지가 오면 떨어져 나간 본문에 더 붙이지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await page.evaluate(() => {
    const w = window as unknown as { detached: number }
    w.detached = 0
    const insert = Element.prototype.insertAdjacentHTML
    Element.prototype.insertAdjacentHTML = function (this: Element, ...args) {
      if (!this.isConnected) w.detached++
      return insert.apply(this, args)
    }
  })
  await putCanvas(app, { id: 'a', kind: 'markdown', text: mixedDoc(5_000_000), title: 'A' })
  await expect(markdown(page).locator('h2').first()).toHaveText('Section 0')
  await putCanvas(app, {
    id: 'a',
    kind: 'image',
    name: 'shot.svg',
    mime: 'image/svg+xml',
    svg: svg(40)
  })
  await expect(page.locator('.canvas .image')).toBeVisible()
  // 묶음을 붙이는 차례는 문서끼리 번갈아 오므로, 다른 문서를 끝까지 채우는 동안 앞 문서의 채우기가 살아 있으면 붙인다.
  await putCanvas(app, { id: 'b', kind: 'markdown', text: mixedDoc(300_000), title: 'B' })
  await expect(markdown(page).getByText('END-MARK')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { detached: number }).detached)).toBe(0)
})

test('marked 가 lexing 하지 못하는 큰 문서도 Markdown 이라는 제목의 카드에 원문 글자로 보인다', async ({
  launch
}) => {
  test.setTimeout(120_000)
  const { app, page } = await launch()
  const longTasks = await watchLongTasks(page)
  const text = '# big\n' + 'line\n'.repeat(3_000_000) + 'END-MARK\n'
  await putCanvas(app, { id: 'a', kind: 'markdown', text })
  await expect(titles(page)).toHaveText(['Markdown'])
  await expect(markdown(page).getByText('END-MARK')).toBeVisible({ timeout: 60_000 })
  await expect(markdown(page).locator('h1')).toHaveCount(0)
  expect(await markdown(page).evaluate((el) => el.textContent!.length)).toBe(text.length)
  expect(Math.max(...(await longTasks()))).toBeLessThan(LONG_TASK_LIMIT)
})

for (const [setting, args] of [
  ['overlay', undefined],
  ['고전', CLASSIC_SCROLLBARS]
] as const) {
  test(`${setting} 스크롤바 설정에서 코드 블록에 포인터를 올렸던 문서를 지워도 애니메이션이 남지 않는다`, async ({
    launch
  }) => {
    const { app, page } = await launch({}, undefined, args)
    // 지운 요소의 애니메이션은 document.getAnimations() 에 나오지 않으므로 만들어지는 것을 모두 잡아 둔다.
    await page.evaluate(() => {
      const w = window as unknown as { animations: Animation[] }
      w.animations = []
      const animate = Element.prototype.animate
      Element.prototype.animate = function (...a) {
        const animation = animate.apply(this, a)
        w.animations.push(animation)
        return animation
      }
    })
    await putCanvas(app, { id: 'a', kind: 'markdown', text: wide('code'), title: 'A' })
    await card(page, 'a').locator('.markdown pre').hover()
    await page.evaluate(() =>
      document.querySelector<HTMLElement>('.canvas .card[data-id="a"] .remove')!.click()
    )
    await expect(titles(page)).toHaveCount(0)
    const live = () =>
      page.evaluate(
        () =>
          (window as unknown as { animations: Animation[] }).animations.filter(
            (a) => a.playState !== 'idle'
          ).length
      )
    expect(await live()).toBe(0)
  })
}

test('접었다 펴거나 모두 펼쳐도 마크다운을 다시 렌더하지 않고, 같은 id 로 다시 온 문서는 새로 렌더해 앞 문서의 묶음을 남기지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: mixedDoc(300_000), title: 'A' })
  await expect(markdown(page).getByText('END-MARK')).toBeVisible()
  const html = await markdown(page).innerHTML()
  // DOMPurify 는 거를 HTML 을 DOMParser 로 읽으므로, 그 호출 수가 렌더한 횟수다.
  await page.evaluate(() => {
    const w = window as unknown as { parses: number }
    w.parses = 0
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (...args) {
      w.parses++
      return parse.apply(this, args)
    }
  })
  const parses = () => page.evaluate(() => (window as unknown as { parses: number }).parses)

  await titles(page).filter({ hasText: 'A' }).click()
  await expect(markdown(page)).toHaveCount(0)
  await titles(page).filter({ hasText: 'A' }).click()
  await expect(markdown(page).getByText('END-MARK')).toBeVisible()
  await page.locator('.canvas .collapse-all').click()
  await page.locator('.canvas .expand-all').click()
  await expect(markdown(page).getByText('END-MARK')).toBeVisible()
  expect(await markdown(page).innerHTML()).toBe(html)
  expect(await parses()).toBe(0)

  await leavePanel(page)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: mixedDoc(300_000), title: 'A' })
  await expect.poll(parses).toBeGreaterThan(0)
  await expect(markdown(page).getByText('END-MARK')).toBeVisible()
  expect(await markdown(page).innerHTML()).toBe(html)
})

test('문서가 들어오거나 패널의 버튼을 눌러도 키 입력은 터미널로 간다', async ({ launch }) => {
  const { app, page } = await launch()
  let n = 0
  const typesIntoTerminal = async () => {
    n += 1
    await page.keyboard.type(`echo typed-$((${n}+1000))\n`)
    await expect(screen(page)).toShow(`typed-${n + 1000}`)
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
  await canvasButton(page).click()
  await typesIntoTerminal()
  await canvasButton(page).click()
  await expect(panel(page)).toBeVisible()
  await typesIntoTerminal()
  await canvasButton(page).click()
  await expect(panel(page)).toBeHidden()
  await typesIntoTerminal()
})

test('다른 클라이언트가 터미널을 넓게 잡고 있어도 패널을 누를 수 있다', async ({
  launch,
  dataDir,
  defer
}) => {
  const { app, page } = await launch(DOM_RENDERER)
  await page.keyboard.type('echo ready-$((1+1))\n')
  await expect(rows(page)).toContainText('ready-2')
  const other = await attachFromOutside(sockets(dataDir)[0], 300, 12)
  defer(() => other.destroy())
  await expect(rows(page)).toContainText('took over input and size')

  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await titles(page).filter({ hasText: 'A' }).click()
  await expect(markdown(page)).toHaveText(['second'])
  await canvasButton(page).click()
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

// 같은 채널의 IPC 는 보낸 순서대로 오고 한 메시지의 listener 는 붙인 순서대로 불리므로, 앱보다 뒤에 붙인 이 listener
// 가 센 수만큼 앱이 문서를 받았다.
async function countPuts(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { puts: number; maru: { onCanvasPut(cb: () => void): void } }
    w.puts = 0
    w.maru.onCanvasPut(() => w.puts++)
  })
  return () => page.evaluate(() => (window as unknown as { puts: number }).puts)
}

const held = (page: Page) => page.locator('.canvas .held')

// Canvas 는 창 오른쪽에 있으므로 왼쪽 위 끝은 패널 밖이다.
const leavePanel = (page: Page) => page.mouse.move(1, 1)

test('커서가 패널 안에 있는 동안 온 문서는 끼우지 않고 수만 보이며, 커서가 나가면 받은 순서대로 끼운다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await expect(markdown(page)).toHaveText(['second', 'first'])
  await settle(page)
  const puts = await countPuts(page)

  await card(page, 'a').locator('.markdown').hover()
  await putCanvas(app, { id: 'c', kind: 'markdown', text: 'third', title: 'C' })
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first2', title: 'A' })
  await putCanvas(app, { id: 'd', kind: 'markdown', text: 'fourth', title: 'D' })
  await expect.poll(puts).toBe(3)
  await expect(titles(page)).toHaveText(['B', 'A'])
  await expect(markdown(page)).toHaveText(['second', 'first'])
  await expect(held(page)).toHaveText(/3 new/)

  await leavePanel(page)
  await expect(titles(page)).toHaveText(['D', 'C', 'B', 'A'])
  await expect(markdown(page)).toHaveText(['fourth', 'third', 'second', 'first2'])
  await expect(held(page)).toHaveCount(0)
})

test('✕ 위에서 다른 ✕ 로 옮겨도 그 사이에 문서가 끼지 않아, 누르면 커서 아래의 그 문서가 지워진다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await expect(markdown(page)).toHaveText(['second', 'first'])
  await settle(page)
  const puts = await countPuts(page)

  await card(page, 'b').locator('.remove').hover()
  await putCanvas(app, { id: 'd', kind: 'markdown', text: 'new', title: 'D' })
  await expect.poll(puts).toBe(1)
  await card(page, 'a').locator('.remove').hover()
  await page.mouse.down()
  await page.mouse.up()
  await expect(titles(page)).toHaveText(['B'])

  await leavePanel(page)
  await expect(titles(page)).toHaveText(['D', 'B'])
})

test('쌓인 문서의 알약을 누르면 그 문서들을 넣고 맨 위로 가며, 그 뒤에 온 문서는 다시 쌓인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const scroller = page.locator('.canvas .scroll')
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: long('a'), title: 'A' })
  await settle(page)
  await scroller.evaluate((el) => el.scrollTo(0, 1000))
  await expect.poll(scrollTop).toBe(1000)
  const puts = await countPuts(page)

  await card(page, 'a').locator('.markdown').hover()
  await putCanvas(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await putCanvas(app, { id: 'c', kind: 'markdown', text: 'third', title: 'C' })
  await expect(held(page)).toHaveText(/2 new/)
  // 알약의 `held-bounce` 애니메이션이 끝없이 돌아 Playwright 의 stable 검사를 통과하지 못하므로 `force` 로 누른다.
  await held(page).click({ force: true })
  await expect(titles(page)).toHaveText(['C', 'B', 'A'])
  await expect.poll(scrollTop).toBe(0)
  await expect(held(page)).toHaveCount(0)

  await putCanvas(app, { id: 'd', kind: 'markdown', text: 'fourth', title: 'D' })
  await expect.poll(puts).toBe(3)
  await expect(held(page)).toHaveText(/1 new/)
  await expect(titles(page)).toHaveText(['C', 'B', 'A'])
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

  await canvasButton(page).click()
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
  await leavePanel(page)
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

test('고전 스크롤바 설정에서도 Canvas 의 스크롤바는 자리를 차지하지 않아 고정된 제목 줄이 카드와 같은 폭이고, 스크롤을 멈춰 숨은 뒤에도 트랙을 누르면 한 페이지 넘어간다', async ({
  launch
}) => {
  const { app, page } = await launch({}, undefined, CLASSIC_SCROLLBARS)
  const scroller = page.locator('.canvas .scroll')
  await putCanvas(app, { id: 'b', kind: 'markdown', text: long('b'), title: 'B' })
  await settle(page)
  await titles(page).filter({ hasText: 'B' }).click()
  await expect(card(page, 'b').locator('.markdown')).toHaveCount(0)
  await leavePanel(page)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: long('a'), title: 'A' })
  await settle(page)
  await scroller.evaluate((el) => el.scrollTo(0, 1000))

  const pinned = page.locator('.canvas .pins.bottom .row[data-id="b"]')
  await expect(pinned).toBeVisible()
  expect(await scroller.evaluate((el: HTMLElement) => el.offsetWidth - el.clientWidth)).toBe(0)
  const pinnedBox = (await pinned.boundingBox())!
  const rowBox = (await card(page, 'b').locator('.row').boundingBox())!
  expect(pinnedBox.x).toBeCloseTo(rowBox.x, 0)
  expect(pinnedBox.width).toBeCloseTo(rowBox.width, 0)

  const bar = scroller.locator('> .os-scrollbar-vertical')
  await expect(bar).toHaveClass(/os-scrollbar-auto-hide-hidden/)
  const box = (await bar.boundingBox())!
  // clientHeight 는 정수로 반올림되지만 한 페이지는 소수 높이만큼 넘어간다.
  const [before, height] = await scroller.evaluate((el) => [
    el.scrollTop,
    el.getBoundingClientRect().height
  ])
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(before + height, 0)
})

test('고전 스크롤바 설정에서 Canvas 의 스크롤바 트랙을 눌러도 터미널이 포커스를 지킨다', async ({
  launch
}) => {
  const { app, page } = await launch({}, undefined, CLASSIC_SCROLLBARS)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: long('a'), title: 'A' })
  await settle(page)
  const focused = () =>
    page.evaluate(() => document.activeElement?.closest('.terminal-view.active') !== null)
  expect(await focused()).toBe(true)

  const scroller = page.locator('.canvas .scroll')
  const box = (await scroller.locator('> .os-scrollbar-vertical').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await focused()).toBe(true)
})

const wide = (tag: string) => '```\n' + `${tag} `.repeat(400) + '\n```'

test('고전 스크롤바 설정에서 코드 블록은 포인터가 들어온 블록에만 스크롤바를 씌우고, 씌우기 전에도 시스템 스크롤바가 자리를 차지하지 않으며, 다시 그린 블록에도 씌운다', async ({
  launch
}) => {
  const { app, page } = await launch({}, undefined, CLASSIC_SCROLLBARS)
  const pres = card(page, 'a').locator('.markdown pre')
  const barHeight = (i: number) =>
    pres.nth(i).evaluate((el: HTMLElement) => el.offsetHeight - el.clientHeight)
  await putCanvas(app, {
    id: 'a',
    kind: 'markdown',
    text: wide('old') + '\n\n' + wide('other'),
    title: 'A'
  })
  await expect(pres).toHaveCount(2)
  await expect(pres.first()).not.toHaveAttribute('data-overlayscrollbars')
  expect(await barHeight(0)).toBe(0)

  await pres.first().hover()
  await expect(pres.first()).toHaveAttribute('data-overlayscrollbars')
  await expect(pres.nth(1)).not.toHaveAttribute('data-overlayscrollbars')
  expect(await barHeight(0)).toBe(0)

  await leavePanel(page)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: wide('new'), title: 'A' })
  await expect(pres.first()).toContainText('new')
  await pres.first().hover()
  await expect(pres.first()).toHaveAttribute('data-overlayscrollbars')
  expect(await barHeight(0)).toBe(0)
})

test('overlay 스크롤바 설정에서는 Canvas 가 시스템 스크롤바를 그대로 쓴다', async ({ launch }) => {
  const { app, page } = await launch({}, undefined, OVERLAY_SCROLLBARS)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: long('a'), title: 'A' })
  await settle(page)
  const scroller = page.locator('.canvas .scroll')
  await expect(scroller).not.toHaveAttribute('data-overlayscrollbars')
  expect(await scroller.evaluate((el: HTMLElement) => el.offsetWidth - el.clientWidth)).toBe(0)
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
  await expect(screen(page)).toShow(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  await expect(screen(page)).toShow('code-0')
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
  await expect(screen(page)).toShow('"text":"mcp-doc"')
  await expect(screen(page)).toShow('code-0')
})

const viewButton = (page: Page) => page.locator('.canvas .views .view')
const viewMenu = (page: Page) => page.locator('.canvas .views .menu')
const cellChoice = (page: Page, cell: string) => viewMenu(page).locator(`[data-cell="${cell}"]`)
const selectedCell = async (page: Page): Promise<string> =>
  (await page.locator('.panes.selected').getAttribute('data-cell'))!

test('터미널에서 보낸 문서는 그 cell 을 고른 동안 보이고, 드롭다운으로 닫힌 cell 과 모든 문서를 고른다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch({ SHELL: '/bin/zsh', HOME: zshHome(dataDir, 'second') })
  const { app, page } = launched
  await page.keyboard.type("printf '# First' | maru canvas put >/dev/null\n")
  await expect(titles(page)).toHaveText(['First'])
  const first = await selectedCell(page)
  await newCell(launched, 2)
  const second = await selectedCell(page)
  await expect(titles(page)).toHaveCount(0)
  await expect(viewButton(page)).not.toContainText('second')
  await page.keyboard.type('cd ~/second\n')
  await expect(page.locator('.panes.selected .cell-header .name')).toHaveText('second')
  await expect(viewButton(page).locator('.cell')).toHaveText('second')
  await page.keyboard.type("printf '# Second' | maru canvas put >/dev/null\n")
  await expect(titles(page)).toHaveText(['Second'])

  await clickMenu(app, 'close-pane')
  await expect(cellItems(page)).toHaveCount(1)
  await expect(titles(page)).toHaveText(['First'])
  await expect(viewButton(page)).not.toContainText('closed')
  await expect(viewButton(page)).not.toContainText('second')

  await viewButton(page).click()
  await expect(viewMenu(page).locator('[data-cell]')).toHaveCount(2)
  await expect(cellChoice(page, first)).not.toContainText('closed')
  await expect(cellChoice(page, second)).toContainText('closed')
  await expect(viewMenu(page).locator('.group-name')).toHaveCount(1)
  await expect(cellChoice(page, second).locator('.cell')).toHaveText('second')
  await cellChoice(page, second).click()
  await expect(viewMenu(page)).toHaveCount(0)
  await expect(titles(page)).toHaveText(['Second'])
  await expect(viewButton(page)).toContainText('closed')

  await viewButton(page).click()
  await viewMenu(page).locator('.all').click()
  await expect(titles(page)).toHaveText(['Second', 'First'])
  await expect(page.locator('.canvas .card .owner')).toHaveCount(2)
  await expect(page.locator('.canvas .card .owner .workspace')).toHaveCount(2)
  await run(page, 'echo typed-$((1+1))', 'typed-2')

  await viewButton(page).click()
  const box = (await activePane(page).locator('.xterm-screen').boundingBox())!
  await page.mouse.click(box.x + 10, box.y + 10)
  await expect(viewMenu(page)).toHaveCount(0)
})

test('드롭다운의 workspace 이름을 누르면 그 workspace 의 문서로 고정되고, 현재 workspace 는 선택된 cell 의 workspace 를 따라간다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch({ SHELL: '/bin/zsh', HOME: zshHome(dataDir, 'second') })
  const { app, page } = launched
  await putCanvas(app, { id: 'one', kind: 'markdown', text: 'one', title: 'One' })
  const first = await selectedCell(page)
  await newCell(launched, 2)
  await putCanvas(app, { id: 'two', kind: 'markdown', text: 'two', title: 'Two' })
  await newWorkspace(launched, 3)
  await page.keyboard.type('cd ~/second\n')
  await expect(workspaceNames(page)).toContainText(['second'])
  await putCanvas(app, { id: 'three', kind: 'markdown', text: 'three', title: 'Three' })
  await expect(titles(page)).toHaveText(['Three'])

  await viewButton(page).click()
  await expect(viewMenu(page).locator('.group-name')).toHaveCount(2)
  const firstGroup = viewMenu(page)
    .locator('.group', { has: page.locator(`[data-cell="${first}"]`) })
    .locator('.group-name')
  const firstName = (await firstGroup.locator('.label').textContent())!
  expect(firstName).not.toBe('second')
  await firstGroup.click()
  await expect(viewMenu(page)).toHaveCount(0)
  await expect(titles(page)).toHaveText(['Two', 'One'])
  await expect(viewButton(page).locator('.label')).toHaveText(firstName)
  await expect(page.locator('.canvas .card .owner')).toHaveCount(2)
  await expect(page.locator('.canvas .card .owner .workspace')).toHaveCount(0)
  await viewButton(page).click()
  await expect(firstGroup).toHaveAttribute('aria-checked', 'true')

  await viewMenu(page).locator('.workspace').click()
  await expect(titles(page)).toHaveText(['Three'])
  await expect(viewButton(page).locator('.label')).toHaveText('second')
  await cellItems(page).first().click()
  expect(await selectedCell(page)).toBe(first)
  await expect(titles(page)).toHaveText(['Two', 'One'])
  await expect(viewButton(page).locator('.label')).toHaveText(firstName)
})

test('Canvas 헤더는 제목 줄만 창 드래그 영역이라 드롭다운 줄은 누른 것을 받는다', async ({
  launch
}) => {
  const launched = await launch()
  await openCanvas(launched)
  const region = (selector: string) =>
    launched.page
      .locator(selector)
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
  expect(await region('.canvas .title-row')).toBe('drag')
  expect(await region('.canvas .picker')).not.toBe('drag')
})

test('두 cell 이 같은 id 로 보낸 문서는 따로 남고, 접기와 ✕ 는 그 cell 의 문서에만 미친다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await putCanvas(app, { id: 'f', kind: 'markdown', text: 'one', title: 'From first' })
  await newCell(launched, 2)
  await putCanvas(app, { id: 'f', kind: 'markdown', text: 'two', title: 'From second' })
  await expect(titles(page)).toHaveText(['From second'])

  await viewButton(page).click()
  await viewMenu(page).locator('.all').click()
  await expect(titles(page)).toHaveText(['From second', 'From first'])
  await expect(card(page, 'f')).toHaveCount(2)
  await expect(markdown(page)).toHaveText(['two', 'one'])

  await titles(page).filter({ hasText: 'From first' }).click()
  await expect(markdown(page)).toHaveText(['two'])
  await card(page, 'f').filter({ hasText: 'From second' }).locator('.remove').click()
  await expect(titles(page)).toHaveText(['From first'])
})

test('입력이 16 MiB 아래여도 escape 한 요청 줄이 넘으면 앱의 이유와 함께 실패한다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(
    "head -c 9000000 /dev/zero | tr '\\0' '\"' | maru canvas put; echo code-$?\n"
  )
  await expect(screen(page)).toShow('code-1', { timeout: 20_000 })
  await expect(screen(page)).toShow('request line exceeds')
  await expect(panel(page)).toBeHidden()
})

test('왼쪽 경계를 끌어 Canvas 폭을 바꾸고, 터미널 영역이 0 이 되는 데서 멈춘다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await openCanvas(launched)
  const beforeCols = (await shellSize(page)).cols

  await dragCanvas(page, -100)
  await expect.poll(async () => (await shellSize(page)).cols).toBeLessThan(beforeCols)
  await dragHandle(page, canvasResizer(page), -3000)

  await expect.poll(async () => (await page.locator('.terminals').boundingBox())!.width).toBe(0)
  const box = (await panel(page).boundingBox())!
  const bar = (await page.locator('.panel-bar').boundingBox())!
  expect(box.x + box.width).toBe(bar.x)

  // 정한 폭(`canvasWidth`)이 보이는 폭보다 크면, 창을 넓힐 때 Canvas 가 그만큼 넓어진다. 그래서 창을 넓혀도 Canvas 폭이
  // 그대로이고, 넓어진 만큼 터미널 영역이 생기는지 본다.
  await resizeBy(app, 200, 0)
  await expect.poll(async () => (await page.locator('.terminals').boundingBox())!.width).toBe(200)
  expect(await canvasWidth(page)).toBe(box.width)
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
