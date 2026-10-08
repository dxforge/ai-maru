import type { Page } from '@playwright/test'
import { activeTerminal, clickMenu, expect, openPalette, run, test, workspaceItems } from './app'

function palette(page: Page) {
  return page.locator('.palette')
}

function items(page: Page) {
  return palette(page).locator('.item')
}

async function typesIntoTerminal(page: Page, marker: string): Promise<void> {
  await run(page, `echo ${marker}-$((1+1))`, `${marker}-2`)
}

test('명령은 File·View 메뉴 맨 위에 단축키와 함께 있고, ⌘W 는 Close Window 가 아니다', async ({
  launch
}) => {
  const { app } = await launch()
  const menus = await app.evaluate(({ Menu }) => {
    const items = (role: string) =>
      Menu.getApplicationMenu()!
        .items.find((i) => i.role?.toLowerCase() === role)!
        .submenu!.items.map((i) => [
          i.type === 'separator' ? '-' : i.id,
          i.label,
          i.accelerator ?? null
        ])
    const roles = Menu.getApplicationMenu()!.items.flatMap(
      (top) => top.submenu?.items.map((i) => i.role ?? null) ?? []
    )
    const lastTypes = Menu.getApplicationMenu()!.items.map((top) => top.submenu?.items.at(-1)?.type)
    return { file: items('filemenu'), view: items('viewmenu'), roles, lastTypes }
  })
  expect(menus.file).toEqual([
    ['new-workspace', 'New Workspace', 'Command+N'],
    ['split-right', 'Split Right', 'Command+D'],
    ['split-down', 'Split Down', 'Shift+Command+D'],
    ['close-pane', 'Close Pane', 'Command+W']
  ])
  expect(menus.view.slice(0, 8)).toEqual([
    ['command-palette', 'Command Palette…', 'Shift+Command+P'],
    ['toggle-canvas', 'Toggle Canvas', null],
    ['toggle-view-mode', 'Toggle View Mode', 'Control+Command+Enter'],
    ['focus-pane-left', 'Focus Pane Left', 'Alt+Command+Left'],
    ['focus-pane-right', 'Focus Pane Right', 'Alt+Command+Right'],
    ['focus-pane-up', 'Focus Pane Up', 'Alt+Command+Up'],
    ['focus-pane-down', 'Focus Pane Down', 'Alt+Command+Down'],
    ['-', '', null]
  ])
  expect(menus.lastTypes).not.toContain('separator')
  expect(menus.roles).not.toContain('close')
  expect(menus.roles).toContain('reload')
})

test('팔레트는 자신을 뺀 명령을 단축키와 함께 보이고, 입력한 단어로 거른다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await expect(items(page)).toHaveText([
    'New Workspace⌘N',
    'Split Right⌘D',
    'Split Down⇧⌘D',
    'Close Pane⌘W',
    'Toggle Canvas',
    'Toggle View Mode⌃⌘↩',
    'Focus Pane Left⌥⌘←',
    'Focus Pane Right⌥⌘→',
    'Focus Pane Up⌥⌘↑',
    'Focus Pane Down⌥⌘↓'
  ])
  await expect(items(page).first()).toHaveClass(/selected/)

  await page.keyboard.type('canv')
  await expect(items(page)).toHaveText(['Toggle Canvas'])
  await palette(page)
    .locator('.query')
    .dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await page.keyboard.type('xyz')
  await expect(items(page)).toHaveCount(0)
  await expect(page.locator('aside.canvas')).toBeHidden()
  await expect(palette(page)).toContainText('No matching commands')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeVisible()
})

test('팔레트에서 Enter 로 New Workspace 를 실행하면 팔레트가 닫히고 새 터미널이 키를 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await page.keyboard.type('new')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toHaveCount(0)
  await expect(workspaceItems(page)).toHaveCount(2)
  await expect(workspaceItems(page).nth(1)).toHaveClass(/selected/)
  await activeTerminal(page)
  await typesIntoTerminal(page, 'new')
})

test('↓·↑ 로 고른 Toggle Canvas 는 Canvas 를 열고 닫으며, 실행 뒤 키는 터미널로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  const canvas = page.locator('aside.canvas')
  await expect(canvas).toBeHidden()

  await openPalette(launched)
  await page.keyboard.type('toggle')
  await expect(items(page)).toHaveText(['Toggle Canvas', 'Toggle View Mode⌃⌘↩'])
  await page.keyboard.press('ArrowDown')
  await expect(items(page).nth(1)).toHaveClass(/selected/)
  await page.keyboard.press('ArrowDown')
  await expect(items(page).nth(0)).toHaveClass(/selected/)
  await page.keyboard.press('Enter')
  await expect(palette(page)).toHaveCount(0)
  await expect(canvas).toBeVisible()
  await typesIntoTerminal(page, 'shown')

  await openPalette(launched)
  await page.keyboard.type('toggle')
  await page.keyboard.press('ArrowUp')
  await expect(items(page).nth(1)).toHaveClass(/selected/)
  await page.keyboard.press('ArrowUp')
  await expect(items(page).nth(0)).toHaveClass(/selected/)
  await page.keyboard.press('Enter')
  await expect(canvas).toBeHidden()
  await typesIntoTerminal(page, 'hidden')
})

