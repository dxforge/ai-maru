import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cellItems,
  dialogCalls,
  expect,
  panes,
  programStatus,
  run,
  screen,
  shellValue,
  sockets,
  split,
  stubDialog,
  test
} from './app'

const CELL_ID = expect.stringMatching(/^c-[0-9a-f]{8}$/)

test('maru pty list 는 pane 의 pty 를 화면 순서대로, 그 뒤에 job 을 띄운 순서대로 찍고, 끝난 job 은 EXIT 에 종료 코드를 찍는다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const first = await shellValue(page, dataDir, 'first', '$MARU_PTY_ID')
  await split(app, page, 'split-right', 2)
  const second = await shellValue(page, dataDir, 'second', '$MARU_PTY_ID')
  const sleeper = await shellValue(
    page,
    dataDir,
    'sleeper',
    '$(maru job new --name sleeper sleep 600)'
  )
  const quick = await shellValue(
    page,
    dataDir,
    'quick',
    `$(maru job new --name quick sh -c 'exit 3')`
  )
  const out = join(dataDir, 'ptys.out')
  await run(
    page,
    `until maru pty list | awk -F'\\t' '$7 == "quick" && $6 == "3"' | grep -q .; do sleep 0.1; done; maru pty list >${out}; echo listed-$?`,
    'listed-0'
  )
  const table = readFileSync(out, 'utf8')
    .split('\n')
    .slice(0, -1)
    .map((l) => l.split('\t'))
  const [, [, , workspace, cell]] = table
  const any = expect.any(String)
  expect(table).toEqual([
    ['PTY', 'KIND', 'WORKSPACE', 'CELL', 'STATE', 'EXIT', 'NAME', 'DIR'],
    [first, 'pane', workspace, CELL_ID, '', '', any, any],
    [second, 'pane', workspace, cell, '', '', any, any],
    [sleeper, 'job', workspace, cell, '', '', 'sleeper', any],
    [quick, 'job', workspace, cell, '', '3', 'quick', any]
  ])
})

test('job 이 OSC 7501 로 알린 상태를 maru pty list 의 STATE 에 찍는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const script = join(dataDir, 'status.sh')
  writeFileSync(script, `${programStatus('done')}sleep 600\n`)
  await run(
    page,
    `maru job new --name st sh ${script} >/dev/null; until maru pty list | awk -F'\\t' '$7 == "st" && $5 == "done"' | grep -q .; do sleep 0.1; done; echo seen-$((1+1))`,
    'seen-2'
  )
})

test('maru pty send 로 pane 과 job 의 pty 에 글자를 쓰고 maru pty read 로 그 화면을 읽는다', async ({
  launch
}) => {
  const { page } = await launch()
  // `pane new` 의 답이 창의 layout 보다 먼저 오면 바로 뒤의 read 가 no pty 로 실패한다.
  await page.keyboard.type(
    `ID=$(maru pane new | awk 'NR == 2 { print $2 }'); maru pty read "$ID" >/dev/null; echo "new-$?"\n`
  )
  await expect(panes(page)).toHaveCount(2)
  await expect(screen(page)).toShow('new-0')
  await run(
    page,
    `maru pty send "$ID" $'echo sent-$((1+1))\\r'; until maru pty read "$ID" | grep -qx sent-2; do sleep 0.2; done; echo read-$((1+1))`,
    'read-2'
  )
  await expect(screen(page, 1)).toShow('sent-2')

  await run(
    page,
    `clear; J=$(maru job new sh -c 'while read l; do echo "got-$l"; done'); maru pty send "$J" "hi-$((1+1))"$'\\r'; until maru pty read "$J" | grep -qx got-hi-2; do sleep 0.2; done; echo job-$((1+1))`,
    'job-2'
  )
})

test('maru pty kill 은 묻지 않고, pane 의 pty 면 그 pane 을, cell 의 마지막 pane 이면 그 cell 과 cell 의 job 을, job 의 pty 면 그 job 을 끝낸다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  await stubDialog(app, 1)
  await page.keyboard.type(`ID=$(maru pane new sleep 600 | awk 'NR == 2 { print $2 }')\n`)
  await expect(panes(page)).toHaveCount(2)
  await run(page, 'maru pty kill "$ID"; echo killed-$?', 'killed-0')
  await expect(panes(page)).toHaveCount(1)

  await run(
    page,
    'clear; J=$(maru job new --name sleeper sleep 600); maru pty kill "$J"; maru job list',
    'no jobs'
  )

  await run(
    page,
    `clear; C=$(maru cell new bash -c 'maru job new --name inner sleep 600 >/dev/null; read x' | awk 'NR == 2 { print $2 }'); echo made-$?`,
    'made-0'
  )
  await expect(cellItems(page)).toHaveCount(2)
  await run(
    page,
    `until maru pty list | awk -F'\\t' '$7 == "inner"' | grep -q .; do sleep 0.1; done; maru pty kill "$C"; echo killed-$((1+1))`,
    'killed-2'
  )
  await expect(cellItems(page)).toHaveCount(1)
  await expect.poll(() => sockets(dataDir).length).toBe(1)
  expect(await dialogCalls(app)).toEqual([])
})
