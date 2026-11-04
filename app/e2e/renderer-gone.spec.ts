import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { readRecord } from '../src/main/pty'
import {
  answerDialog,
  dialogCalls,
  expect,
  holdDialogs,
  panes,
  ptyDir,
  restartWith,
  run,
  sockets,
  split,
  test
} from './app'

async function crashRenderer(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
  )
}

async function shellPids(dataDir: string): Promise<(number | undefined)[]> {
  return Promise.all(
    sockets(dataDir).map(
      async (s) => (await readRecord(ptyDir(dataDir), basename(s, '.sock')))?.pid
    )
  )
}

test('renderer 가 죽으면 한 번 묻고, Restart 를 고르면 배치를 되살려 같은 셸에 다시 붙는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await run(page, 'X=kept-$((40+2)); echo set-$((1+1))', 'set-2')
  const before = sockets(dataDir)
  const pids = await shellPids(dataDir)
  expect(before).toHaveLength(2)

  await holdDialogs(app)
  await crashRenderer(app)
  await expect.poll(() => dialogCalls(app).then((c) => c.length)).toBe(1)
  expect((await dialogCalls(app))[0].buttons).toEqual(['Restart', 'Quit'])
  await restartWith(app, () => answerDialog(app, 0, 0))

  const { page: again } = await launch()
  await expect(panes(again)).toHaveCount(2)
  await run(again, 'echo "x=$X"', 'x=kept-42')
  expect(sockets(dataDir)).toEqual(before)
  expect(await shellPids(dataDir)).toEqual(pids)
  for (const pid of pids) expect(() => process.kill(pid!, 0)).not.toThrow()
})

test('renderer 가 죽어 대화창을 기다리는 동안 온 maru canvas put 은 죽은 창에 넘기지 않고 실패로 답한다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const doc = join(dataDir, 'doc.md')
  writeFileSync(doc, '# Doc\n')
  const out = join(dataDir, 'canvas-put')
  await run(
    page,
    `(sleep 1; "$MARU_CLI" canvas put --title t '${doc}' >/dev/null 2>&1; echo "code=$?" > '${out}') & echo bg-$((1+1))`,
    'bg-2'
  )
  await holdDialogs(app)
  await crashRenderer(app)
  await expect
    .poll(() => (existsSync(out) ? readFileSync(out, 'utf8').trim() : null), { timeout: 15_000 })
    .toMatch(/^code=[1-9]/)
  await answerDialog(app, 0, 1)
  await expect.poll(() => dialogCalls(app).then((c) => c.length)).toBe(2)
  const closed = app.waitForEvent('close')
  await answerDialog(app, 1, 0)
  await closed
})

test('renderer 가 죽은 뒤 Quit 을 고르면 끄기 대화창으로 간다', async ({ launch }) => {
  const { app } = await launch()
  await holdDialogs(app)
  await crashRenderer(app)
  await expect.poll(() => dialogCalls(app).then((c) => c.length)).toBe(1)
  await answerDialog(app, 0, 1)
  await expect.poll(() => dialogCalls(app).then((c) => c.length)).toBe(2)
  expect((await dialogCalls(app))[1].message).toBe('Quit AI Maru?')
  const closed = app.waitForEvent('close')
  await answerDialog(app, 1, 0)
  await closed
})
