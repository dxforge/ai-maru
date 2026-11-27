import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import {
  activePane,
  appRegionAt,
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
  settled,
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
  writeConfig,
  zshHome
} from './app'
import { WHEEL_SPAN } from '../src/renderer/src/canvas/zoom'

const svg = (width: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20"><rect width="100%" height="100%" fill="red"/></svg>`

const panel = canvasPanel
const titles = (page: Page) => page.locator('.canvas .cards .title')
const markdown = (page: Page) => page.locator('.canvas .markdown')
const card = (page: Page, id: string) => page.locator(`.canvas .card[data-id="${id}"]`)

/** 제목 줄의 ✕ 는 포인터를 줄에 올려야 나타나므로, 줄의 제목에 먼저 올린 뒤 ✕ 를 돌려준다. */
async function removeButton(row: Locator): Promise<Locator> {
  await row.locator('.head').first().hover()
  return row.locator('.remove')
}

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

  await (await removeButton(card(page, 'b'))).click()
  await expect(titles(page)).toHaveText(['A'])
})

test('이미지를 넣으면 띄우고, 같은 id 로 다시 넣으면 앞 그림의 확대·축소 없이 새 그림으로 바뀐다', async ({
  launch
}) => {
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
  const bar = page.locator('.canvas .zoom-bar')
  await image.hover()
  await bar.getByRole('button', { name: 'Zoom in' }).click()
  await expect(bar.getByRole('button', { name: 'Reset zoom' })).toHaveText('110%')
  // 커서가 패널 안에 있으면 새로 온 문서를 끼우지 않고 쌓아 두므로 밖으로 뺀다.
  await leavePanel(page)

  await putCanvas(app, {
    id: 'i',
    kind: 'image',
    name: 'shot.svg',
    mime: 'image/svg+xml',
    svg: svg(60)
  })
  await expect.poll(naturalWidth).toBe(60)
  await expect(titles(page)).toHaveCount(1)
  await expect(bar).toHaveCount(1)
  await image.hover()
  await expect(bar.getByRole('button', { name: 'Reset zoom' })).toHaveText('100%')
  await expect(image).not.toHaveAttribute('style', /width/)
  await expect(page.locator('.canvas .zoom-view')).not.toHaveAttribute('style', /height/)
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

const footnoteDoc = (tag: string, filler: string) =>
  [`${tag} first[^a] and second[^b].`, filler, `[^a]: ${tag} note a`, `[^b]: ${tag} note b`].join(
    '\n\n'
  )

// 대상이 Canvas 스크롤러 안에서 위에 붙은 제목 줄에 가리지 않고 보이며, 그 줄 바로 아래에 있는지 본다. 정의는 문서
// 끝에 있어 제목 줄 바로 아래까지 올라오지 못할 수 있으므로, 스크롤러가 끝에 닿았으면 그것도 도착으로 본다.
async function landed(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const viewport = el.closest<HTMLElement>('[data-overlayscrollbars-viewport]')!
    const box = viewport.getBoundingClientRect()
    const floor =
      document.querySelector('.canvas .pins.top')?.getBoundingClientRect().bottom ?? box.top
    const { top, bottom } = el.getBoundingClientRect()
    const end = viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 1
    return top >= floor - 0.5 && bottom <= box.bottom && (top < floor + 40 || end)
  })
}

const hash = (page: Page) => page.evaluate(() => location.hash)

test('각주 번호를 누르면 그 정의로 가고, 정의의 ↩ 를 누르면 그 번호로 돌아오며, 창의 주소는 바뀌지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: footnoteDoc('A', long('a')), title: 'A' })
  const md = markdown(page)
  await expect(md.locator('.footnotes li')).toHaveCount(2)
  await settle(page)

  await md.locator('sup a', { hasText: '2' }).click()
  const note = md.locator('.footnotes li').nth(1)
  await expect(note).toContainText('A note b')
  await expect.poll(() => landed(note)).toBe(true)

  await note.getByTitle('본문으로 돌아가기').click()
  await expect.poll(() => landed(md.locator('sup').nth(1))).toBe(true)
  expect(await hash(page)).toBe('')
})

test('큰 문서에서 마지막 묶음이 붙기 전에 각주 번호를 눌러도 붙은 뒤 그 정의로 가고, ↩ 로 돌아온다', async ({
  launch
}) => {
  test.setTimeout(120_000)
  const { app, page } = await launch()
  await putCanvas(app, {
    id: 'a',
    kind: 'markdown',
    text: footnoteDoc('A', mixedDoc(2_000_000)),
    title: 'A'
  })
  const md = markdown(page)
  await expect(md.locator('sup a').first()).toBeVisible()
  await expect(md.locator('.footnotes')).toHaveCount(0)

  await md.locator('sup a').first().click()
  const note = md.locator('.footnotes li').first()
  await expect(note).toContainText('A note a', { timeout: 60_000 })
  await expect.poll(() => landed(note)).toBe(true)

  await note.getByTitle('본문으로 돌아가기').click()
  await expect.poll(() => landed(md.locator('sup').first())).toBe(true)
  expect(await hash(page)).toBe('')
})

