import { spawnSync } from 'node:child_process'
import {
  clickMenu,
  DOM_RENDERER,
  expect,
  hostPid,
  panes,
  rows,
  screen,
  split,
  stubDialog,
  test,
  typesInto
} from './app'

const FLOOD_MS = 3000

function hostSockets(pid: number): number {
  const out = spawnSync('lsof', ['-a', '-p', String(pid), '-U', '-F', 'f']).stdout.toString()
  return out.split('\n').filter((line) => line.startsWith('f')).length
}

test('출력이 쏟아지는 pane 을 닫으면 pty host 가 그 pty 의 소켓을 닫는다', async ({ launch }) => {
  const { app, page } = await launch()
  await page.keyboard.type('echo ready-$((1+1))\n')
  await expect(screen(page)).toShow('ready-2')
  const host = await hostPid(app)
  const before = hostSockets(host)
  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'second')
  await expect.poll(() => hostSockets(host)).toBe(before + 1)

  await page.keyboard.type('yes\n')
  await page.waitForTimeout(500)
  await stubDialog(app, 0)
  await clickMenu(app, 'close-pane')
  await expect(panes(page)).toHaveCount(1)

  await expect.poll(() => hostSockets(host), { timeout: 5000 }).toBe(before)
})

test('출력이 쏟아지는 동안에도 main 과 renderer 가 막히지 않고 Ctrl-C 가 먹는다', async ({
  launch
}) => {
  // Ctrl-C 뒤 renderer 가 프롬프트를 그리기까지를 재므로 DOM renderer 가 그린 행에서 읽는다.
  const { app: a, page } = await launch(DOM_RENDERER)
  await page.keyboard.type('echo ready-$((1+1))\n')
  await expect(screen(page)).toShow('ready-2')

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
  await expect(rows(page)).toContainText('done-5', { timeout: 30_000 })
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
  expect(report.interruptToPromptMs).toBeLessThan(1000)
})
