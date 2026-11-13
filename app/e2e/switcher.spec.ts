import type { Page } from '@playwright/test'
import {
  cellGroups,
  cellItems,
  clickMenu,
  expect,
  newWorkspace,
  run,
  test,
  workspaceHeads,
  zshHome,
  type Launched
} from './app'

const switcher = (page: Page) => page.locator('.palette.switcher')
const paneItems = (page: Page) => switcher(page).locator('.pane-item')
const dirItems = (page: Page) => switcher(page).locator('.dir-item')

async function openSwitcher({ app, page }: Launched): Promise<void> {
  await clickMenu(app, 'go-to-pane')
  await expect(switcher(page).locator('.query')).toBeFocused()
}

/** 홈 아래 `alpha`·`beta` 에서 workspace 를 하나씩 연다. 두 번째 workspace 가 선택된 채로 돌려준다. */
async function twoWorkspaces(
  launch: (env?: Record<string, string>) => Promise<Launched>,
  dataDir: string
): Promise<Launched & { home: string }> {
  const home = zshHome(dataDir, 'alpha', 'beta')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await run(page, 'cd alpha && echo in-$((1+1))', 'in-2')
  await newWorkspace(launched, 2)
  await run(page, 'cd ~/beta && echo in-$((2+1))', 'in-3')
  await expect(workspaceHeads(page)).toHaveCount(2)
  return { ...launched, home }
}

test('⌘P 전환기는 모든 workspace 의 pane 을 지금 pane 을 표시해 보이고, 접은 workspace 의 pane 을 Enter 로 고르면 그 workspace 를 펴고 그 터미널로 키가 간다', async ({
  launch,
  dataDir
}) => {
  const launched = await twoWorkspaces(launch, dataDir)
  const { page, home } = launched
  await workspaceHeads(page).nth(0).click()
  await expect(workspaceHeads(page).nth(0)).toHaveAttribute('aria-label', 'Expand alpha')

  await openSwitcher(launched)
  await expect(paneItems(page).locator('.title')).toHaveText(['zsh', 'zsh'])
  await expect(paneItems(page).locator('.place')).toHaveText(['alpha', 'beta'])
  await expect(paneItems(page).nth(1)).toHaveClass(/current/)
  await expect(paneItems(page).nth(0)).not.toHaveClass(/current/)
  await expect(paneItems(page).nth(0)).toHaveClass(/selected/)
  await expect(dirItems(page).locator('.title')).toHaveText(['alpha', 'beta'])

  await page.keyboard.type('alpha')
  await expect(paneItems(page)).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(switcher(page)).toHaveCount(0)
  await expect(workspaceHeads(page).nth(0)).toHaveAttribute('aria-label', 'Collapse alpha')
  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)
  await run(page, 'pwd', `${home}/alpha`)
})

test('⌘P 전환기를 Esc 로 닫으면 열기 전의 pane 으로 키가 간다', async ({ launch, dataDir }) => {
  const launched = await twoWorkspaces(launch, dataDir)
  const { page, home } = launched
  await openSwitcher(launched)
  await page.keyboard.type('alpha')
  await page.keyboard.press('Escape')
  await expect(switcher(page)).toHaveCount(0)
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)
  await run(page, 'pwd', `${home}/beta`)
})

test('⌘P 전환기에서 workspace 디렉토리를 고르면 그 디렉토리의 런처 명령 단계가 뜨고, 고른 명령을 그 workspace 의 새 cell 로 연다', async ({
  launch,
  dataDir
}) => {
  const launched = await twoWorkspaces(launch, dataDir)
  const { page, home } = launched
  await openSwitcher(launched)
  await dirItems(page).filter({ hasText: 'alpha' }).click()
  const launcher = page.locator('.palette.launcher')
  await expect(launcher).toBeVisible()
  await expect(switcher(page)).toHaveCount(0)
  await expect(launcher.locator('.section')).toContainText('~/alpha')
  await expect(launcher.locator('.section .where')).toHaveText('New Cell')
  await page.keyboard.type('shell')
  await page.keyboard.press('Enter')
  await expect(launcher).toHaveCount(0)
  await expect(cellItems(page)).toHaveCount(3)
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)
  await run(page, 'pwd', `${home}/alpha`)
})
