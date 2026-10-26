import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  clickMenu,
  expect,
  newWorkspace,
  restartWith,
  rows,
  run,
  sockets,
  stubDialog,
  test,
  cellItems
} from './app'

/** 그 pane 의 claude 와 같은 알림을 받는다. */
async function monitorInto(page: Page, file: string): Promise<void> {
  await page.keyboard.type(`"$MARU_CLI" claude monitor | cat >> ${file} &\n`)
}

function jobEvents(file: string): object[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { event: string })
    .filter((e) => e.event === 'job')
}

const exited = (name: string, code: number) =>
  expect.objectContaining({ event: 'job', name, code, signal: null })

const untilExited = (name: string): string =>
  `until maru job list | awk '$2=="${name}" && $3=="exited"' | grep -q .; do sleep 0.1; done`

test('pane 에서 job 을 띄우고, 목록·출력·입력·끝내기를 한다', async ({ launch, dataDir }) => {
  const { page } = await launch()
  await run(
    page,
    `echo id=$(maru job new --name echo sh -c 'while read l; do echo "got-$l"; done')`,
    /id=p-[0-9a-f]{8}/
  )
  await run(page, 'maru job list', /echo\s+running\s+sh -c 'while read l/)
  expect(sockets(dataDir)).toHaveLength(2)
  await run(page, 'maru job send echo hi-$((1+1)); sleep 0.5; maru job read echo', 'got-hi-2')
  await run(page, 'maru job kill echo; maru job list', 'no jobs')
  expect(sockets(dataDir)).toHaveLength(1)
})

test('스스로 끝난 job 은 띄운 pane 에 알리고 출력과 함께 목록에 남는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const events = join(dataDir, 'events')
  await monitorInto(page, events)
  // monitor 가 구독하기 전에 끝나면 보류 경로를 지나므로 잠시 기다린다.
  await run(page, `sleep 1; maru job new --name x sh -c 'echo out-$((1+1)); exit 3'`, /p-/)
  await expect.poll(() => jobEvents(events)).toEqual([exited('x', 3)])
  await run(page, 'maru job list', /x\s+exited 3/)
  await run(page, 'maru job read x', 'out-2')
  await run(page, 'maru job new --name y no-such-command-$((1+1))', /p-/)
  await expect.poll(() => jobEvents(events)).toContainEqual(exited('y', 127))
  await run(page, 'maru job list', /y\s+exited 127/)
})

test('monitor 없이 끝난 job 의 알림은 나중에 붙은 monitor 가 한 번 받는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const events = join(dataDir, 'events')
  await run(
    page,
    `maru job new --name z sh -c 'exit 4'; ${untilExited('z')}; maru job list`,
    /z\s+exited 4/
  )
  await monitorInto(page, events)
  await expect.poll(() => jobEvents(events)).toEqual([exited('z', 4)])
  await monitorInto(page, events)
  await run(page, 'sleep 1; echo waited-$((1+1))', 'waited-2')
  expect(jobEvents(events)).toHaveLength(1)
})

test('같은 이름은 돌고 있으면 거절하고, 끝났으면 갈아 끼운다', async ({ launch }) => {
  const { page } = await launch()
  await run(
    page,
    'maru job new --name d sleep 100 >/dev/null; maru job new --name d sleep 100; echo code-$?',
    'code-1'
  )
  await expect(rows(page)).toContainText('job d is running in this cell')
  await run(
    page,
    `maru job new --name e sh -c 'exit 0' >/dev/null; ${untilExited('e')}; maru job new --name e sh -c 'exit 5' >/dev/null; ${untilExited('e')}; echo rows=$(maru job list | awk '$2=="e"' | wc -l | tr -d ' ')`,
    'rows=1'
  )
  await run(page, 'maru job list', /e\s+exited 5/)
})

test('다른 cell 의 job 은 보이지 않고, 마지막 pane 을 닫은 cell 의 job 만 끝난다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  await run(page, 'maru job new --name a sleep 100; echo first-$((1+1))', 'first-2')
  await newWorkspace(launched, 2)
  await run(page, 'maru job list', 'no jobs')
  await run(page, 'maru job read a', 'no job a in this cell')
  await run(page, 'maru job new --name b sleep 100; echo second-$((1+1))', 'second-2')
  expect(sockets(dataDir)).toHaveLength(4)

  await cellItems(page).nth(0).click()
  await clickMenu(app, 'close-pane')
  await expect(cellItems(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir).length).toBe(2)
  await page.locator('.terminal-view.active .xterm-screen').click()
  await run(page, 'maru job list', /b\s+running/)
})

test('스크롤백을 넘치게 찍은 job 도 read 가 답한다', async ({ launch }) => {
  const { page } = await launch()
  await run(
    page,
    `maru job new --name big seq 1 200000 >/dev/null; ${untilExited('big')}; maru job read big | tail -n 1 | sed 's/^/last=/'`,
    'last=200000'
  )
})

test('재시작 뒤 job 이 남고, 재시작 동안 끝난 job 의 알림이 다시 붙은 monitor 에 한 번 닿는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const events = join(dataDir, 'events')
  const go = join(dataDir, 'go')
  await monitorInto(page, events)
  await run(
    page,
    `maru job new --name keep sleep 100; maru job new --name late sh -c 'while [ ! -e ${go} ]; do sleep 0.1; done; exit 7'; echo started-$((1+1))`,
    'started-2'
  )
  await restartWith(app)
  writeFileSync(go, '')
  const { app: again, page: shown } = await launch()
  await expect.poll(() => jobEvents(events), { timeout: 15_000 }).toEqual([exited('late', 7)])
  await shown.locator('.xterm-screen').click()
  await run(shown, 'maru job list', /keep\s+running/)
  await expect(rows(shown)).toContainText(/late\s+exited 7/)
  expect(jobEvents(events)).toHaveLength(1)
  await stubDialog(again, 0)
  await again.close()
  expect(sockets(dataDir)).toEqual([])
})

test('앱을 끝내면 job 도 끝난다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await run(page, 'maru job new --name a sleep 100; echo up-$((1+1))', 'up-2')
  expect(sockets(dataDir)).toHaveLength(2)
  await stubDialog(app, 0)
  await app.close()
  expect(sockets(dataDir)).toEqual([])
})
