import type { Locator, Page } from '@playwright/test'
import {
  cellGroups,
  expect,
  focusPane,
  newWorkspace,
  paneHeader,
  programStatus,
  run,
  shellRows,
  shellValue,
  split,
  test,
  windowLosesFocus,
  workspaceHeads
} from './app'
import { SEEN_MS } from '../src/renderer/src/pty/seen'

function osc777(title: string, body: string, tty?: string): string {
  return `printf '\\033]777;notify;${title};${body}\\033\\\\'${tty ? ` > ${tty}` : ''}\n`
}

function osc9(body: string, tty?: string): string {
  return `printf '\\033]9;${body}\\007'${tty ? ` > ${tty}` : ''}\n`
}

/** 지금 focus 를 가진 pane 의 터미널 장치. 다른 pane 에서 이 장치에 쓰면 그 pane 의 프로그램이 쓴 것과 같다. */
function ttyOf(page: Page, dataDir: string, name: string): Promise<string> {
  return shellValue(page, dataDir, name, '$(tty)')
}

/**
 * 셸이 답하기를 기다린 뒤 pane 이름을 읽는다. main 은 pty host 에게서 `live` 를 받은 뒤에야 구독을 연다. 구독하기 전에 온
 * 알림은 받지 않는다. 셸이 답할 때는 구독이 열려 있는 것으로 보인다.
 */
async function shellNameOf(page: Page, row: Locator): Promise<string> {
  await run(page, 'echo ready-$((1+1))', 'ready-2')
  return (await row.locator('.title').textContent())!
}

test('OSC 777 알림이 오면 사이드바 행 제목이 알림 제목이 되고 pane 헤더에 제목·본문이 붙으며, 1초 넘게 본 뒤 떠나면 돌아온다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  const row = shellRows(page).nth(1)
  const header = paneHeader(page, 1)
  const shellName = await shellNameOf(page, row)
  await page.keyboard.type(osc777('Tests', '3 failed; see log'))
  await expect(row.locator('.title')).toHaveText('Tests')
  await expect(row.locator('.state')).toHaveClass(/unread/)
  await expect(row).toHaveAttribute(
    'title',
    new RegExp(`^${shellName} — Tests: 3 failed; see log\n`)
  )
  await expect(row).toHaveAttribute('aria-label', /\. Notification: Tests: 3 failed; see log$/)
  await expect(header.locator('.title')).toHaveText(shellName)
  await expect(header.locator('.notification')).toHaveText('Tests: 3 failed; see log')
  await expect(header.locator('.status-icon')).toHaveClass(/unread/)
  await expect(shellRows(page).nth(0).locator('.state')).not.toHaveClass(/unread/)

  await page.waitForTimeout(SEEN_MS)
  // 보고 있는 동안에는 남는다.
  await expect(header.locator('.notification')).toHaveCount(1)
  await focusPane(app, page, 'focus-pane-left', 0)
  await expect(row.locator('.title')).toHaveText(shellName)
  await expect(row.locator('.state')).not.toHaveClass(/unread/)
  await expect(header.locator('.notification')).toHaveCount(0)
  await expect(header.locator('.status-icon')).not.toHaveClass(/unread/)
})

test('pane 헤더의 자리가 모자라면 알림 글이 pane 이름보다 먼저 줄어든다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  const header = paneHeader(page, 1)
  await shellNameOf(page, shellRows(page).nth(1))
  await page.keyboard.type(osc777('Tests', 'x'.repeat(300)))
  await expect(header.locator('.notification')).toHaveCount(1)
  const clipped = (el: Element): boolean => el.scrollWidth > el.clientWidth
  expect(await header.locator('.notification').evaluate(clipped)).toBe(true)
  expect(await header.locator('.title').evaluate(clipped)).toBe(false)
})

