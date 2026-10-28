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

test('claude 가 없으면 maru mate list 는 stdout 에 아무것도 쓰지 않고 no mates 와 함께 성공한다', async ({
  launch,
  dataDir
}) => {
  const { page } = await launch()
  const out = join(dataDir, 'mates.out')
  await run(page, `maru mate list >${out}; echo code-$?`, /no mates\s*code-0/)
  expect(readFileSync(out, 'utf8')).toBe('')
})

/** e2e 의 bash 는 cd 를 OSC 7 로 알리지 않으므로 직접 보낸다. */
async function enter(page: Page, dir: string): Promise<string> {
  mkdirSync(dir)
  await run(
    page,
    `cd ${dir}; printf '\\e]7;file://%s\\a' "$PWD"; clear; echo id=[$MARU_PTY_ID]`,
    /id=\[p-[0-9a-f]{8}\]/
  )
  return (await rows(page).innerText()).match(/id=\[(p-[0-9a-f]{8})\]/)![1]
}

const base64 = (text: string): string => Buffer.from(text).toString('base64')

test('maru mate list 는 claude 가 보고한 pane 만 화면 순서대로, 사이드바의 이름과 함께 TSV 로 찍는다', async ({
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

  await newWorkspace(launched, 2)
  const second = await enter(page, join(dataDir, 'proj-b'))
  await expect(workspaceNames(page).nth(1)).toHaveText('proj-b')
  await page.keyboard.type(programStatus('working', `msg=${base64('reading')}`))
  await expect(paneRows(page).nth(1)).toHaveClass(/working/)

  const out = join(dataDir, 'mates.out')
  await run(page, `maru mate list >${out}; echo code-$?`, 'code-0')
  const lines = readFileSync(out, 'utf8').split('\n')
  expect(lines.at(-1)).toBe('')
  expect(lines.slice(0, -1).map((l) => l.split('\t'))).toEqual([
    ['PTY', 'STATE', 'WORKSPACE', 'CELL', 'DIR', 'MESSAGE'],
    [
      first,
      'blocked(permission)',
      'proj-a',
      'proj-a',
      expect.stringMatching(/\/proj-a$/),
      'Bash: git push -u origin x'
    ],
    [second, 'working', 'proj-b', 'proj-b', expect.stringMatching(/\/proj-b$/), 'reading']
  ])
})

test('maru mate list 는 claude 의 루트가 done 이어도 maru status 로 쓴 하위 blocked 의 상태와 메시지를 찍는다', async ({
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

  const out = join(dataDir, 'mates.out')
  await run(page, `maru mate list >${out}; echo listed-$?`, 'listed-0')
  const cols = readFileSync(out, 'utf8').split('\n')[1].split('\t')
  expect([cols[1], cols[5]]).toEqual(['blocked(question)', 'Which one?'])
})
