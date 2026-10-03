import { expect, gridRows, resizeBy, rows, test } from './app'

// 산술 확장을 쓰면 화면에 찍힌 입력과 셸의 출력이 구별된다.

test('키 입력이 셸에 가고 셸의 출력이 터미널에 뜬다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('echo out-$((1+2))\n')
  await expect(rows(page)).toContainText('out-3')
})

test('앱을 다시 켜면 같은 셸에 다시 붙어 화면을 이어 받는다', async ({ launch }) => {
  const first = await launch()
  await first.page.keyboard.type('X=kept-$((40+2)); echo before-$((1+1))\n')
  await expect(rows(first.page)).toContainText('before-2')
  await first.app.close()

  const { page } = await launch()
  await expect(rows(page)).toContainText('before-2')
  await page.keyboard.type('echo $X\n')
  await expect(rows(page)).toContainText('kept-42')
})

test('대체 화면 위에서 앱을 다시 켜도, 그 프로그램이 끝나면 일반 화면이 돌아온다', async ({
  launch
}) => {
  const first = await launch()
  await first.page.keyboard.type(
    "echo main-$((1+1)); printf '\\033[?1049h\\033[Halt-%s' $((2+2)); read; printf '\\033[?1049l'\n"
  )
  await expect(rows(first.page)).toContainText('alt-4')
  await first.app.close()

  const { page } = await launch()
  await expect(rows(page)).toContainText('alt-4')
  await page.keyboard.press('Enter')
  await expect(rows(page)).toContainText('main-2')
  await expect(rows(page)).not.toContainText('alt-4')
})

test('창 크기를 바꾸면 셸이 보는 크기도 바뀐다', async ({ launch }) => {
  const { app, page } = await launch()
  let n = 0
  const sttySize = async () => {
    const marker = `size${++n}`
    await page.keyboard.type(`clear; echo ${marker}=$(stty size | tr ' ' x)\n`)
    const re = new RegExp(`${marker}=(\\d+)x(\\d+)`)
    let m: RegExpMatchArray | null = null
    await expect.poll(async () => (m = (await rows(page).innerText()).match(re))).not.toBeNull()
    return { rows: Number(m![1]), cols: Number(m![2]) }
  }
  const before = await sttySize()
  expect(before.rows).toBe(await gridRows(page).count())

  await resizeBy(app, 200, 180)
  await expect.poll(async () => (await sttySize()).rows).toBeGreaterThan(before.rows)
  const after = await sttySize()
  expect(after.rows).toBe(await gridRows(page).count())
  expect(after.cols).toBeGreaterThan(before.cols)
})

test('셸이 끝나면 창이 닫히고 앱이 끝난다', async ({ launch }) => {
  const { app, page } = await launch()
  const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
  await page.keyboard.type('exit\n')
  await closed
})

test('maru-session 을 띄울 수 없으면 터미널에 이유를 보인다', async ({ launch }) => {
  const { page } = await launch({ MARU_SESSION_BIN: '/nonexistent/maru-session' })
  await expect(rows(page)).toContainText('open_failed')
})