for (const [how, move] of [
  ['휠', (page: Page) => page.mouse.wheel(0, 400)],
  ['키', (page: Page) => page.keyboard.press('PageDown')]
] as const) {
  test(`큰 문서에서 각주 번호를 누른 뒤 마지막 묶음이 붙기 전에 ${how}로 스크롤하면 붙은 뒤에도 정의로 가지 않는다`, async ({
    launch
  }) => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    await putCanvas(app, {
      id: 'a',
      kind: 'markdown',
      text: footnoteDoc('A', mixedDoc(2_000_000)),
      title: 'A'
    })
    const md = markdown(page)
    const ref = md.locator('sup a').first()
    await expect(ref).toBeVisible()
    await ref.click()
    await move(page)
    expect(await md.locator('.footnotes').count()).toBe(0)
    const scrollTop = () => page.locator('.canvas .scroll').evaluate((el) => el.scrollTop)
    await expect.poll(scrollTop).toBeGreaterThan(0)
    const moved = await scrollTop()

    const note = md.locator('.footnotes li').first()
    await expect(note).toContainText('A note a', { timeout: 60_000 })
    // `scrollTo`(`CanvasDoc.vue`)는 묶음이 붙은 뒤 최대 10 프레임 동안 scrollTop 을 다시 맞추므로, 그보다 긴 20 프레임을 기다린다.
    await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame)
    })
    expect(await landed(note)).toBe(false)
    expect(Math.abs((await scrollTop()) - moved)).toBeLessThan(1000)
  })
}

test('큰 문서에서 각주 번호를 누른 뒤 마지막 묶음이 붙기 전에 위에 붙은 카드 제목을 누르면 붙은 뒤에도 정의로 가지 않는다', async ({
  launch
}) => {
  test.setTimeout(120_000)
  const { app, page } = await launch()
  await putCanvas(app, {
    id: 'a',
    kind: 'markdown',
    text: footnoteDoc('A', mixedDoc(4_000_000)),
    title: 'A'
  })
  const md = markdown(page)
  const ref = md.locator('sup a').first()
  await expect(ref).toBeVisible()
  await ref.click()
  // 카드 제목이 위에 붙게 scrollTop 을 맞춘다. 사용자 입력이 아니므로 점프를 버리지 않는다.
  const scroller = page.locator('.canvas .scroll')
  await scroller.evaluate((el) => (el.scrollTop = 300))
  await page.locator('.canvas .pins.top .row[data-id="a"]').click()
  expect(await md.locator('.footnotes').count()).toBe(0)
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop)
  await expect.poll(scrollTop).toBeLessThan(300)
  const moved = await scrollTop()

  const note = md.locator('.footnotes li').first()
  await expect(note).toContainText('A note a', { timeout: 60_000 })
  await page.evaluate(async () => {
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame)
  })
  expect(await landed(note)).toBe(false)
  expect(Math.abs((await scrollTop()) - moved)).toBeLessThan(1000)
})

test('각주가 있는 문서가 둘이면 각 문서의 번호는 그 문서의 정의로 간다', async ({ launch }) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: footnoteDoc('A', long('a')), title: 'A' })
  await putCanvas(app, { id: 'b', kind: 'markdown', text: footnoteDoc('B', long('b')), title: 'B' })
  await expect(page.locator('.canvas .footnotes li')).toHaveCount(4)
  await settle(page)

  for (const id of ['a', 'b']) {
    const md = card(page, id).locator('.markdown')
    await md.locator('sup a').first().click()
    const note = md.locator('.footnotes li').first()
    await expect(note).toContainText(`${id.toUpperCase()} note a`)
    await expect.poll(() => landed(note)).toBe(true)
  }
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

// 한 번에 렌더하면 1 MB 문서에서 창이 1.3 초 넘게 멈추고, 묶음으로 나눠 렌더하면 2 MB 문서에서 가장 긴 longtask 가
// 330 ms 였다(잰 값). 한도는 그 사이로 잡는다.
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
  // 셸이 문서를 넣은 뒤에 뜨면 입력이 보이기 전에 다 그릴 수 있으므로 셸을 먼저 띄워 둔다.
  await run(page, 'echo ready-$((1+1))', 'ready-2')
  await putCanvas(app, { id: 'a', kind: 'markdown', text: mixedDoc(2_000_000), title: 'A' })
  await expect(markdown(page).locator('h2').first()).toHaveText('Section 0')
  await expect(end).toHaveCount(0)
  // 그리는 동안에는 키 이벤트마다 그리던 묶음이 끝나기를 기다린다. 글자마다 보내면 다 그린 뒤에야 입력이 끝나므로
  // 한 번에 보낸다.
  await page.keyboard.insertText('echo typed-$((1+1000))')
  await page.keyboard.press('Enter')
  await expect(screen(page)).toShow('typed-1001')
  await expect(end).toHaveCount(0)

  await expect(end).toBeVisible({ timeout: 60_000 })
  expect(await markdown(page).locator('h2').count()).toBe(
    await markdown(page).locator('pre').count()
  )
  expect(Math.max(...(await longTasks()))).toBeLessThan(LONG_TASK_LIMIT)
})

