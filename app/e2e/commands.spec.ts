import type { Page } from '@playwright/test'
import {
  activeTerminal,
  clickMenu,
  expect,
  openPalette,
  rows,
  run,
  shellSize,
  test,
  workspaceItems
} from './app'

function palette(page: Page) {
  return page.locator('.palette')
}

function items(page: Page) {
  return palette(page).locator('.item')
}

async function typesIntoTerminal(page: Page, marker: string): Promise<void> {
  await run(page, `echo ${marker}-$((1+1))`, `${marker}-2`)
}

test('명령은 File·View 메뉴 맨 위에 단축키와 함께 있고, ⌘W 는 Close Window 가 아니며, 새로 고침은 메뉴에 없다', async ({
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
      (top) => top.submenu?.items.map((i) => i.role?.toLowerCase() ?? null) ?? []
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
  expect(menus.view.slice(0, 9)).toEqual([
    ['command-palette', 'Command Palette…', 'Shift+Command+P'],
    ['toggle-sidebar', 'Toggle Sidebar', 'Command+B'],
    ['toggle-canvas', 'Toggle Canvas', 'Alt+Command+B'],
    ['toggle-view-mode', 'Toggle View Mode', 'Control+Command+Enter'],
    ['focus-pane-left', 'Focus Pane Left', 'Alt+Command+Left'],
    ['focus-pane-right', 'Focus Pane Right', 'Alt+Command+Right'],
    ['focus-pane-up', 'Focus Pane Up', 'Alt+Command+Up'],
    ['focus-pane-down', 'Focus Pane Down', 'Alt+Command+Down'],
    ['-', '', null]
  ])
  expect(menus.lastTypes).not.toContain('separator')
  expect(menus.roles).not.toContain('close')
  expect(menus.roles).not.toContain('reload')
  expect(menus.roles).not.toContain('forcereload')
  expect(menus.roles).toContain('toggledevtools')
})

test('터미널에 포커스가 있어도 명령의 키는 셸로 보내지 않고 메뉴로 흘려보낸다', async ({
  launch
}) => {
  const { page } = await launch()
  await activeTerminal(page)
  await page.evaluate(() => {
    const seen: { code: string; prevented: boolean }[] = []
    Object.assign(window, { seen })
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && e.key !== 'Meta') seen.push({ code: e.code, prevented: e.defaultPrevented })
    })
  })
  await page.keyboard.type('echo pass-$((1+1))')

  await page.keyboard.press('Control+Meta+Enter')
  await page.keyboard.press('Alt+Meta+ArrowLeft')
  await page.keyboard.press('Alt+Meta+KeyB')
  await page.keyboard.press('Meta+KeyB')

  expect(await page.evaluate(() => (window as unknown as { seen: unknown[] }).seen)).toEqual([
    { code: 'Enter', prevented: false },
    { code: 'ArrowLeft', prevented: false },
    { code: 'KeyB', prevented: false },
    { code: 'KeyB', prevented: false }
  ])
  await run(page, '3', 'pass-23')
})

test('터미널에서 ⇧↩ 은 kitty 키보드 프로토콜을 켠 프로그램에만 CSI u 로 가고, 셸에는 ↩ 으로 간다', async ({
  launch
}) => {
  const { page } = await launch()
  await activeTerminal(page)
  await page.keyboard.type('echo plain-$((1+1))')
  await page.keyboard.press('Shift+Enter')
  await expect(rows(page)).toContainText('plain-2')

  await page.keyboard.type(
    "printf '\\033[>1u'; echo armed-$((1+1)); IFS= read -rsn7 k; printf '\\033[<u'; printf 'got=%q\\n' \"$k\"\n"
  )
  await expect(rows(page)).toContainText('armed-2')
  await page.keyboard.press('Shift+Enter')

  await expect(rows(page)).toContainText("got=$'\\E[13;2u'")
})

test('터미널에서 ⌘← / ⌘→ 는 줄 처음·끝으로 간다', async ({ launch }) => {
  const { page } = await launch()
  await activeTerminal(page)
  await page.keyboard.type('cho edge-$((1+1))')

  await page.keyboard.press('Meta+ArrowLeft')
  await page.keyboard.type('e')
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type('3\n')

  await expect(rows(page)).toContainText('edge-23')
})

