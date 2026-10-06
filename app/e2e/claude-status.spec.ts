import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { activePane, clickMenu, expect, panes, pressNew, test, workspaceItems } from './app'

const dot = (page: Page) => workspaceItems(page).locator('.claude-dot')

function hook(event: string): string {
  return `printf '%s' '{"hook_event_name":"${event}","session_id":"c-1"}' | "$MARU_CLI" claude hook\n`
}

test('hook 이 오면 사이드바 점과 cell 띠가 바뀌고, claude exit 로 사라진다', async ({ launch }) => {
  const { page } = await launch()
  await expect(dot(page)).toHaveCount(0)
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(dot(page)).toHaveClass(/working/)
  await expect(dot(page)).toHaveAttribute('title', 'Claude: working')
  await expect(activePane(page)).toHaveClass(/working/)
  await page.keyboard.type(hook('PermissionRequest'))
  await expect(dot(page)).toHaveClass(/waiting/)
  await page.keyboard.type(hook('Stop'))
  await expect(dot(page)).toHaveClass(/idle/)
  await page.keyboard.type('"$MARU_CLI" claude exit\n')
  await expect(dot(page)).toHaveCount(0)
  await expect(activePane(page)).not.toHaveClass(/idle/)
})

test('hook 없이 claude 의 상태 파일이 idle 이 되면 쉬는 중으로 돌아온다', async ({
  launch,
  dataDir
}) => {
  const config = join(dataDir, 'claude')
  mkdirSync(join(config, 'sessions'), { recursive: true })
  const { page } = await launch({ CLAUDE_CONFIG_DIR: config })
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(dot(page)).toHaveClass(/working/)
  writeFileSync(
    join(config, 'sessions', '1.json'),
    JSON.stringify({ sessionId: 'c-1', status: 'idle', statusUpdatedAt: Date.now() + 60_000 })
  )
  await expect(dot(page)).toHaveClass(/idle/)
})

test('점은 그 터미널의 workspace 에만, 띠는 보이는 칸의 상태를 따른다', async ({ launch }) => {
  const { app, page } = await launch()
  await pressNew(app)
  await expect(workspaceItems(page)).toHaveCount(2)
  await page.waitForSelector('.terminal-view.active .xterm-screen')
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(workspaceItems(page).nth(1).locator('.claude-dot')).toHaveClass(/working/)
  await expect(workspaceItems(page).nth(0).locator('.claude-dot')).toHaveCount(0)
  await expect(activePane(page)).toHaveClass(/working/)
  await workspaceItems(page).nth(0).click()
  await expect(activePane(page)).not.toHaveClass(/working/)
  await workspaceItems(page).nth(1).click()
  await expect(activePane(page)).toHaveClass(/working/)
})

test('창을 새로 고쳐도 상태가 남는다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(dot(page)).toHaveClass(/working/)
  await page.reload()
  await page.waitForSelector('.xterm-screen')
  await expect(dot(page)).toHaveClass(/working/)
})

test('띠는 칸마다 그 칸의 상태를, 사이드바 점은 포커스가 있는 칸의 상태를 보인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await clickMenu(app, 'split-right')
  await expect(panes(page)).toHaveCount(2)
  await page.waitForSelector('.terminal-view.active .xterm-screen')
  const [left, right] = [0, 1].map((i) => panes(page).nth(i))
  await page.keyboard.type(hook('UserPromptSubmit'))
  await expect(right).toHaveClass(/working/)
  await expect(left).not.toHaveClass(/working/)
  await expect(dot(page)).toHaveClass(/working/)

  await clickMenu(app, 'focus-pane-left')
  await expect(dot(page)).toHaveCount(0)
  await expect(right).toHaveClass(/working/)
  await clickMenu(app, 'focus-pane-right')
  await expect(dot(page)).toHaveClass(/working/)
})