test('큰 문서를 위로 조금씩 스크롤하다 처음 그려지는 묶음의 높이가 어림값과 달라도 읽던 내용은 스크롤한 만큼만 움직인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  // 코드 블록만 있는 묶음은 첫 묶음으로 어림한 높이와 실제 높이가 다르다.
  const code = Array.from(
    { length: 2_000 },
    (_, n) => '```ts\n' + `const v${n} = ${n}\n`.repeat(12) + '```'
  )
  const text = [mixedDoc(200_000), ...code, 'TAIL-MARK'].join('\n\n')
  await putCanvas(app, { id: 'a', kind: 'markdown', text, title: 'A' })
  await expect(markdown(page).getByText('TAIL-MARK')).toHaveCount(1, { timeout: 60_000 })
  const r = await page.evaluate(async () => {
    const md = document.querySelector<HTMLElement>('.canvas .markdown')!
    const viewport = md.closest<HTMLElement>('[data-overlayscrollbars-viewport]')!
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const box = viewport.getBoundingClientRect()
    const center = () =>
      document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)!
    const parts = md.querySelectorAll(':scope > .part')
    const part = parts[Math.floor(parts.length / 2)]!
    const goTo = (offset: number) => {
      viewport.scrollTop += part.getBoundingClientRect().top - box.top + offset
    }
    // 묶음 안 깊이 뛰어 그 묶음만 그린다. 바로 위 묶음은 Chrome 이 미리 그리는 거리 밖이라 한 번도 그리지 않은 채로 남는다.
    goTo(20_000)
    for (let i = 0; i < 60 && center().classList.contains('part'); i++) await frame()
    goTo(3_000)
    await frame()
    let changed = 0
    const moved: number[] = []
    for (let i = 0; i < 13; i++) {
      const el = center()
      const before = el.getBoundingClientRect().top
      const height = viewport.scrollHeight
      viewport.scrollTop -= 300
      await frame()
      if (viewport.scrollHeight !== height) changed++
      moved.push(Math.round(el.getBoundingClientRect().top - before))
    }
    return { changed, moved }
  })
  expect(r.changed).toBeGreaterThan(0)
  expect(r.moved).toEqual(r.moved.map(() => 300))
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

const mermaid = (source: string) => '```mermaid\n' + source + '\n```'
const WIDE = mermaid(
  `flowchart LR\n  ${Array.from({ length: 30 }, (_, i) => `N${i}[Node ${i}]`).join(' --> ')}`
)
const diagrams = (page: Page) => markdown(page).locator('.diagram .zoom-view > svg')
// `loadMermaid` 가 그릴 때마다 SVG 에 새 id(`maru-mermaid-N`)를 붙이므로, id 가 같으면 다시 그리지 않은 것이다.
const diagramIds = (page: Page) => diagrams(page).evaluateAll((svgs) => svgs.map((s) => s.id))
// mermaid 내장 테마 `default` 의 노드 채움색이다.
const LIGHT_NODE = 'rgb(236, 236, 255)'
const nodeFill = (page: Page) =>
  diagrams(page)
    .first()
    .locator('.node rect')
    .first()
    .evaluate((el) => getComputedStyle(el).fill)

test('mermaid 블록은 라벨과 함께 다이어그램으로 그리고, 틀린 블록은 코드와 오류 한 줄로 보이며, 접었다 펴도 다시 그리지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const csp: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) csp.push(m.text())
  })
  // 끝의 다이어그램은 첫 묶음 뒤에 붙는 묶음에 든다.
  const text = [
    mermaid('flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]'),
    mermaid('notadiagram'),
    mixedDoc(300_000),
    mermaid('sequenceDiagram\n  Alice->>Bob: Hello')
  ].join('\n\n')
  await putCanvas(app, { id: 'a', kind: 'markdown', text, title: 'A' })
  await expect(diagrams(page)).toHaveCount(2)
  for (const label of ['Start', 'Check', 'Done', 'Hello'])
    await expect(diagrams(page).getByText(label, { exact: true })).toBeVisible()
  const pres = markdown(page).locator('pre:has(> code.language-mermaid)')
  await expect(pres.nth(0)).toBeHidden()
  await expect(pres.nth(1)).toBeVisible()
  await expect(pres.nth(1).locator('+ .diagram-error')).toHaveText(
    /^No diagram type detected .*notadiagram$/
  )
  await expect(pres.nth(2)).toBeHidden()

  const ids = await diagramIds(page)
  await titles(page).filter({ hasText: 'A' }).click()
  await expect(markdown(page)).toHaveCount(0)
  await titles(page).filter({ hasText: 'A' }).click()
  await expect(diagrams(page)).toHaveCount(2)
  expect(await diagramIds(page)).toEqual(ids)
  await expect(markdown(page).locator('.diagram-error')).toHaveCount(1)
  expect(csp).toEqual([])
})