test('항목을 누르거나, 마우스를 올린 항목에서 Enter 를 누르면 그 명령을 실행한다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  const canvas = page.locator('aside.canvas')
  await openPalette(launched)
  await items(page).filter({ hasText: 'Toggle Canvas' }).click()
  await expect(palette(page)).toHaveCount(0)
  await expect(canvas).toBeVisible()
  await typesIntoTerminal(page, 'clicked')

  await openPalette(launched)
  await items(page).filter({ hasText: 'Toggle Canvas' }).hover()
  await expect(items(page).filter({ hasText: 'Toggle Canvas' })).toHaveClass(/selected/)
  await page.keyboard.press('Enter')
  await expect(canvas).toBeHidden()
})

test('View 메뉴의 Toggle Canvas 는 팔레트 없이 Canvas 를 열고 닫는다', async ({ launch }) => {
  const { app, page } = await launch()
  const canvas = page.locator('aside.canvas')
  await clickMenu(app, 'toggle-canvas')
  await expect(canvas).toBeVisible()
  await clickMenu(app, 'toggle-canvas')
  await expect(canvas).toBeHidden()
  await typesIntoTerminal(page, 'menu-toggle')
})

test('팔레트 안의 항목이 아닌 곳을 눌러도 입력창이 키를 받는다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await page.keyboard.type('zzz')
  await palette(page).locator('.empty').click()
  await palette(page).click({ position: { x: 2, y: 2 } })
  await expect(palette(page).locator('.query')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(palette(page)).toHaveCount(0)
  await typesIntoTerminal(page, 'inside')
})

test('Tab 으로 입력창을 떠나면 팔레트가 닫히고 키는 터미널로 간다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await page.keyboard.press('Tab')
  await expect(palette(page)).toHaveCount(0)
  await typesIntoTerminal(page, 'tabbed')
})

test('팔레트가 열린 동안 선택된 workspace 의 셸이 끝나면 팔레트가 닫히고 키는 남은 터미널로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await clickMenu(app, 'new-workspace')
  await expect(workspaceItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await run(page, 'echo ready-$((1+1))', 'ready-2')
  await page.keyboard.type('sleep 1; exit\n')
  await openPalette(launched)
  await expect(workspaceItems(page)).toHaveCount(1)
  await expect(palette(page)).toHaveCount(0)
  await typesIntoTerminal(page, 'survivor')
})

// e2e 의 창은 OS 포커스를 받지 않으므로, 창이 포커스를 잃고 되찾는 것은 `document.hasFocus` 와
// focus 이벤트로 흉내 낸다. 창이 비활성화될 때 포커스된 요소는 `activeElement` 로 남은 채 blur 를 받는다.
async function windowLosesFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.hasFocus = () => false
    document.activeElement?.dispatchEvent(new FocusEvent('blur'))
    window.dispatchEvent(new FocusEvent('blur'))
  })
}

async function windowRegainsFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (document as { hasFocus?: unknown }).hasFocus
    window.dispatchEvent(new FocusEvent('focus'))
  })
}

test('창이 포커스를 잃었다 돌아와도 팔레트는 입력을 지닌 채 키를 받는다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await page.keyboard.type('can')
  await windowLosesFocus(page)
  await windowRegainsFocus(page)
  await expect(palette(page).locator('.query')).toHaveValue('can')
  await expect(palette(page).locator('.query')).toBeFocused()
  await page.keyboard.type('v')
  await expect(items(page)).toHaveText(['Toggle Canvas'])
  await page.keyboard.press('Enter')
  await expect(page.locator('aside.canvas')).toBeVisible()
})

test('창이 포커스를 잃은 동안 셸이 끝나 터미널이 포커스를 가져가면, 창이 돌아올 때 팔레트가 닫힌다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await clickMenu(app, 'new-workspace')
  await expect(workspaceItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await run(page, 'echo ready-$((1+1))', 'ready-2')
  await page.keyboard.type('sleep 2; exit\n')
  await openPalette(launched)
  await windowLosesFocus(page)
  await expect(workspaceItems(page)).toHaveCount(1)
  await expect(page.locator('.xterm-helper-textarea:focus')).toHaveCount(1)
  await windowRegainsFocus(page)
  await expect(palette(page)).toHaveCount(0)
  await typesIntoTerminal(page, 'returned')
})

test('Esc 나 바깥을 누르면 실행하지 않고 닫히며 키는 터미널로 간다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await page.keyboard.type('new')
  await page.keyboard.press('Escape')
  await expect(palette(page)).toHaveCount(0)
  await typesIntoTerminal(page, 'escaped')

  await openPalette(launched)
  await page.mouse.click(5, 300)
  await expect(palette(page)).toHaveCount(0)
  await expect(workspaceItems(page)).toHaveCount(1)
  await typesIntoTerminal(page, 'outside')
})

test('팔레트가 열린 채 메뉴로 명령을 부르면 팔레트가 닫히고, 팔레트를 다시 부르면 입력이 그대로다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await openPalette(launched)
  await page.keyboard.type('can')
  await openPalette(launched)
  await expect(palette(page).locator('.query')).toHaveValue('can')

  await clickMenu(app, 'new-workspace')
  await expect(palette(page)).toHaveCount(0)
  await expect(workspaceItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await typesIntoTerminal(page, 'menu')
})
