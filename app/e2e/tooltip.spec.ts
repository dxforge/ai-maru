import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { activeTerminal, cellGroups, expect, newCell, run, sidebarCard, test } from './app'

const isOpen = (el: Locator) => el.evaluate((e) => e.matches(':popover-open'))

test('사이드바 job 줄에 마우스를 올리면 명령과 종료 코드를 카드로 띄우고, ✕ 로 옮기면 바로 tooltip 으로 바꿔 띄우며 Esc 와 chord 키로 닫는다', async ({
  launch
}) => {
  const { page } = await launch()
  await run(page, "maru job new --name build sh -c 'exit  3' && echo started-$((1+1))", 'started-2')
  const job = page.locator('.sidebar .job-row.exited')
  const card = sidebarCard(page)
  const tooltip = page.locator('#app-tooltip')

  await job.locator('.title').hover()
  await expect(card).toBeVisible()
  expect(await isOpen(card)).toBe(true)
  const section = card.locator('.section.current')
  // 명령의 연속 공백도 그대로 보인다.
  expect(await section.locator('.run').evaluate((e) => (e as HTMLElement).innerText)).toBe(
    'sh -c exit  3'
  )
  await expect(section.locator('.time')).toHaveText('Exited with code 3')
  await expect(job).toHaveAttribute('aria-describedby', 'sidebar-card')

  await job.locator('.kill').hover()
  await expect(tooltip).toHaveText('Remove', { timeout: 100 })
  await expect(card).toBeHidden()
  await expect(job).not.toHaveAttribute('aria-describedby', /./)

  await page.keyboard.press('Escape')
  await expect(tooltip).toBeHidden()

  // ⌘J 뒤에 기다리는 두 번째 키는 `App.vue` 가 window 에서 멈춘다. 이 키를 눌러도 카드가 닫히는지 확인한다.
  await page.mouse.move(0, 0)
  await page.keyboard.press('Meta+KeyJ')
  await job.locator('.title').hover()
  await expect(card).toBeVisible()
  await page.keyboard.press('KeyX')
  await expect(card).toBeHidden()
})

test('커서를 둔 사이드바 줄이 위 cell 에 생긴 job 줄에 밀려 내려가면, 카드를 커서 아래 요소의 것으로 바꾼다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  const go = join(dataDir, 'go')
  await activeTerminal(page)
  await page.keyboard.type(
    `until [ -e '${go}' ]; do sleep 0.1; done; maru job new --name late sleep 600\n`
  )
  await newCell(launched, 2)
  const row = cellGroups(page).nth(1).locator('.pane-row')
  const card = sidebarCard(page)

  const box = (await row.boundingBox())!
  const x = box.x + 20
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await expect(card).toBeVisible()
  await expect(row).toHaveAttribute('aria-describedby', 'sidebar-card')

  // 키를 누르면 카드가 닫히므로, 위 cell 의 셸이 기다리던 파일을 만들어 job 을 띄운다.
  writeFileSync(go, '')
  await expect(cellGroups(page).nth(0).locator('.job-row')).toHaveCount(1)
  const moved = (await row.boundingBox())!
  expect(moved.y).toBeGreaterThan(y)

  await expect(row).not.toHaveAttribute('aria-describedby', /./)
  // 커서 아래에서 tooltip·카드를 가진 가장 안쪽 요소가 띄운 요소다.
  await expect(async () => {
    const same = await page.evaluate(
      ([x, y]) => {
        const at = document.elementFromPoint(x, y)
        const owner = at?.closest('[data-tooltip], .job-row, .pane-row, .group')
        return !!owner && owner === at?.closest('[aria-describedby]')
      },
      [x, y]
    )
    expect(same).toBe(true)
  }).toPass({ timeout: 2000 })
})