test('언어를 적은 코드 블록은 화면에 들어올 때 shiki 의 색으로 강조하고, mermaid 블록은 다이어그램으로 그린다', async ({
  launch
}) => {
  const { app, page } = await launch()
  // 끝의 블록은 첫 묶음 뒤에 붙는 묶음에 든다.
  const text = [
    '```ts\nconst a = 1\n```',
    mermaid('flowchart LR\n  A --> B'),
    mixedDoc(300_000),
    '```rust\nfn main() {}\n```'
  ].join('\n\n')
  await putCanvas(app, { id: 'a', kind: 'markdown', text })
  const ts = markdown(page).locator('pre > code.language-ts').first()
  await expect(ts.locator('span').first()).toHaveText('const')
  await expect(ts).toHaveText('const a = 1\n')
  const rust = markdown(page).locator('pre > code.language-rust')
  await expect(rust).toHaveText('fn main() {}\n')
  await expect(rust.locator('span')).toHaveCount(0)
  await rust.scrollIntoViewIfNeeded()
  await expect(rust.locator('span').first()).toHaveText('fn')
  await expect(diagrams(page)).toHaveCount(1)
  const [color, shiki] = await ts.evaluate((code) => {
    const span = code.querySelector('span')!
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    const probe = document.createElement('i')
    probe.style.color = getComputedStyle(span).getPropertyValue(
      dark ? '--shiki-dark' : '--shiki-light'
    )
    document.body.append(probe)
    const want = getComputedStyle(probe).color
    probe.remove()
    return [getComputedStyle(span).color, want]
  })
  expect(color).toBe(shiki)
})

test('다이어그램 라벨의 HTML 이 popover 를 띄우지 못한다', async ({ launch }) => {
  const { app, page } = await launch()
  const labels = [
    '<button popovertarget=p class=icon-button style=color:red>open</button><div id=p popover>fake</div>',
    '<button commandfor=q command=show-popover>command</button><div id=q popover>fake</div>',
    '<button commandfor=d command=show-modal>modal</button><dialog id=d>fake</dialog>'
  ]
  await putCanvas(app, {
    id: 'a',
    kind: 'markdown',
    text: mermaid(`flowchart LR\n${labels.map((l, i) => `  N${i}["${l}"]`).join('\n')}`)
  })
  const button = (text: string) => diagrams(page).locator('button', { hasText: text })
  await expect(button('open')).toHaveClass('icon-button')
  for (const text of ['open', 'command', 'modal']) await button(text).click()
  await expect(page.locator(':popover-open, dialog[open]')).toHaveCount(0)
  await expect(diagrams(page).locator('[popover], [popovertarget], dialog')).toHaveCount(0)
})

test('앱 테마의 밝기가 바뀌면 떠 있는 다이어그램을 그 밝기의 mermaid 테마로 다시 그린다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: mermaid('flowchart LR\n  A --> B') })
  await expect(diagrams(page)).toHaveCount(1)
  const dark = await nodeFill(page)
  expect(dark).not.toBe(LIGHT_NODE)
  writeConfig(dataDir, '[terminal]\ntheme = "Catppuccin Latte"\n')
  await expect.poll(() => nodeFill(page)).toBe(LIGHT_NODE)
  await expect(diagrams(page)).toHaveCount(1)
  writeConfig(dataDir, '[terminal]\ntheme = "Catppuccin Mocha"\n')
  await expect.poll(() => nodeFill(page)).toBe(dark)
})

test('다이어그램은 카드 너비에 맞춰 줄이지 않고 블록 안에서 가로로 스크롤하며, 포인터를 올리면 보이는 버튼과 ⌘+휠로 블록 높이를 바꾸지 않고 확대한다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, { id: 'a', kind: 'markdown', text: WIDE })
  await expect(diagrams(page)).toHaveCount(1)
  const svg = diagrams(page).first()
  const view = markdown(page).locator('.zoom-view')
  const rect = async () => (await svg.boundingBox())!
  const natural = Number(await svg.getAttribute('width'))
  const height = Number(await svg.getAttribute('height'))
  expect(natural).toBeGreaterThan(0)
  expect((await rect()).width).toBeCloseTo(natural, 0)
  expect(await view.evaluate((v) => v.scrollWidth > v.clientWidth)).toBe(true)
  const viewHeight = async () => (await view.boundingBox())!.height
  expect(await viewHeight()).toBeCloseTo(height, 0)
  const pointAt = async (x: number, y: number) => {
    const r = await rect()
    return [(x - r.x) / r.width, (y - r.y) / r.height]
  }
  const box = (await view.boundingBox())!
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  const bar = markdown(page).locator('.zoom-bar')
  await expect(bar).toBeHidden()
  await svg.hover()
  await expect(bar).toBeVisible()
  const centered = await pointAt(center.x, center.y)
  await bar.getByRole('button', { name: 'Zoom in' }).click()
  await expect(bar.getByRole('button', { name: 'Reset zoom' })).toHaveText('110%')
  expect((await rect()).width).toBeCloseTo(natural * 1.1, 0)
  expect(await viewHeight()).toBeCloseTo(height, 0)
  const [cx, cy] = await pointAt(center.x, center.y)
  expect(cx).toBeCloseTo(centered[0]!, 2)
  expect(cy).toBeCloseTo(centered[1]!, 2)

  const pointer = { x: box.x + box.width / 4, y: box.y + box.height / 4 }
  await page.mouse.move(pointer.x, pointer.y)
  const under = await pointAt(pointer.x, pointer.y)
  await page.keyboard.down('Meta')
  await page.mouse.wheel(0, -WHEEL_SPAN * Math.log(2))
  await page.keyboard.up('Meta')
  await expect(bar.getByRole('button', { name: 'Reset zoom' })).toHaveText('220%')
  expect((await rect()).width).toBeCloseTo(natural * 2.2, 0)
  expect(await viewHeight()).toBeCloseTo(height, 0)
  const [px, py] = await pointAt(pointer.x, pointer.y)
  expect(px).toBeCloseTo(under[0]!, 2)
  expect(py).toBeCloseTo(under[1]!, 2)

  const scroll = () => view.evaluate((v) => [v.scrollLeft, v.scrollTop])
  const [left, top] = await scroll()
  await expect(view).toHaveClass(/pannable/)
  await page.mouse.down()
  await page.mouse.move(pointer.x - 40, pointer.y - 20, { steps: 4 })
  await page.mouse.up()
  expect(await scroll()).toEqual([left! + 40, top! + 20])
})

