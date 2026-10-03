import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

let app: ElectronApplication

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'] })
  await (await app.firstWindow()).waitForSelector('.xterm-screen')
})

test.afterEach(async () => {
  await app.close()
})

async function measure() {
  return (await app.firstWindow()).evaluate(() => {
    const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect()
    const rows = document.querySelector('.xterm-rows')!.children.length
    return {
      winWidth: innerWidth,
      winHeight: innerHeight,
      width: screen.width,
      height: screen.height,
      rows,
      cellHeight: screen.height / rows
    }
  })
}

async function setContentSize(width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h),
    [width, height]
  )
}

function expectFilled(m: Awaited<ReturnType<typeof measure>>) {
  expect(m.width).toBeLessThanOrEqual(m.winWidth)
  expect(m.height).toBeLessThanOrEqual(m.winHeight)
  expect(m.winHeight - m.height).toBeLessThan(m.cellHeight)
}

test('창을 열면 터미널이 창의 높이를 줄 단위로 채운다', async () => {
  expectFilled(await measure())
})

for (const [label, dw, dh] of [
  ['키우면', 200, 180],
  ['줄이면', -200, -180]
] as const) {
  test(`창을 ${label} 터미널이 같은 만큼 따라간다`, async () => {
    const before = await measure()
    await setContentSize(before.winWidth + dw, before.winHeight + dh)
    await expect.poll(async () => (await measure()).rows).not.toBe(before.rows)
    const after = await measure()

    expect(after.winWidth).toBe(before.winWidth + dw)
    expectFilled(after)
    // 열 수의 증감은 창 너비의 증감과 한 칸 안쪽으로 맞아야 한다 — 칸 너비는 칸 높이보다 작다.
    expect(Math.abs(after.width - before.width - dw)).toBeLessThan(after.cellHeight)
  })
}
