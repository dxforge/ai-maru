import type { Page } from '@playwright/test'
import { clickMenu, expect, openPalette, restartWith, rows, run, test, type Launched } from './app'

function scrolls(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const track = document.querySelector('.terminal-view.active .xterm-vertical')!
    const slider = track.querySelector('.xterm-slider')!
    return slider.getBoundingClientRect().height < track.getBoundingClientRect().height
  })
}

function firstRow(page: Page): Promise<string> {
  return rows(page).locator(':scope > div').first().innerText()
}

async function fillWithPending({ page }: Launched): Promise<void> {
  await run(page, 'seq 1 300', '300')
  await expect.poll(() => scrolls(page)).toBe(true)
  await page.keyboard.type('echo pending-$((1+1))')
  await expect(rows(page)).toContainText('echo pending-$((1+1))')
}

async function expectCleared(page: Page): Promise<void> {
  await expect.poll(() => scrolls(page)).toBe(false)
  await expect.poll(() => firstRow(page)).toContain('echo pending-$((1+1))')
  await expect(rows(page)).not.toContainText('299')
}

test('Clear Scrollback 은 스크롤백과 커서 줄 위를 지워 치던 줄을 맨 위로 올리고, 친 글자는 그대로 셸에 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await fillWithPending(launched)

  await clickMenu(app, 'clear-scrollback')
  await expectCleared(page)

  await page.keyboard.press('Enter')
  await expect(rows(page)).toContainText('pending-2')
  await expect.poll(() => firstRow(page)).toContain('echo pending-$((1+1))')
})

test('팔레트의 Clear Scrollback 도 지운다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await fillWithPending(launched)

  await openPalette(launched)
  await page.keyboard.type('clear scrollback')
  await page.keyboard.press('Enter')
  await expectCleared(page)
})

test('지운 스크롤백은 재시작한 뒤에도 돌아오지 않는다', async ({ launch }) => {
  const first = await launch()
  await fillWithPending(first)
  await clickMenu(first.app, 'clear-scrollback')
  await expectCleared(first.page)

  await restartWith(first.app)
  const { page } = await launch()
  await expect(rows(page)).toContainText('echo pending-$((1+1))')
  await expectCleared(page)
})

function row(page: Page, i: number): Promise<string> {
  return rows(page).locator(':scope > div').nth(i).innerText()
}

// 재시작한 앱은 maru-pty 의 화면을 재생해 받는다. 지운 뒤 화면이 재시작 전과 같으면 xterm 과 maru-pty 가
// 같은 바이트로 같게 지운 것이다.
test('Clear Scrollback 뒤 화면은 재시작해 재생한 화면과 같고, 커서 아래 줄은 남는다', async ({
  launch
}) => {
  const expectRows = async (page: Page) => {
    await expect.poll(() => row(page, 0)).toContain('mark-b')
    await expect.poll(() => row(page, 1)).toContain('mark-3')
  }
  const first = await launch()
  await run(
    first.page,
    `seq 1 300; printf "mark-a\\nmark-b\\nmark-$((2+1))\\033[A\\r"; read x`,
    'mark-3'
  )
  await expect.poll(() => scrolls(first.page)).toBe(true)

  await clickMenu(first.app, 'clear-scrollback')
  await expect.poll(() => scrolls(first.page)).toBe(false)
  await expectRows(first.page)
  const cleared = await rows(first.page).innerText()

  await restartWith(first.app)
  const { page } = await launch()
  await expectRows(page)
  expect(await rows(page).innerText()).toBe(cleared)
  expect(await scrolls(page)).toBe(false)
})