test('카드보다 큰 이미지는 카드 너비에 맞춰 보이고, 버튼으로 블록 높이를 바꾸지 않고 확대해 끌어서 옮기며, 배율 버튼은 100% 로, fit 은 맞춘 크기로 간다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await putCanvas(app, {
    id: 'i',
    kind: 'image',
    name: 'wide.svg',
    mime: 'image/svg+xml',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="600"><rect width="100%" height="100%" fill="red"/></svg>'
  })
  const img = page.locator('.canvas .image')
  const view = page.locator('.canvas .image-doc .zoom-view')
  const bar = page.locator('.canvas .image-doc .zoom-bar')
  const reset = bar.getByRole('button', { name: 'Reset zoom' })
  const width = async () => (await img.boundingBox())!.width
  const viewHeight = async () => (await view.boundingBox())!.height
  await expect(bar).toHaveCount(1)
  const fit = await settled(width)
  expect(fit).toBeLessThan(2000)
  expect(fit).toBeCloseTo((await view.boundingBox())!.width, 0)
  const fitHeight = await viewHeight()
  expect(fitHeight).toBeCloseTo(fit * 0.3, 0)

  await expect(bar).toBeHidden()
  await img.hover()
  await expect(bar).toBeVisible()
  await expect(reset).toHaveText(`${Math.round((fit / 2000) * 100)}%`)
  await bar.getByRole('button', { name: 'Zoom in' }).click()
  const zoomed = await width()
  expect(zoomed).toBeGreaterThan(fit)
  await expect(reset).toHaveText(`${Math.round((zoomed / 2000) * 100)}%`)
  expect(await viewHeight()).toBeCloseTo(fitHeight, 0)
  await expect(view).toHaveClass(/pannable/)

  const box = (await view.boundingBox())!
  const scroll = () => view.evaluate((v) => [v.scrollLeft, v.scrollTop])
  const [left, top] = await scroll()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 10, { steps: 4 })
  await page.mouse.up()
  expect(await scroll()).toEqual([left! + 40, top! + 10])

  await img.hover()
  await reset.click()
  await expect(reset).toHaveText('100%')
  expect(await width()).toBeCloseTo(2000, 0)
  expect(await viewHeight()).toBeCloseTo(fitHeight, 0)
  await reset.click()
  await expect(reset).toHaveText('100%')
  await bar.getByRole('button', { name: 'Fit' }).click()
  expect(await width()).toBeCloseTo(fit, 0)
  expect(await viewHeight()).toBeCloseTo(fitHeight, 0)
  await expect(reset).toHaveText(`${Math.round((fit / 2000) * 100)}%`)
  await expect(view).not.toHaveClass(/pannable/)
})

const TALL = mermaid(
  `flowchart TD\n  ${Array.from({ length: 30 }, (_, i) => `N${i}[Node ${i}]`).join(' --> ')}`
)

