import { expect, rows, test } from './app'

const FLOOD_MS = 3000

test('출력이 쏟아지는 동안에도 main 과 renderer 가 막히지 않고 Ctrl-C 가 먹는다', async ({
  launch
}) => {
  const { app: a, page } = await launch()
  await page.keyboard.type('echo ready-$((1+1))\n')
  await expect(rows(page)).toContainText('ready-2')

  await a.evaluate(() => {
    const g = globalThis as unknown as { lag: number[]; lagTimer: NodeJS.Timeout }
    g.lag = []
    let last = performance.now()
    g.lagTimer = setInterval(() => {
      const now = performance.now()
      g.lag.push(now - last - 10)
      last = now
    }, 10)
  })
  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; stopFrames: boolean }
    w.frames_ = []
    w.stopFrames = false
    let last = performance.now()
    const tick = (now: number) => {
      w.frames_.push(now - last)
      last = now
      if (!w.stopFrames) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  await page.keyboard.type('yes\n')
  // 출력이 쏟아지는 동안 main 이 창 이동을 처리하는지 — 드래그 대신 위치를 거듭 옮긴다.
  const moves: number[] = []
  const end = Date.now() + FLOOD_MS
  while (Date.now() < end) {
    const t = Date.now()
    await a.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [x, y] = win.getPosition()
      win.setPosition(x + 1, y)
    })
    moves.push(Date.now() - t)
  }

  const interruptAt = Date.now()
  await page.keyboard.press('Control+C')
  await page.keyboard.type('echo done-$((2+3))\n')
  await expect(rows(page)).toContainText('done-5', { timeout: 10_000 })
  const interruptMs = Date.now() - interruptAt

  const mainLag = await a.evaluate(() => {
    const g = globalThis as unknown as { lag: number[]; lagTimer: NodeJS.Timeout }
    clearInterval(g.lagTimer)
    return g.lag
  })
  const frames = await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; stopFrames: boolean }
    w.stopFrames = true
    return w.frames_
  })

  const p = (xs: number[], q: number) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length * q)]
  const report = {
    mainLagMs: { p50: p(mainLag, 0.5), p99: p(mainLag, 0.99), max: Math.max(...mainLag) },
    frameMs: { p50: p(frames, 0.5), p99: p(frames, 0.99), max: Math.max(...frames) },
    moveRoundTripMs: { p50: p(moves, 0.5), max: Math.max(...moves), count: moves.length },
    interruptToPromptMs: interruptMs
  }
  test.info().annotations.push({ type: 'flood', description: JSON.stringify(report) })
  console.log(JSON.stringify(report))

  expect(report.mainLagMs.max).toBeLessThan(100)
  expect(report.moveRoundTripMs.max).toBeLessThan(200)
  expect(report.frameMs.p99).toBeLessThan(100)
  expect(interruptMs).toBeLessThan(3000)
})
