import type { ElectronApplication, Page } from '@playwright/test'
import type { CanvasMarkdown } from '../src/shared/canvas'
import { attachFromOutside, expect, rows, shellSize, sockets, test } from './app'

type Item = CanvasMarkdown | { id: string; kind: 'image'; name: string; mime: string; svg: string }

async function put(app: ElectronApplication, item: Item): Promise<void> {
  await app.evaluate(({ BrowserWindow }, item) => {
    const msg =
      item.kind === 'image'
        ? {
            id: item.id,
            kind: item.kind,
            name: item.name,
            mime: item.mime,
            bytes: Buffer.from(item.svg)
          }
        : item
    BrowserWindow.getAllWindows()[0].webContents.send('canvas:put', msg)
  }, item)
}

const svg = (width: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20"><rect width="100%" height="100%" fill="red"/></svg>`

const panel = (page: Page) => page.locator('.canvas')
const titles = (page: Page) => page.locator('.canvas .list button')
const markdown = (page: Page) => page.locator('.canvas .markdown')
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

  await put(app, {
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

test('같은 id 로 다시 넣으면 목록 자리를 지킨 채 내용이 바뀌고 그 문서가 선택된다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await put(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await put(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await expect(markdown(page)).toHaveText('second')

  await put(app, { id: 'a', kind: 'markdown', text: 'first again', title: 'A2' })

  await expect(titles(page)).toHaveText(['B', 'A2'])
  await expect(titles(page).nth(1)).toHaveClass(/selected/)
  await expect(markdown(page)).toHaveText('first again')
})

test('목록에서 고르면 그 문서를 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await put(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await put(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })

  await titles(page).filter({ hasText: 'A' }).click()

  await expect(markdown(page)).toHaveText('first')
  await expect(titles(page).nth(1)).toHaveClass(/selected/)
})

test('이미지를 넣으면 띄우고, 같은 id 로 다시 넣으면 새 그림으로 바뀐다', async ({ launch }) => {
  const { app, page } = await launch()
  const image = page.locator('.canvas .image')
  const naturalWidth = () => image.evaluate((img: HTMLImageElement) => img.naturalWidth)

  await put(app, { id: 'i', kind: 'image', name: 'shot.svg', mime: 'image/svg+xml', svg: svg(40) })
  await expect(titles(page)).toHaveText(['shot.svg'])
  await expect.poll(naturalWidth).toBe(40)

  await put(app, { id: 'i', kind: 'image', name: 'shot.svg', mime: 'image/svg+xml', svg: svg(60) })
  await expect.poll(naturalWidth).toBe(60)
  await expect(titles(page)).toHaveCount(1)
})

test('닫으면 띠만 남아 셸이 보는 폭이 넓어지고, 띠를 누르거나 문서가 오면 다시 열린다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await shellSize(page)
  await put(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await expect.poll(async () => (await shellSize(page)).cols).toBeLessThan(before.cols)
  const opened = await shellSize(page)

  await page.locator('.canvas .close').click()
  await expect(panel(page)).toBeHidden()
  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(opened.cols)
  await reopen(page).click()
  await expect(panel(page)).toBeVisible()
  await expect(reopen(page)).toHaveCount(0)

  await page.locator('.canvas .close').click()
  await put(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await expect(panel(page)).toBeVisible()
  await expect(markdown(page)).toHaveText('second')
})

test('문서 안의 링크를 누르면 창은 그대로이고 그 주소를 바깥에서 연다', async ({ launch }) => {
  const { app, page } = await launch()
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => void opened.push(url)
  })
  const url = page.url()
  await put(app, { id: 'a', kind: 'markdown', text: '[site](https://example.com/x)' })
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

test('문서 안의 스크립트는 돌지 않고, 이미지는 대체 텍스트만 남는다', async ({ launch }) => {
  const { app, page } = await launch()
  await put(app, {
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

test('문서의 스타일은 패널 밖을 바꾸지 못한다', async ({ launch }) => {
  const { app, page } = await launch()
  await put(app, {
    id: 'a',
    kind: 'markdown',
    text: [
      '<style>.xterm { visibility: hidden }</style>',
      '<div style="position: fixed; inset: 0; z-index: 99; background: red">overlay</div>'
    ].join('\n\n')
  })

  await expect(markdown(page)).toContainText('overlay')
  await expect(markdown(page).locator('style, [style]')).toHaveCount(0)
  await expect(page.locator('.xterm')).toBeVisible()
  await page.locator('.canvas .close').click()
  await expect(panel(page)).toBeHidden()
})

test('문서의 dialog·popover 는 패널 밖으로 떠오르지 않는다', async ({ launch }) => {
  const { app, page } = await launch()
  await put(app, {
    id: 'a',
    kind: 'markdown',
    text: [
      '<dialog open>dialog-body</dialog>',
      '<button popovertarget="p">show</button><div id="p" popover>popover-body</div>'
    ].join('\n\n')
  })

  await expect(markdown(page)).toContainText('dialog-body')
  await markdown(page).getByRole('button', { name: 'show' }).click()
  expect(await page.evaluate(() => document.querySelectorAll(':popover-open').length)).toBe(0)
  await expect(markdown(page).locator('dialog, [popover], [popovertarget]')).toHaveCount(0)
  await page.locator('.canvas .close').click()
  await expect(panel(page)).toBeHidden()
})

test('목록의 제목은 본문 heading 과 같은 글자로 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await put(app, {
    id: 'a',
    kind: 'markdown',
    text: '# Tom &amp; *J &lt;3&gt;* [&copy;](https://x) &#38; `&amp;` \\&amp;'
  })

  const body = await markdown(page).locator('h1').textContent()
  expect(body).toBe('Tom & J <3> © & &amp; &amp;')
  await expect(titles(page)).toHaveText(body!)

  await put(app, { id: 'a', kind: 'markdown', text: '# &copy 2024 a &lt b &copyx; &notit;' })
  await expect(markdown(page).locator('h1')).toHaveText('&copy 2024 a &lt b ©x; ¬it;')
  await expect(titles(page)).toHaveText('&copy 2024 a &lt b ©x; ¬it;')
})

test('문서가 들어오거나 패널의 버튼을 눌러도 키 입력은 터미널로 간다', async ({ launch }) => {
  const { app, page } = await launch()
  let n = 0
  const typesIntoTerminal = async () => {
    n += 1
    await page.keyboard.type(`echo typed-$((${n}+1000))\n`)
    await expect(rows(page)).toContainText(`typed-${n + 1000}`)
  }
  await put(app, { id: 'a', kind: 'markdown', text: 'doc', title: 'A' })
  await put(app, { id: 'b', kind: 'markdown', text: 'doc', title: 'B' })
  await expect(panel(page)).toBeVisible()
  await typesIntoTerminal()

  await titles(page).filter({ hasText: 'A' }).click()
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

  await put(app, { id: 'a', kind: 'markdown', text: 'first', title: 'A' })
  await put(app, { id: 'b', kind: 'markdown', text: 'second', title: 'B' })
  await titles(page).filter({ hasText: 'A' }).click()
  await expect(markdown(page)).toHaveText('first')
  await page.locator('.canvas .close').click()
  await expect(panel(page)).toBeHidden()
})

test('보던 문서가 바뀌면 스크롤 자리를 지키고, 다른 문서를 고르면 맨 위부터 보인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const long = (tag: string) =>
    Array.from({ length: 200 }, (_, i) => `${tag} line ${i}`).join('\n\n')
  const view = page.locator('.canvas .view')
  const scrollTop = () => view.evaluate((el) => el.scrollTop)

  await put(app, { id: 'b', kind: 'markdown', text: long('b'), title: 'B' })
  await put(app, { id: 'a', kind: 'markdown', text: long('a'), title: 'A' })
  await view.evaluate((el) => el.scrollTo(0, 1000))
  await expect.poll(scrollTop).toBe(1000)

  await put(app, { id: 'a', kind: 'markdown', text: long('a2'), title: 'A' })
  await expect(markdown(page)).toContainText('a2 line 0')
  expect(await scrollTop()).toBe(1000)

  await titles(page).filter({ hasText: 'B' }).click()
  await expect(markdown(page)).toContainText('b line 0')
  await expect.poll(scrollTop).toBe(0)
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

test('같은 --id 로 다시 보내면 목록 자리를 지킨 채 제목과 내용이 바뀐다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type("echo '# one' | maru canvas put --id d >/dev/null\n")
  await expect(titles(page)).toHaveText(['one'])
  await page.keyboard.type("echo '# two' | maru canvas put --id e >/dev/null\n")
  await expect(titles(page)).toHaveText(['two', 'one'])
  await page.keyboard.type(
    "echo '# three' | maru canvas put --id d --title Renamed; echo code-$?\n"
  )
  await expect(titles(page)).toHaveText(['two', 'Renamed'])
  await expect(markdown(page).locator('h1')).toHaveText('three')
  await expect(rows(page)).toContainText('code-0')
})

test('파일을 인자로 주면 셸의 현재 디렉토리 기준으로 읽어 보인다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await page.keyboard.type(
    `cd '${dataDir}' && printf '# From file' > note.md && maru canvas put note.md; echo code-$?\n`
  )
  await expect(titles(page)).toHaveText(['From file'])
  await expect(rows(page)).toContainText('code-0')
})

test('16 MiB 를 넘는 입력은 앱에 보내지 않고 실패한다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('yes | maru canvas put; echo code-$?\n')
  await expect(rows(page)).toContainText('code-1', { timeout: 20_000 })
  await expect(rows(page)).toContainText('larger than the 16 MiB')
  await expect(panel(page)).toBeHidden()
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

test('FILE 없이 stdin 이 터미널이면 기다리지 않고 실패한다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('maru canvas put; echo code-$?\n')
  await expect(rows(page)).toContainText('pipe markdown into stdin')
  await expect(rows(page)).toContainText('code-1')
})