test('fit 은 다이어그램 전체가 Canvas 에 보이게 맞추고, 블록 높이를 맞춘 다이어그램의 높이로 바꾼다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const text = ['# Diagrams', mermaid('flowchart LR\n  A --> B'), TALL].join('\n\n')
  // 앞뒤에 카드를 두어 위아래에 제목이 여러 줄 붙게 한다.
  for (const id of ['b', 'c', 'd'])
    await putCanvas(app, { id, kind: 'markdown', text: `# ${id}`, title: id })
  await putCanvas(app, { id: 'a', kind: 'markdown', text, title: 'A' })
  for (const id of ['e', 'f', 'g'])
    await putCanvas(app, { id, kind: 'markdown', text: `# ${id}`, title: id })
  await expect(diagrams(page)).toHaveCount(2)
  const boxes = markdown(page).locator('.diagram')
  const fit = async (i: number) => {
    // 블록 위 끝을 Canvas 가운데로 옮겨, 블록 위쪽의 막대가 붙은 제목에 가리지 않게 한다.
    await boxes.nth(i).evaluate((box) => {
      const scroller = box.closest<HTMLElement>('.canvas .scroll')!
      const area = scroller.getBoundingClientRect()
      scroller.scrollTop += box.getBoundingClientRect().top - (area.top + area.height / 2)
    })
    await boxes.nth(i).hover({ position: { x: 10, y: 10 } })
    await boxes.nth(i).getByRole('button', { name: 'Fit' }).click()
    return boxes.nth(i).evaluate((box) => {
      const view = box.querySelector<HTMLElement>('.zoom-view')!
      const svg = view.querySelector('svg')!.getBoundingClientRect()
      let scroller = box.parentElement!
      while (!['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY))
        scroller = scroller.parentElement!
      const area = scroller.getBoundingClientRect()
      const band = (where: string) =>
        document.querySelector(`.canvas .pins.${where}`)!.getBoundingClientRect()
      return {
        svg: { top: svg.top, bottom: svg.bottom, width: svg.width, height: svg.height },
        view: { width: view.clientWidth, height: view.getBoundingClientRect().height },
        area: { top: area.top, bottom: area.bottom, height: area.height },
        bands: { top: band('top'), bottom: band('bottom') },
        pannable: view.classList.contains('pannable'),
        label: box.querySelector('.zoom-reset')!.textContent
      }
    })
  }

  const small = await fit(0)
  expect(small.svg.width).toBeCloseTo(small.view.width, 0)
  expect(small.view.height).toBeCloseTo(small.svg.height, 0)
  expect(parseInt(small.label!)).toBeGreaterThan(100)
  expect(small.pannable).toBe(false)

  const tall = await fit(1)
  expect(tall.svg.height).toBeLessThan(tall.area.height)
  expect(tall.view.height).toBeCloseTo(tall.svg.height, 0)
  expect(tall.bands.top.height).toBeGreaterThan(0)
  expect(tall.svg.top).toBeGreaterThanOrEqual(tall.bands.top.bottom)
  expect(tall.svg.bottom).toBeLessThanOrEqual(
    tall.bands.bottom.height ? tall.bands.bottom.top : tall.area.bottom
  )
  expect(parseInt(tall.label!)).toBeLessThan(100)
  expect(tall.pannable).toBe(false)
})

test('복사 버튼은 다이어그램을 배경을 채운 100% 크기의 화면 배율 배 PNG 로, 이미지를 원본 크기의 PNG 로 클립보드에 싣는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await putCanvas(app, { id: 'a', kind: 'markdown', text: mermaid('flowchart LR\n  A --> B') })
  await putCanvas(app, {
    id: 'i',
    kind: 'image',
    name: 'red.svg',
    mime: 'image/svg+xml',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="100%" height="100%" fill="red"/></svg>'
  })
  await expect(diagrams(page)).toHaveCount(1)
  const clipboard = (x: number, y: number) =>
    app.evaluate(
      async ({ clipboard, nativeImage }, [x, y]) => {
        const [item] = await clipboard.read()
        const png = await item!.getType('image/png')
        const image = nativeImage.createFromBuffer(Buffer.from(await png.arrayBuffer()))
        const size = image.getSize()
        const bitmap = image.toBitmap()
        const at = (y! * size.width + x!) * 4
        // `toBitmap` 은 BGRA 순서다.
        return { size, pixel: [bitmap[at + 2], bitmap[at + 1], bitmap[at], bitmap[at + 3]] }
      },
      [x, y]
    )
  const copy = async (box: ReturnType<Page['locator']>) => {
    await app.evaluate(({ clipboard }) => clipboard.clear())
    await box.hover()
    const button = box.getByRole('button', { name: 'Copy image' })
    await button.click()
    await expect(button).toHaveClass(/copied/)
  }

  const diagram = markdown(page).locator('.diagram')
  const [natural, node, dpr, background] = await diagram.evaluate((box) => {
    const svg = box.querySelector('.zoom-view > svg')!
    const r = svg.getBoundingClientRect()
    // 첫 노드 rect 의 왼쪽 테두리에서 4px 안쪽, 세로 가운데 픽셀의 색을 잰다. 라벨 글자와 테두리 선을 피하는 자리이기 때문이다.
    const n = svg.querySelector('.node rect')!.getBoundingClientRect()
    let bg = 'rgba(0, 0, 0, 0)'
    for (let e: Element | null = box; e && bg === 'rgba(0, 0, 0, 0)'; e = e.parentElement)
      bg = getComputedStyle(e).backgroundColor
    return [
      { width: r.width, height: r.height },
      { x: n.left - r.left + 4, y: n.top - r.top + n.height / 2 },
      devicePixelRatio,
      bg
    ] as const
  })
  const fill = await nodeFill(page)
  await diagram.hover()
  await diagram.getByRole('button', { name: 'Zoom in' }).click()
  await copy(diagram)
  const copied = await clipboard(0, 0)
  expect(copied.size).toEqual({
    width: Math.round(natural.width * dpr),
    height: Math.round(natural.height * dpr)
  })
  expect(`rgb(${copied.pixel.slice(0, 3).join(', ')})`).toBe(background)
  expect(copied.pixel[3]).toBe(255)
  const drawn = await clipboard(Math.round(node.x * dpr), Math.round(node.y * dpr))
  expect(`rgb(${drawn.pixel.slice(0, 3).join(', ')})`).toBe(fill)

  await copy(card(page, 'i').locator('.zoom'))
  expect(await clipboard(150, 100)).toEqual({
    size: { width: 300, height: 200 },
    pixel: [255, 0, 0, 255]
  })
  expect(errors).toEqual([])
})