test('OSC 9 알림은 본문을 행 제목과 헤더에 쓰고, 새 알림은 이전 것을 대신하며, 진행률 9;4 는 알림이 아니다', async ({
  launch
}) => {
  const { page } = await launch()
  const row = shellRows(page).nth(0)
  const shellName = await shellNameOf(page, row)
  await run(page, "printf '\\033]9;4;1;50\\007'; echo progress-$((1+1))", 'progress-2')
  await expect(row.locator('.state')).not.toHaveClass(/unread/)
  await expect(row.locator('.title')).toHaveText(shellName)

  await page.keyboard.type(osc9('build done'))
  await expect(row.locator('.title')).toHaveText('build done')
  await expect(paneHeader(page, 0).locator('.notification')).toHaveText('build done')
  await page.keyboard.type(osc777('Deploy', 'ok'))
  await expect(row.locator('.title')).toHaveText('Deploy')
  await expect(paneHeader(page, 0).locator('.notification')).toHaveText('Deploy: ok')
})

test('알림이 있는 pane 을 1초 넘게 본 뒤 앱 창이 포커스를 잃으면 알림을 지운다', async ({
  launch
}) => {
  const { page } = await launch()
  const row = shellRows(page).nth(0)
  const shellName = await shellNameOf(page, row)
  await page.keyboard.type(osc9('done'))
  await expect(row.locator('.title')).toHaveText('done')
  await page.waitForTimeout(SEEN_MS)
  await windowLosesFocus(page)
  await expect(row.locator('.title')).toHaveText(shellName)
})

test('접은 workspace 는 읽지 않은 알림이 있으면 이름 뒤에 점을, 상태 아이콘이 있으면 그 아이콘에 점을 보인다', async ({
  launch,
  dataDir
}) => {
  const l = await launch()
  const { page } = l
  const first = await ttyOf(page, dataDir, 'first')
  await newWorkspace(l, 2)
  const head = workspaceHeads(page).nth(0)
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  await expect(head.locator('.unread-dot')).toHaveCount(0)

  await page.keyboard.type(osc9('hello', first))
  await expect(head.locator('.unread-dot')).toHaveCount(1)
  await expect(workspaceHeads(page).nth(1).locator('.unread-dot')).toHaveCount(0)

  await page.keyboard.type(`${programStatus('blocked').trimEnd()} > ${first}\n`)
  await expect(head.locator('.state')).toHaveClass(/unread/)
  await expect(head.locator('.unread-dot')).toHaveCount(0)

  await head.click()
  await expect(head.locator('.state')).toHaveCount(0)
  await expect(head.locator('.unread-dot')).toHaveCount(0)
})

test('job 의 pty 로 pane:select 가 오면 그 job 이 든 cell 을 고른다', async ({
  launch,
  dataDir
}) => {
  const l = await launch()
  const { app, page } = l
  const job = await shellValue(page, dataDir, 'job', '$(maru job new --name sleeper sleep 600)')
  await newWorkspace(l, 2)
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)

  await app.evaluate(({ BrowserWindow }, pty) => {
    BrowserWindow.getAllWindows()[0].webContents.send('pane:select', pty)
  }, job)
  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)
})

test('데스크톱 알림을 누른 것처럼 pane:select 가 오면 그 pane 을 고르고 접은 workspace 를 편다', async ({
  launch,
  dataDir
}) => {
  const l = await launch()
  const { app, page } = l
  const first = await shellValue(page, dataDir, 'first', '$MARU_PTY_ID')
  await newWorkspace(l, 2)
  const head = workspaceHeads(page).nth(0)
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'false')

  await app.evaluate(({ BrowserWindow }, pty) => {
    BrowserWindow.getAllWindows()[0].webContents.send('pane:select', pty)
  }, first)
  await expect(head).toHaveAttribute('aria-expanded', 'true')
  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)
  await expect(shellRows(page).nth(0)).toHaveClass(/focused/)
  await run(page, 'echo $MARU_PTY_ID', first)
})
