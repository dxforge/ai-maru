import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeHeader,
  claudeHook as hook,
  clickMenu,
  expect,
  newWorkspace,
  paneHeader,
  paneRows,
  pressNew,
  shellRows,
  split,
  test,
  typesInto,
  workspaceGroups as groups,
  workspaceItems
} from './app'

test('hook 이 오면 사이드바의 칸 줄과 칸 머리의 상태가 바뀌고, claude exit 로 사라진다', async ({
  launch
}) => {
  const { page } = await launch()
  await expect(paneRows(page)).toHaveCount(0)
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page).locator('.title')).toHaveText('Claude')
  await expect(paneRows(page).locator('.state')).toHaveAttribute('title', 'Working')
  await expect(activeHeader(page).locator('.status-icon')).toHaveAttribute('title', 'Working')
  await expect(activeHeader(page)).toHaveClass(/working/)
  await page.keyboard.type("printf '\\e]0;task-%s\\a' $((6*7))\n")
  await expect(paneRows(page).locator('.title')).toHaveText('task-42')
  await expect(paneRows(page)).toHaveAttribute('aria-label', 'Working: task-42')
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(1)
  await page.keyboard.type(hook('PermissionRequest'))
  await expect(paneRows(page)).toHaveClass(/waiting/)
  await expect(paneRows(page)).toHaveAttribute('aria-label', /^Needs input: /)
  await expect(activeHeader(page)).toHaveClass(/waiting/)
  await page.keyboard.type(hook('Stop'))
  await expect(paneRows(page)).toHaveClass(/idle/)
  await expect(activeHeader(page)).toHaveClass(/idle/)
  await page.keyboard.type('"$MARU_CLI" claude exit\n')
  await expect(paneRows(page)).toHaveCount(0)
  await expect(activeHeader(page)).not.toHaveClass(/idle/)
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(0)
})

test('hook 없이 claude 의 상태 파일이 idle 이 되면 쉬는 중으로 돌아온다', async ({
  launch,
  dataDir
}) => {
  const config = join(dataDir, 'claude')
  mkdirSync(join(config, 'sessions'), { recursive: true })
  const { page } = await launch({ CLAUDE_CONFIG_DIR: config })
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(paneRows(page)).toHaveClass(/working/)
  writeFileSync(
    join(config, 'sessions', '1.json'),
    JSON.stringify({ sessionId: 'c-1', status: 'idle', statusUpdatedAt: Date.now() + 60_000 })
  )
  await expect(paneRows(page)).toHaveClass(/idle/)
})

test('칸 줄은 그 터미널의 workspace 아래에만, 칸 머리는 보이는 칸의 상태를 따른다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await pressNew(app)
  await expect(workspaceItems(page)).toHaveCount(2)
  await page.waitForSelector('.terminal-view.active .xterm-screen')
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(groups(page).nth(1).locator('.pane-row')).toHaveClass(/working/)
  await expect(groups(page).nth(0).locator('.pane-row')).toHaveClass(/shell/)
  await expect(activeHeader(page)).toHaveClass(/working/)
  await workspaceItems(page).nth(0).click()
  await expect(activeHeader(page)).not.toHaveClass(/working/)
  await workspaceItems(page).nth(1).click()
  await expect(activeHeader(page)).toHaveClass(/working/)
})

test('셸 칸과 Claude 칸 모두 칸마다 줄이 있고, 포커스된 칸의 줄만 밝다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  const [left, right] = [0, 1].map((i) => paneHeader(page, i))
  await expect(shellRows(page)).toHaveCount(2)
  await expect(shellRows(page)).toHaveClass([/^(?!.*focused)/, /focused/])
  await expect(shellRows(page).first()).toHaveAttribute('aria-label', 'Shell')
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(right).toHaveClass(/working/)
  await expect(left).not.toHaveClass(/working/)
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page)).toHaveClass(/focused/)
  await expect(shellRows(page)).toHaveCount(1)

  await clickMenu(app, 'focus-pane-left')
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page)).not.toHaveClass(/focused/)
  await expect(shellRows(page)).toHaveClass(/focused/)
  await clickMenu(app, 'focus-pane-right')
  await expect(paneRows(page)).toHaveClass(/focused/)
  await expect(shellRows(page)).not.toHaveClass(/focused/)
})

test('셸 칸의 줄을 눌러도 그 칸에 키 입력이 간다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)

  await shellRows(page).nth(0).click()

  await expect(shellRows(page).nth(0)).toHaveClass(/focused/)
  await typesInto(page, 0, 'shell-row')
})

test('칸 줄을 누르면 그 workspace 를 고르고 그 칸에 키 입력이 간다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await clickMenu(app, 'focus-pane-left')
  await newWorkspace(launched, 2)

  await paneRows(page).click()
  await expect(groups(page).nth(0)).toHaveClass(/selected/)
  await expect(paneRows(page)).toHaveClass(/focused/)
  await typesInto(page, 1, 'row')

  await clickMenu(app, 'focus-pane-left')
  await expect(paneRows(page)).not.toHaveClass(/focused/)
  await paneRows(page).click()
  await expect(paneRows(page)).toHaveClass(/focused/)
  await typesInto(page, 1, 'same')
})
