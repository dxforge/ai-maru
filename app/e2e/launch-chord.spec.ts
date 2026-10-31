import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  clickMenu,
  activeTerminal,
  cellItems,
  cellPlaces,
  expect,
  type Launched,
  panes,
  rows,
  run,
  test,
  writeConfig,
  zshHome
} from './app'

function launcher(page: Page) {
  return page.locator('.palette.launcher')
}

function useTool(dataDir: string, first?: string): string {
  const bin = join(dataDir, 'tool')
  writeFileSync(bin, '#!/bin/sh\necho "ran-in-$(pwd -P)"\nexec sleep 60\n')
  chmodSync(bin, 0o755)
  const commands = first ? [first, bin] : [bin]
  writeConfig(dataDir, `[launcher]\ncommands = [${commands.map((c) => `"${c}"`).join(', ')}]\n`)
  return bin
}

async function startIn(
  launch: (env: Record<string, string>) => Promise<Launched>,
  dataDir: string
) {
  const home = zshHome(dataDir, 'proj')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  await launched.page.keyboard.type('cd proj\n')
  await expect(cellPlaces(launched.page)).toHaveText(['proj'])
  return { ...launched, home }
}

test('⌘J ⌘T 는 지금 pane 의 디렉토리로 셸 없는 명령 목록을 마지막 명령을 고른 채 띄우고, 고른 명령을 새 cell 에 띄우며 최근 목록은 그대로 둔다', async ({
  launch,
  dataDir
}) => {
  const bin = useTool(dataDir, 'true')
  writeFileSync(join(dataDir, 'launcher.json'), JSON.stringify({ recent: [], command: bin }))
  const { page, home } = await startIn(launch, dataDir)

  await page.keyboard.press('Meta+KeyJ')
  await page.keyboard.press('Meta+KeyT')
  await expect(launcher(page).locator('.section .path')).toHaveText('~/proj')
  await expect(launcher(page).locator('.where')).toHaveText('New Cell')
  await expect(launcher(page).locator('.item .path')).toHaveText(['true', bin])
  await expect(launcher(page).locator('.item.selected .path')).toHaveText(bin)
  await expect(cellItems(page)).toHaveCount(1)

  await page.keyboard.press('Enter')
  await expect(launcher(page)).toHaveCount(0)
  await expect(cellItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await expect(rows(page)).toContainText(`ran-in-${home}/proj`)
  const state = JSON.parse(readFileSync(join(dataDir, 'launcher.json'), 'utf8'))
  expect(state).toMatchObject({ command: bin, recent: [] })
})

test('⌘J ⌘D 는 고른 명령을 오른쪽으로 나눈 pane 에 띄우고 그 pane 에 포커스를 준다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const { page, home } = await startIn(launch, dataDir)

  await page.keyboard.press('Meta+KeyJ')
  await page.keyboard.press('Meta+KeyD')
  await expect(launcher(page).locator('.where')).toHaveText('Split Right')
  await page.keyboard.press('Enter')
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await expect(rows(page)).toContainText(`ran-in-${home}/proj`)
})

test('⌘J 뒤 ⌘ 를 떼고 누른 키와 Esc 는 기다리기를 끝내고 터미널에 가지 않는다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const { page } = await startIn(launch, dataDir)

  await page.keyboard.press('Meta+KeyJ')
  await page.keyboard.press('KeyT')
  await page.keyboard.press('Meta+KeyJ')
  await page.keyboard.press('Escape')
  await expect(launcher(page)).toHaveCount(0)
  // 삼키지 못한 T 나 Esc 가 셸에 갔으면 친 줄의 앞이 바뀐다.
  await run(page, 'echo chord-$((1+1))', '% echo chord-$((1+1))chord-2')
})

test('File 메뉴의 Launch Split Down… 도 같은 목록을 띄우고, 고른 명령을 아래로 나눈 pane 에 띄운다', async ({
  launch,
  dataDir
}) => {
  useTool(dataDir)
  const { app, page, home } = await startIn(launch, dataDir)

  await clickMenu(app, 'launch-split-down')
  await expect(launcher(page).locator('.where')).toHaveText('Split Down')
  await page.keyboard.press('Enter')
  await expect(panes(page)).toHaveCount(2)
  const [top, bottom] = [
    await panes(page).nth(0).boundingBox(),
    await panes(page).nth(1).boundingBox()
  ]
  expect(bottom!.y).toBeGreaterThan(top!.y)
  await expect(panes(page).nth(1).locator('.terminal-view')).toHaveClass(/active/)
  await expect(rows(page)).toContainText(`ran-in-${home}/proj`)
})
