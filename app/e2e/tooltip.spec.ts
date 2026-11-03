import { expect, run, test } from './app'

test('사이드바 job 줄에 마우스를 올리면 명령과 종료 코드를 두 줄로 띄우고, ✕ 로 옮기면 바로 바꿔 띄우며 Esc 로 닫는다', async ({
  launch
}) => {
  const { page } = await launch()
  await run(page, "maru job new --name build sh -c 'exit 3' && echo started-$((1+1))", 'started-2')
  const job = page.locator('.sidebar .job-row.exited')
  const tooltip = page.getByRole('tooltip')

  await job.locator('.title').hover()
  await expect(tooltip).toBeVisible()
  expect(await tooltip.evaluate((e) => e.matches(':popover-open'))).toBe(true)
  expect(await tooltip.evaluate((e) => (e as HTMLElement).innerText)).toBe(
    'sh -c exit 3\nExited with code 3'
  )
  await expect(job).toHaveAttribute('aria-describedby', 'app-tooltip')

  await job.locator('.kill').hover()
  await expect(tooltip).toHaveText('Remove', { timeout: 100 })
  await expect(job).not.toHaveAttribute('aria-describedby', /./)

  await page.keyboard.press('Escape')
  await expect(tooltip).toBeHidden()
})