test('확대·축소 버튼은 블록에 보이는 영역의 가운데를 중심으로 하고, 블록보다 작아진 다이어그램은 블록 가운데에 둔다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const text = [
    mermaid(
      'flowchart TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]\n  B -->|no| D[Retry] --> A'
    ),
    WIDE
  ].join('\n\n')
  await putCanvas(app, { id: 'a', kind: 'markdown', text })
  await expect(diagrams(page)).toHaveCount(2)
  const boxes = markdown(page).locator('.diagram')
  const state = (i: number) =>
    boxes.nth(i).evaluate((box) => {
      const view = box.querySelector<HTMLElement>('.zoom-view')!
      const v = view.getBoundingClientRect()
      const s = view.querySelector('svg')!.getBoundingClientRect()
      return {
        center: [
          (v.left + view.clientWidth / 2 - s.left) / s.width,
          (v.top + view.clientHeight / 2 - s.top) / s.height
        ],
        margin: [
          s.left - v.left,
          view.clientWidth - (s.right - v.left),
          s.top - v.top,
          view.clientHeight - (s.bottom - v.top)
        ]
      }
    })
  const press = async (i: number, name: string) => {
    await boxes.nth(i).hover()
    await boxes.nth(i).getByRole('button', { name }).click()
  }
  const expectCenter = async (i: number, at: number[]) => {
    const [x, y] = (await state(i)).center
    expect(x).toBeCloseTo(at[0]!, 2)
    expect(y).toBeCloseTo(at[1]!, 2)
  }

  for (const name of ['Zoom out', 'Zoom out', 'Zoom in', 'Zoom in', 'Zoom in']) {
    await press(0, name)
    await expectCenter(0, [0.5, 0.5])
  }
  await press(0, 'Zoom out')
  await press(0, 'Zoom out')
  const [left, right, top, bottom] = (await state(0)).margin
  expect(left).toBeGreaterThan(0)
  expect(top).toBeGreaterThan(0)
  expect(left).toBeCloseTo(right!, 0)
  expect(top).toBeCloseTo(bottom!, 0)

  await boxes
    .nth(1)
    .locator('.zoom-view')
    .evaluate((v) => {
      v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2
    })
  const before = (await state(1)).center
  for (const name of ['Zoom in', 'Zoom in', 'Zoom out', 'Zoom out', 'Zoom out']) {
    await press(1, name)
    await expectCenter(1, before)
  }
})

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
  await (await removeButton(card(page, 'b'))).click()
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

  await (await removeButton(card(page, 'b'))).hover()
  await putCanvas(app, { id: 'd', kind: 'markdown', text: 'new', title: 'D' })
  await expect.poll(puts).toBe(1)
  await (await removeButton(card(page, 'a'))).hover()
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

test('고전 스크롤바 설정에서 다이어그램 블록의 스크롤바 손잡이를 끌면 끈 쪽으로 스크롤하고, 다이어그램을 끄는 동작으로 받지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch({}, undefined, CLASSIC_SCROLLBARS)
  await putCanvas(app, { id: 'a', kind: 'markdown', text: WIDE })
  await expect(diagrams(page)).toHaveCount(1)
  const view = markdown(page).locator('.zoom-view')
  await diagrams(page).first().hover()
  await expect(view).toHaveAttribute('data-overlayscrollbars')
  await expect(view).toHaveClass(/pannable/)

  const handle = view.locator('> .os-scrollbar-horizontal .os-scrollbar-handle')
  const box = (await handle.boundingBox())!
  const left = () => view.evaluate((v) => v.scrollLeft)
  expect(await left()).toBe(0)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 })
  expect(await view.evaluate((v) => v.classList.contains('dragging'))).toBe(false)
  await page.mouse.up()
  expect(await left()).toBeGreaterThan(60)
})