test('터미널에서 ⌘⌫ 은 커서 앞의 입력을 지운다', async ({ launch }) => {
  const { page } = await launch()
  await activeTerminal(page)
  await page.keyboard.type('echo gone')

  await page.keyboard.press('Meta+Backspace')
  await page.keyboard.type('echo kept-$((1+1))\n')

  await expect(rows(page)).toContainText('kept-2')
  await expect(rows(page)).not.toContainText('gone')
})

test('터미널에서 ⌥ 는 Meta 로 가서 ⌥P 는 ESC p 를 보낸다', async ({ launch }) => {
  const { page } = await launch()
  await activeTerminal(page)
  await page.keyboard.type('IFS= read -rsn2 k; printf \'got=%q\\n\' "$k"\n')

  await page.keyboard.press('Alt+KeyP')

  await expect(rows(page)).toContainText("got=$'\\Ep'")
})

test('kitty 키보드 모드인 프로그램이 떠 있어도 메뉴의 키는 프로그램으로 가지 않고 메뉴로 흘려보낸다', async ({
  launch
}) => {
  const { page } = await launch()
  await activeTerminal(page)
  await page.keyboard.type(
    "printf '\\033[>1u'; echo armed-$((1+1)); IFS= read -rs -t 2 -n6 k; printf '\\033[<u'; printf 'got=%q\\n' \"$k\"\n"
  )
  await expect(rows(page)).toContainText('armed-2')
  await page.evaluate(() => {
    const seen: { code: string; prevented: boolean }[] = []
    Object.assign(window, { seen })
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && e.key !== 'Meta') seen.push({ code: e.code, prevented: e.defaultPrevented })
    })
  })

  for (const key of ['KeyC', 'KeyQ', 'KeyZ', 'Equal']) await page.keyboard.press(`Meta+${key}`)

  expect(await page.evaluate(() => (window as unknown as { seen: unknown[] }).seen)).toEqual(
    ['KeyC', 'KeyQ', 'KeyZ', 'Equal'].map((code) => ({ code, prevented: false }))
  )
  await expect(rows(page)).toContainText("got=''")
})

test('터미널에서 ⌘A 는 터미널의 내용을 모두 고른다', async ({ launch }) => {
  const { page } = await launch()
  await run(page, 'echo all-$((1+1))', 'all-2')
  await expect(page.locator('.terminal-view.active .xterm-selection div')).toHaveCount(0)

  await page.keyboard.press('Meta+KeyA')

  await expect(page.locator('.terminal-view.active .xterm-selection div')).not.toHaveCount(0)
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
    'Toggle Sidebar⌘B',
    'Toggle Canvas⌥⌘B',
    'Toggle View Mode⌃⌘↩',
    'Focus Pane Left⌥⌘←',
    'Focus Pane Right⌥⌘→',
    'Focus Pane Up⌥⌘↑',
    'Focus Pane Down⌥⌘↓'
  ])
  await expect(items(page).first()).toHaveClass(/selected/)

  await page.keyboard.type('canv')
  await expect(items(page)).toHaveText(['Toggle Canvas⌥⌘B'])
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
  await expect(items(page)).toHaveText([
    'Toggle Sidebar⌘B',
    'Toggle Canvas⌥⌘B',
    'Toggle View Mode⌃⌘↩'
  ])
  for (const i of [1, 2, 0, 1]) {
    await page.keyboard.press('ArrowDown')
    await expect(items(page).nth(i)).toHaveClass(/selected/)
  }
  await page.keyboard.press('Enter')
  await expect(palette(page)).toHaveCount(0)
  await expect(canvas).toBeVisible()
  await typesIntoTerminal(page, 'shown')

  await openPalette(launched)
  await page.keyboard.type('toggle')
  for (const i of [2, 1]) {
    await page.keyboard.press('ArrowUp')
    await expect(items(page).nth(i)).toHaveClass(/selected/)
  }
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

test('View 메뉴의 Toggle Sidebar 는 사이드바를 숨기고 다시 보이며, 터미널이 그 폭을 쓴다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const sidebar = page.locator('.sidebar')
  const before = await shellSize(page)

  await clickMenu(app, 'toggle-sidebar')

  await expect(sidebar).toBeHidden()
  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(before.cols)
  await typesIntoTerminal(page, 'hidden')

  await clickMenu(app, 'toggle-sidebar')

  await expect(sidebar).toBeVisible()
  await expect.poll(async () => (await shellSize(page)).cols).toBe(before.cols)
  await typesIntoTerminal(page, 'shown')
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
  await expect(items(page)).toHaveText(['Toggle Canvas⌥⌘B'])
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
