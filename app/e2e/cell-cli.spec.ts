import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  cellItems,
  cellViews,
  expect,
  failingCommandPtyBin,
  marked,
  newWorkspace,
  restartWith,
  rows,
  run,
  test,
  toggleView,
  workspaceNames
} from './app'

// cell 의 순서는 각 cell 에 찍힌 `mark-<name>` 으로 확인한다. 사이드바 이름은 OSC 7 로 바꿀 수 있지만, pty 가
// renderer 에 붙기 전에 보낸 OSC 7 은 renderer 에 닿지 않는다.

async function expectOrder(page: Page, marks: (string | null)[]): Promise<void> {
  const views = cellViews(page)
  await expect(views).toHaveCount(marks.length)
  await expect(cellItems(page)).toHaveCount(marks.length)
  for (const [i, mark] of marks.entries()) {
    if (mark) await expect(views.nth(i).locator('.xterm-rows')).toContainText(`mark-${mark}`)
  }
}

test('maru cell new 는 부른 cell 뒤에 cell 을 더해 명령을 띄우고 머리 줄과 함께 pty id 와 cell id 를 찍으며, 선택과 포커스는 부른 쪽에 남는다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(
    `echo "got=[$(maru cell new bash -c 'echo "me=[$MARU_PTY_ID]"; read x' | tr '\\t\\n' '|/')]"\n`
  )
  await expect(cellItems(page)).toHaveCount(2)
  await expect(workspaceNames(page)).toHaveCount(1)
  const got = /got=\[PTY\|CELL\/(p-[0-9a-f]{8})\|(c-[0-9a-f]{8})\/\]/
  await expect(rows(page)).toContainText(got)
  const [, pty, cell] = (await rows(page).innerText()).match(got)!
  await expect(cellViews(page).nth(1).locator('.xterm-rows')).toContainText(`me=[${pty}]`)
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
  await expect(cellViews(page).nth(1)).not.toHaveClass(/selected/)
  await run(
    page,
    `clear; maru pane list | awk -F'\\t' '$1 == "${pty}" { print "listed=[" $5 "]" }'`,
    `listed=[${cell}]`
  )
})

test('부른 cell 바로 뒤에 놓이고, columns 에서는 그 오른쪽에 놓인다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await cellItems(page).nth(0).click()
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)

  await page.keyboard.type(`maru cell new ${marked('a')} >/dev/null\n`)
  await expectOrder(page, [null, 'a', null])
  await expect(workspaceNames(page)).toHaveCount(2)
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)

  await toggleView(launched, 'columns')
  const views = cellViews(page)
  const xs = []
  for (let i = 0; i < 3; i++) xs.push((await views.nth(i).boundingBox())!.x)
  expect(xs).toEqual([...xs].sort((a, b) => a - b))
  expect(new Set(xs).size).toBe(3)
  await run(page, 'echo still-$((1+1))', 'still-2')
})

test('재시작한 뒤에도 부른 cell 바로 뒤에 놓는다', async ({ launch }) => {
  const { app, page } = await launch()
  await page.keyboard.type(`maru cell new ${marked('a1')} >/dev/null\n`)
  await expectOrder(page, [null, 'a1'])

  await restartWith(app)
  const { page: again } = await launch()
  await expectOrder(again, [null, 'a1'])
  await expect(workspaceNames(again)).toHaveCount(1)
  await again.keyboard.type(`maru cell new ${marked('a2')} >/dev/null\n`)
  await expectOrder(again, [null, 'a2', 'a1'])
  await expect(workspaceNames(again)).toHaveCount(1)
})

test('--after 는 가리킨 pane 의 cell 바로 뒤에 놓는다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await cellItems(page).nth(0).click()
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)

  await page.keyboard.type(`A=$(maru cell new ${marked('a')} | awk 'NR == 2 { print $1 }')\n`)
  await expectOrder(page, [null, 'a', null])
  await page.keyboard.type(`maru cell new --after $A ${marked('b')} >/dev/null\n`)
  await expectOrder(page, [null, 'a', 'b', null])
  await expect(workspaceNames(page)).toHaveCount(2)
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
})

