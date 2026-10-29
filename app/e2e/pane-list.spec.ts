import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  expect,
  newWorkspace,
  paneRows,
  programStatus,
  rows,
  run,
  split,
  test,
  typesInto,
  workspaceNames
} from './app'

async function ptyIdOf(page: Page, prefix = ''): Promise<string> {
  await run(page, `${prefix}clear; echo id=[$MARU_PTY_ID]`, /id=\[p-[0-9a-f]{8}\]/)
  return (await rows(page).innerText()).match(/id=\[(p-[0-9a-f]{8})\]/)![1]
}

/** e2e 의 bash 는 cd 를 OSC 7 로 알리지 않으므로 직접 보낸다. */
async function enter(page: Page, dir: string): Promise<string> {
  mkdirSync(dir)
  return ptyIdOf(page, `cd ${dir}; printf '\\e]7;file://%s\\a' "$PWD"; `)
}

const base64 = (text: string): string => Buffer.from(text).toString('base64')

async function paneList(page: Page, out: string): Promise<string[][]> {
  await run(page, `maru pane list >${out}; echo listed-$?`, 'listed-0')
  const lines = readFileSync(out, 'utf8').split('\n')
  expect(lines.at(-1)).toBe('')
  return lines.slice(0, -1).map((l) => l.split('\t'))
}

const HEADER = ['PTY', 'STATE', 'APP', 'WORKSPACE', 'CELL', 'TITLE', 'DIR', 'MESSAGE']

const CELL_ID = expect.stringMatching(/^c-[0-9a-f]{8}$/)

const sidebarTitles = (page: Page) => page.locator('.sidebar .pane-row .title').allInnerTexts()

test('레코드가 없는 pane 만 있어도 maru pane list 는 그 pane 을 빈 STATE·APP·MESSAGE 와 사이드바의 이름으로 찍는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const me = await enter(page, join(dataDir, 'solo'))
  const table = await paneList(page, join(dataDir, 'panes.out'))
  expect(table).toEqual([
    HEADER,
    [me, '', '', 'solo', CELL_ID, expect.any(String), expect.stringMatching(/\/solo$/), '']
  ])
  expect([table[1][5]]).toEqual(await sidebarTitles(page))
})

test('홈 디렉토리 workspace 의 WORKSPACE 는 사이드바처럼 ~ 다', async ({ launch, dataDir }) => {
  const home = join(dataDir, 'home')
  mkdirSync(home)
  const { page } = await launch({ HOME: home })
  await ptyIdOf(page, `cd ~; printf '\\e]7;file://%s\\a' "$PWD"; `)
  await expect(workspaceNames(page).nth(0)).toHaveText('~')
  const [, cols] = await paneList(page, join(dataDir, 'panes.out'))
  expect(cols[3]).toBe('~')
})

test('maru pane list 는 레코드가 있는 pane 과 없는 pane 을 화면 순서대로, 사이드바의 이름과 함께 TSV 로 찍는다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  const first = await enter(page, join(dataDir, 'proj-a'))
  await expect(workspaceNames(page).nth(0)).toHaveText('proj-a')
  await page.keyboard.type(
    programStatus('blocked', `kind=permission:msg=${base64('Bash: git push -u origin x')}`)
  )
  await expect(paneRows(page)).toHaveClass(/blocked/)

  await split(app, page, 'split-right', 2)
  await typesInto(page, 1, 'second')
  const plain = await ptyIdOf(page)

  await newWorkspace(launched, 2)
  const second = await enter(page, join(dataDir, 'proj-b'))
  await expect(workspaceNames(page).nth(1)).toHaveText('proj-b')
  await page.keyboard.type(programStatus('working', `msg=${base64('reading')}`, 'cargo'))
  await expect(paneRows(page).nth(1)).toHaveClass(/working/)

  const table = await paneList(page, join(dataDir, 'panes.out'))
  const dir = (name: string) => expect.stringMatching(new RegExp(`/${name}$`))
  expect(table).toEqual([
    HEADER,
    [
      first,
      'blocked(permission)',
      'claude-code',
      'proj-a',
      CELL_ID,
      'Claude',
      dir('proj-a'),
      'Bash: git push -u origin x'
    ],
    [plain, '', '', 'proj-a', CELL_ID, expect.any(String), expect.any(String), ''],
    [second, 'working', 'cargo', 'proj-b', CELL_ID, 'cargo', dir('proj-b'), 'reading']
  ])
  expect(table.slice(1).map((r) => r[5])).toEqual(await sidebarTitles(page))
  expect(table[2][4]).toBe(table[1][4])
  expect(table[3][4]).not.toBe(table[1][4])
})

test('레코드가 있는 pane 의 TITLE 은 터미널 제목이 있으면 그 제목이고 사이드바의 이름과 같다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  await page.keyboard.type(programStatus('idle'))
  await expect(paneRows(page)).toHaveClass(/idle/)
  await page.keyboard.type("printf '\\e]0;Pick one\\a'\n")
  await expect(paneRows(page).locator('.title')).toHaveText('Pick one')

  const [, cols] = await paneList(page, join(dataDir, 'panes.out'))
  expect(cols[5]).toBe('Pick one')
  expect([cols[5]]).toEqual(await sidebarTitles(page))
})

test('maru pane list 는 claude 의 루트가 done 이어도 maru status 로 쓴 하위 blocked 의 상태와 메시지를 찍는다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  await page.keyboard.type(programStatus('done', `msg=${base64('finished')}`))
  await run(
    page,
    "maru status put blocked --id ask --kind question --msg 'Which one?'; echo code-$?",
    'code-0'
  )
  await expect(paneRows(page)).toHaveClass(/blocked/)

  const [, cols] = await paneList(page, join(dataDir, 'panes.out'))
  expect([cols[1], cols[2], cols[7]]).toEqual(['blocked(question)', 'claude-code', 'Which one?'])
})
