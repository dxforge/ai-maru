import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { activeTerminal, cellGroups, expect, newCell, run, test } from './app'

test('사이드바 job 줄에 마우스를 올리면 명령과 종료 코드를 두 줄로 띄우고, ✕ 로 옮기면 바로 바꿔 띄우며 Esc 와 chord 키로 닫는다', async ({
  launch
}) => {
  const { page } = await launch()
  await run(page, "maru job new --name build sh -c 'exit  3' && echo started-$((1+1))", 'started-2')
  const job = page.locator('.sidebar .job-row.exited')
  const tooltip = page.getByRole('tooltip')

  await job.locator('.title').hover()
  await expect(tooltip).toBeVisible()
  expect(await tooltip.evaluate((e) => e.matches(':popover-open'))).toBe(true)
  // 명령의 연속 공백도 그대로 보인다.
  expect(await tooltip.evaluate((e) => (e as HTMLElement).innerText)).toBe(
    'sh -c exit  3\nExited with code 3'
  )
  await expect(job).toHaveAttribute('aria-describedby', 'app-tooltip')

  await job.locator('.kill').hover()
  await expect(tooltip).toHaveText('Remove', { timeout: 100 })
  await expect(job).not.toHaveAttribute('aria-describedby', /./)

  await page.keyboard.press('Escape')
  await expect(tooltip).toBeHidden()

  // ⌘J 뒤에 기다리는 두 번째 키는 `App.vue` 가 window 에서 멈춘다. 이 키를 눌러도 tooltip 이 닫히는지 확인한다.
  await page.mouse.move(0, 0)
  await page.keyboard.press('Meta+KeyJ')
  await job.locator('.title').hover()
  await expect(tooltip).toBeVisible()
  await page.keyboard.press('KeyX')
  await expect(tooltip).toBeHidden()
})

test('커서를 둔 사이드바 줄이 위 cell 에 생긴 job 줄에 밀려 내려가면, tooltip 을 커서 아래 요소의 것으로 바꾼다', async ({
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
  const tooltip = page.getByRole('tooltip')

  const box = (await row.boundingBox())!
  const x = box.x + 20
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await expect(tooltip).toBeVisible()
  await expect(row).toHaveAttribute('aria-describedby', 'app-tooltip')

  // 키를 누르면 tooltip 이 닫히므로, 위 cell 의 셸이 기다리던 파일을 만들어 job 을 띄운다.
  writeFileSync(go, '')
  await expect(cellGroups(page).nth(0).locator('.job-row')).toHaveCount(1)
  const moved = (await row.boundingBox())!
  expect(moved.y).toBeGreaterThan(y)

  await expect(row).not.toHaveAttribute('aria-describedby', /./)
  await expect(async () => {
    const { tip, under } = await page.evaluate(
      ([x, y]) => {
        const el = document
          .elementsFromPoint(x, y)
          .find((e): e is HTMLElement => e instanceof HTMLElement && !!e.dataset.tooltip)
        const box = document.getElementById('app-tooltip')
        return {
          tip: box?.matches(':popover-open') ? box.innerText : null,
          under: el?.dataset.tooltip ?? null
        }
      },
      [x, y]
    )
    expect(tip).toBe(under)
  }).toPass({ timeout: 2000 })
})