test('--after 가 다른 workspace 의 pane 이면 cell 을 열지 않고 실패한다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { page } = launched
  const saved = join(dataDir, 'first-pty')
  await run(page, `echo $MARU_PTY_ID > '${saved}'; echo saved-$((1+1))`, 'saved-2')
  await newWorkspace(launched, 2)
  await run(page, `clear; maru cell new --after $(cat '${saved}') true; echo "code-$?"`, 'code-1')
  await expect(rows(page)).toContainText('not in the workspace')
  await expect(cellItems(page)).toHaveCount(2)
  await expect(workspaceNames(page)).toHaveCount(2)
})

test('명령이 끝나면 cell 이 닫히고, 곧바로 끝나는 명령도 pty id 와 cell id 를 찍고 성공한다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(`maru cell new sh -c 'sleep 1; exit 3'\n`)
  await expect(cellItems(page)).toHaveCount(2)
  await expect(cellItems(page)).toHaveCount(1)
  await expect(workspaceNames(page)).toHaveCount(1)
  for (const command of ['true', 'no-such-command-xyz']) {
    await page.keyboard.type(`clear; maru cell new ${command}; echo "code-$?"\n`)
    await expect(rows(page)).toContainText(/p-[0-9a-f]{8}\s+c-[0-9a-f]{8}\s*code-0/)
    await expect(cellItems(page)).toHaveCount(1)
  }
})

test('명령이 끝나 workspace 의 마지막 cell 이 닫히면 workspace 도 닫힌다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await page.keyboard.type(`maru cell new sh -c 'sleep 5' >/dev/null\n`)
  await expect(cellItems(page)).toHaveCount(3)
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(2)
  await expect(workspaceNames(page)).toHaveCount(2)
  await expect(cellItems(page)).toHaveCount(1, { timeout: 10_000 })
  await expect(workspaceNames(page)).toHaveCount(1)
})

test('명령 없이 띄운 cell 은 셸이고, maru pane close 로 닫는다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(`ID=$(maru cell new | awk 'NR == 2 { print $1 }')\n`)
  await expect(cellItems(page)).toHaveCount(2)
  await cellItems(page).nth(1).click()
  await run(page, 'echo shell-$((1+1))', 'shell-2')
  await cellItems(page).nth(0).click()
  await run(page, 'maru pane close $ID; echo closed-$?', 'closed-0')
  await expect(cellItems(page)).toHaveCount(1)
})

test('job 에서 부르면 그 job 의 cell 바로 뒤에 놓는다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await cellItems(page).nth(0).click()
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
  await page.keyboard.type(`maru cell new ${marked('p')} >/dev/null\n`)
  await expectOrder(page, [null, 'p', null])
  await page.keyboard.type(`maru job new --name opener maru cell new ${marked('j')}\n`)
  await expectOrder(page, [null, 'j', 'p', null])
  await expect(workspaceNames(page)).toHaveCount(2)
  await expect(cellViews(page).nth(0)).toHaveClass(/selected/)
})

test('띄운 cell 에서 연 job 은 그 cell 에 속한다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(
    `maru cell new bash -c 'maru job new --name mate-job sleep 100 >/dev/null; maru job list; read x' >/dev/null\n`
  )
  const other = cellViews(page).nth(1).locator('.xterm-rows')
  await expect(other).toContainText(/mate-job\s+running/)
  await run(page, 'maru job list', 'no jobs')
})

test('pty 를 띄우지 못하면 cell 을 닫고 maru cell new 가 이유와 함께 실패한다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch({ MARU_PTY_BIN: failingCommandPtyBin(dataDir) })
  await page.keyboard.type('maru cell new true; echo code-$?\n')
  await expect(rows(page)).toContainText('boom-2')
  await expect(rows(page)).toContainText('code-1')
  await expect(cellItems(page)).toHaveCount(1)
})