test('고전 스크롤바 설정에서 이미지 블록도 포인터가 들어오면 스크롤바를 씌우고, 같은 id 로 바뀐 이미지에도 씌운다', async ({
  launch
}) => {
  const { app, page } = await launch({}, undefined, CLASSIC_SCROLLBARS)
  const view = page.locator('.canvas .image-doc .zoom-view')
  const put = (width: number) =>
    putCanvas(app, {
      id: 'i',
      kind: 'image',
      name: 'shot.svg',
      mime: 'image/svg+xml',
      svg: svg(width)
    })

  await put(2000)
  await expect(view).toHaveCount(1)
  await view.hover()
  await expect(view).toHaveAttribute('data-overlayscrollbars')

  await leavePanel(page)
  await put(3000)
  await expect
    .poll(() => view.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(3000)
  await expect(view).not.toHaveAttribute('data-overlayscrollbars')
  await view.hover()
  await expect(view).toHaveAttribute('data-overlayscrollbars')
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
  await (await removeButton(pinnedB)).click()

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

test('maru canvas put 과 maru mcp 의 file 로 넣은 코드 파일은 강조한 코드 뷰로 보이고, 같은 파일을 다시 넣으면 그 문서가 바뀐다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  writeFileSync(join(dataDir, 'repro.cjs'), 'const a = 1\n')
  await run(page, `cd '${dataDir}'; maru canvas put ./repro.cjs; echo code-$?`, 'code-0')
  await expect(titles(page)).toHaveText(['repro.cjs'])
  await expect(page.locator('.canvas .code .text span').first()).toHaveText('const')

  writeFileSync(join(dataDir, 'repro.cjs'), 'let b = 2\n')
  const put = mcpLine({
    id: 1,
    method: 'tools/call',
    params: { name: 'canvas_put', arguments: { file: 'repro.cjs', title: 'Repro' } }
  })
  await run(page, `printf '%s\\n' ${put} | maru mcp; echo code-$((1+2))`, 'code-3')
  await expect(titles(page)).toHaveText(['Repro'])
  await expect(page.locator('.canvas .code .text span').first()).toHaveText('let')
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
  await expect(page.locator('.panes.selected .pane-header .cwd')).toHaveText('second')
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
  await (await removeButton(card(page, 'f').filter({ hasText: 'From second' }))).click()
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

/** 저장 대화상자를 띄우지 않고, 받은 기본 경로를 모으고 `answers` 의 경로를 차례로 고른 것으로 돌려준다. */
async function stubSaveDialog(app: ElectronApplication, answers: string[]): Promise<void> {
  await app.evaluate(({ dialog }, answers) => {
    const asked: string[] = []
    Object.assign(globalThis, { savePaths: asked })
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      asked.push((args.at(-1) as { defaultPath: string }).defaultPath)
      const filePath = answers.shift()
      return { canceled: filePath === undefined, filePath }
    }) as typeof dialog.showSaveDialog
  }, answers)
}

const savePaths = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { savePaths: string[] }).savePaths)

test('접힌 카드도 제목 줄의 복사 버튼을 누르면 마크다운 원문과 그린 HTML 을 클립보드에 싣고, 버튼이 잠깐 ✓ 가 된다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const text = '# 계획\n\n- **굵게** 한 항목\n'
  await putCanvas(app, { id: 'a', kind: 'markdown', text, title: '계획' })
  await titles(page).filter({ hasText: '계획' }).click()
  await expect(markdown(page)).toHaveCount(0)

  const copy = card(page, 'a').locator('.copy')
  const actions = card(page, 'a').locator('.actions')
  await leavePanel(page)
  await expect(actions).toBeHidden()
  await card(page, 'a').locator('.head').hover()
  await expect(actions).toBeVisible()
  const box = (await copy.boundingBox())!
  expect(await appRegionAt(page, box.x + box.width / 2, box.y + box.height / 2)).not.toBe('drag')
  await copy.click()
  await expect(copy).toHaveClass(/done/)
  const copied = await app.evaluate(async ({ clipboard }) => {
    const item = (await clipboard.read()).find((i) => i.types.includes('text/html'))
    const read = async (type: string) => ((await item?.getType(type)) as Blob | undefined)?.text()
    return { text: await read('text/plain'), html: await read('text/html') }
  })
  expect(copied.text).toBe(text)
  expect(copied.html).toContain('<h1>계획</h1>')
  expect(copied.html).toContain('<strong>굵게</strong>')
  await expect(copy).not.toHaveClass(/done/)
  // 접은 카드는 누른 뒤에도 접힌 채다.
  await expect(markdown(page)).toHaveCount(0)
})

test('저장 버튼은 처음엔 다운로드 폴더에서, 그 뒤로는 마지막으로 저장한 디렉토리에서 대화상자를 열어 원문과 원본 바이트를 쓰고, 이미지에는 복사 버튼이 없다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const downloads = await app.evaluate(({ app }) => app.getPath('downloads'))
  const md = join(dataDir, '계획 메모.md')
  const png = join(dataDir, 'shot.svg')
  await stubSaveDialog(app, [md, png])
  await putCanvas(app, { id: 'a', kind: 'markdown', text: '# A\r\n본문\r\n', title: '계획 메모' })
  await putCanvas(app, {
    id: 'i',
    kind: 'image',
    name: 'shot.svg',
    mime: 'image/svg+xml',
    svg: svg(40)
  })
  await expect(titles(page)).toHaveText(['shot.svg', '계획 메모'])
  await expect(card(page, 'i').locator('.copy')).toHaveCount(0)

  await card(page, 'a').locator('.head').hover()
  await card(page, 'a').locator('.save').click()
  await expect(card(page, 'a').locator('.save')).toHaveClass(/done/)
  expect(readFileSync(md, 'utf8')).toBe('# A\r\n본문\r\n')

  await card(page, 'i').locator('.head').hover()
  await card(page, 'i').locator('.save').click()
  await expect(card(page, 'i').locator('.save')).toHaveClass(/done/)
  expect(readFileSync(png, 'utf8')).toBe(svg(40))
  expect(await savePaths(app)).toEqual([join(downloads, '계획 메모.md'), join(dataDir, 'shot.svg')])
})
