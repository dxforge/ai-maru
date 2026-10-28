import type { Page } from '@playwright/test'
import {
  activeTerminal,
  clickMenu,
  DRAG_LOG_ENV,
  dragRegion,
  expect,
  openPalette,
  resizeBy,
  rows,
  run,
  shellSize,
  test,
  cellGroups,
  cellItems,
  writeConfig
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

async function armKitty(page: Page, flags: number, read: string): Promise<void> {
  await page.keyboard.type(
    `printf '\\033[>${flags}u'; echo armed-$((1+1)); IFS= read -rs ${read} k; printf '\\033[<u'; printf 'got=%q\\n' "$k"\n`
  )
  await expect(rows(page)).toContainText('armed-2')
}

test('명령은 File·View 메뉴 맨 위에 단축키와 함께 있고, ⌘W 는 Close Window 가 아니며, 새로 고침과 창 zoom 은 메뉴에 없다', async ({
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
    ['new-cell', 'New Cell', 'Command+T'],
    ['launcher', 'Open Launcher', 'Command+P'],
    ['split-right', 'Split Right', 'Command+D'],
    ['split-down', 'Split Down', 'Shift+Command+D'],
    ['close-pane', 'Close Pane', 'Command+W'],
    ['close-workspace', 'Close Workspace', 'Shift+Command+W']
  ])
  expect(menus.view.slice(0, 17)).toEqual([
    ['command-palette', 'Command Palette…', 'Shift+Command+P'],
    ['next-cell', 'Next Cell', 'Shift+Command+]'],
    ['previous-cell', 'Previous Cell', 'Shift+Command+['],
    ['toggle-sidebar', 'Toggle Sidebar', 'Command+B'],
    ['toggle-canvas', 'Toggle Canvas', 'Alt+Command+B'],
    ['toggle-view-mode', 'Toggle View Mode', 'Command+\\'],
    ['focus-pane-left', 'Focus Pane Left', 'Alt+Command+Left'],
    ['focus-pane-right', 'Focus Pane Right', 'Alt+Command+Right'],
    ['focus-pane-up', 'Focus Pane Up', 'Alt+Command+Up'],
    ['focus-pane-down', 'Focus Pane Down', 'Alt+Command+Down'],
    ['increase-font-size', 'Increase Font Size', 'Command+Plus'],
    ['decrease-font-size', 'Decrease Font Size', 'Command+-'],
    ['reset-font-size', 'Reset Font Size', 'Command+0'],
    ['widen-cell', 'Widen Cell', 'Shift+Command+.'],
    ['narrow-cell', 'Narrow Cell', 'Shift+Command+,'],
    ['clear-scrollback', 'Clear Scrollback', 'Command+K'],
    ['-', '', null]
  ])
  expect(menus.lastTypes).not.toContain('separator')
  expect(menus.roles).not.toContain('close')
  expect(menus.roles).not.toContain('reload')
  expect(menus.roles).not.toContain('forcereload')
  expect(menus.roles).toContain('toggledevtools')
  expect(menus.roles).not.toContain('zoomin')
  expect(menus.roles).not.toContain('zoomout')
  expect(menus.roles).not.toContain('resetzoom')
})

test('터미널에 포커스가 있어도 명령의 키는 셸로 보내지 않고 메뉴나 창으로 흘려보낸다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.evaluate(() => {
    const seen: { code: string; prevented: boolean }[] = []
    Object.assign(window, { seen })
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && e.key !== 'Meta') seen.push({ code: e.code, prevented: e.defaultPrevented })
    })
  })
  await page.keyboard.type('echo pass-$((1+1))')

  await page.keyboard.press('Meta+Backslash')
  await page.keyboard.press('Alt+Meta+ArrowLeft')
  await page.keyboard.press('Alt+Meta+KeyB')
  await page.keyboard.press('Meta+KeyB')
  await page.keyboard.press('Shift+Meta+BracketRight')
  await page.keyboard.press('Meta+Equal')
  await page.keyboard.press('Meta+Minus')
  await page.keyboard.press('Meta+Digit0')
  await page.keyboard.press('Shift+Meta+Period')
  await page.keyboard.press('Shift+Meta+Comma')

  expect(await page.evaluate(() => (window as unknown as { seen: unknown[] }).seen)).toEqual([
    { code: 'Backslash', prevented: false },
    { code: 'ArrowLeft', prevented: false },
    { code: 'KeyB', prevented: false },
    { code: 'KeyB', prevented: false },
    { code: 'BracketRight', prevented: false },
    { code: 'Equal', prevented: false },
    { code: 'Minus', prevented: false },
    { code: 'Digit0', prevented: false },
    { code: 'Period', prevented: false },
    { code: 'Comma', prevented: false }
  ])
  // 키가 글자로 새면 줄 끝에 붙는다. 새어 나온 \ 는 뒤의 $ 를 이스케이프하므로 pass-24 가 찍히지 않는다.
  await run(page, '$((2+2))', 'pass-24')
})

test('터미널에서 ⇧↩ 은 kitty 키보드 프로토콜을 켠 프로그램에만 CSI u 로 가고, 셸에는 ↩ 으로 간다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type('echo plain-$((1+1))')
  await page.keyboard.press('Shift+Enter')
  await expect(rows(page)).toContainText('plain-2')

  await armKitty(page, 1, '-n7')
  await page.keyboard.press('Shift+Enter')

  await expect(rows(page)).toContainText("got=$'\\E[13;2u'")
})

test('터미널에서 ⌘← / ⌘→ 는 줄 처음·끝으로 간다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('cho edge-$((1+1))')

  await page.keyboard.press('Meta+ArrowLeft')
  await page.keyboard.type('e')
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type('3\n')

  await expect(rows(page)).toContainText('edge-23')
})

test('터미널에서 ⌘⌫ 은 커서 앞의 입력을 지운다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('echo gone')

  await page.keyboard.press('Meta+Backspace')
  await page.keyboard.type('echo kept-$((1+1))\n')

  await expect(rows(page)).toContainText('kept-2')
  await expect(rows(page)).not.toContainText('gone')
})

async function composeThenMetaKey(page: Page, code: string, keyCode: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 })
  const key = { modifiers: 4, windowsVirtualKeyCode: keyCode, code, key: code }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key })
  await cdp.send('Input.insertText', { text: '하' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
  await cdp.detach()
}

test('터미널에서 한글을 조합하는 중에 ⌘⌫ 을 누르면 조합하던 글자까지 지운다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.insertText('안녕')

  await composeThenMetaKey(page, 'Backspace', 8)
  await page.keyboard.type('echo kept-$((1+1))\n')

  await expect(rows(page)).toContainText('kept-2')
})

test('터미널에서 한글을 조합하는 중에 ⌘← 를 누르면 조합하던 글자를 넣은 뒤 줄 처음으로 간다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.insertText('안녕')

  await composeThenMetaKey(page, 'ArrowLeft', 37)
  await page.keyboard.type('echo ')
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type('-$((1+1))\n')

  await expect(rows(page)).toContainText('안녕하-2')
})

test('터미널에서 ⌥ 는 Meta 로 가서 ⌥P 는 ESC p 를 보낸다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('IFS= read -rsn2 k; printf \'got=%q\\n\' "$k"\n')

  await page.keyboard.press('Alt+KeyP')

  await expect(rows(page)).toContainText("got=$'\\Ep'")
})

test('kitty 키보드 모드인 프로그램이 떠 있어도 ⌘ 조합은 프로그램으로 가지 않고 메뉴나 창으로 흘려보낸다', async ({
  launch
}) => {
  const { page } = await launch()
  // ⌘ 조합의 누름이나 뗌(flag 2)이 하나라도 새면 그 ESC 가 먼저 읽힌다. 새지 않으면 뒤에 누르는 x 를 읽고 바로 끝난다.
  await armKitty(page, 3, '-t 2 -n1')
  await page.evaluate(() => {
    const seen: { code: string; prevented: boolean }[] = []
    Object.assign(window, { seen })
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && !['Meta', 'Shift', 'Alt'].includes(e.key))
        seen.push({ code: e.code, prevented: e.defaultPrevented })
    })
  })

  // KeyC 부터 Shift+Digit0 까지는 단축키 표(shortcuts.ts)에 있는 키, KeyE 부터는 표에 없는 키다.
  const keys = [
    'KeyC',
    'KeyQ',
    'KeyZ',
    'Equal',
    'Shift+Equal',
    'Minus',
    'Shift+Minus',
    'Digit0',
    'Shift+Digit0',
    'KeyE',
    'Slash',
    'Digit1',
    'ArrowUp',
    'Enter',
    'Shift+KeyK',
    'Alt+KeyE'
  ]
  for (const key of keys) await page.keyboard.press(`Meta+${key}`)
  await page.keyboard.press('KeyX')

  expect(await page.evaluate(() => (window as unknown as { seen: unknown[] }).seen)).toEqual(
    keys.map((key) => ({ code: key.split('+').at(-1), prevented: false }))
  )
  await expect(rows(page)).toContainText('got=x')
})

test('kitty 키보드 모드가 아닌 프로그램에도 표에 없는 ⌘↩ 은 가지 않는다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type('IFS= read -rs -t 2 -n1 k; printf \'got=%q\\n\' "$k"\n')

  await page.keyboard.press('Meta+Enter')
  await page.keyboard.press('KeyX')

  await expect(rows(page)).toContainText('got=x')
})

test('kitty 키보드 모드인 프로그램은 ⌘ 와, ⌘ 를 쥔 채 누른 ⇧·⌥·⌃ 같은 modifier 단독 누름은 받는다', async ({
  launch
}) => {
  const { page } = await launch()
  await armKitty(page, 8, '-t 2 -n43')

  await page.keyboard.down('Meta')
  await page.keyboard.press('Shift')
  await page.keyboard.press('Alt')
  await page.keyboard.press('Control')
  await page.keyboard.up('Meta')

  await expect(rows(page)).toContainText(
    "got=$'\\E[57444;9u\\E[57441;10u\\E[57443;11u\\E[57442;13u'"
  )
})

const selection = (page: Page) => page.locator('.terminal-view.active .xterm-selection div')

test('터미널에서 ⌘A 는 터미널의 내용을 모두 고르고, ⇧⌘A 는 고르지 않는다', async ({ launch }) => {
  const { page } = await launch()
  await run(page, 'echo all-$((1+1))', 'all-2')
  await expect(selection(page)).toHaveCount(0)

  await page.keyboard.press('Shift+Meta+KeyA')
  await expect(selection(page)).toHaveCount(0)

  await page.keyboard.press('Meta+KeyA')
  await expect(selection(page)).not.toHaveCount(0)
})

// Playwright 의 keyboard 는 자판 배열을 바꿀 수 없으므로, 그 자판이 보낼 code 와 key 를 CDP 로 따로 넣는다.
async function pressMetaKey(page: Page, code: string, key: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  const event = { modifiers: 4, windowsVirtualKeyCode: 65, code, key }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
  await cdp.detach()
}

test('⌘A 는 글자로 맞추고, 글자가 라틴 글자가 아닐 때만 자판 위치로 맞춘다', async ({ launch }) => {
  const { page } = await launch()
  await run(page, 'echo all-$((1+1))', 'all-2')
  await expect(selection(page)).toHaveCount(0)

  // Turkish-F: KeyA 자리의 글자가 U 다. ⌘U 는 Select All 이 아니다.
  await pressMetaKey(page, 'KeyA', 'u')
  await expect(selection(page)).toHaveCount(0)

  // AZERTY: A 가 KeyQ 자리에 있다.
  await pressMetaKey(page, 'KeyQ', 'a')
  await expect(selection(page)).not.toHaveCount(0)

  await page.locator('.terminal-view.active .xterm-screen').click()
  await expect(selection(page)).toHaveCount(0)

  // 라틴 글자가 없는 자판: KeyA 자리에서 라틴이 아닌 글자가 온다.
  await pressMetaKey(page, 'KeyA', 'ф')
  await expect(selection(page)).not.toHaveCount(0)
})

test('팔레트는 자신을 뺀 명령을 단축키와 함께 보이고, 입력한 단어로 거른다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await expect(items(page)).toHaveText([
    'New Workspace⌘N',
    'New Cell⌘T',
    'Open Launcher⌘P',
    'Split Right⌘D',
    'Split Down⇧⌘D',
    'Close Pane⌘W',
    'Close Workspace⇧⌘W',
    'Next Cell⇧⌘]',
    'Previous Cell⇧⌘[',
    'Toggle Sidebar⌘B',
    'Toggle Canvas⌥⌘B',
    'Toggle View Mode⌘\\',
    'Focus Pane Left⌥⌘←',
    'Focus Pane Right⌥⌘→',
    'Focus Pane Up⌥⌘↑',
    'Focus Pane Down⌥⌘↓',
    'Increase Font Size⌘+',
    'Decrease Font Size⌘-',
    'Reset Font Size⌘0',
    'Widen Cell⇧⌘.',
    'Narrow Cell⇧⌘,',
    'Clear Scrollback⌘K',
    'Restart'
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

test('팔레트 입력창에서 ⇧⌘← 는 pane 을 옮기지 않고 입력한 글자를 고른다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await page.keyboard.type('canv')
  await page.keyboard.press('Shift+Meta+ArrowLeft')
  await expect(palette(page)).toBeVisible()
  const query = palette(page).locator('.query')
  await expect(query).toBeFocused()
  expect(
    await query.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])
  ).toEqual([0, 4])
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
  await expect(cellItems(page)).toHaveCount(2)
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)
  await activeTerminal(page)
  await typesIntoTerminal(page, 'new')
})

for (const [position, label, arrows, next, previous] of [
  ['bottom', '아래', '↑·↓', 'ArrowUp', 'ArrowDown'],
  ['top', '위', '↓·↑', 'ArrowDown', 'ArrowUp']
] as const) {
  test(`팔레트가 ${label}일 때 ${arrows} 로 고른 Toggle Canvas 는 Canvas 를 열고 닫으며, 실행 뒤 키는 터미널로 간다`, async ({
    launch,
    dataDir
  }) => {
    if (position === 'top') writeConfig(dataDir, '[layout]\npalette = "top"\n')
    const launched = await launch()
    const { page } = launched
    const canvas = page.locator('aside.canvas')
    await expect(canvas).toBeHidden()

    await openPalette(launched)
    await page.keyboard.type('toggle')
    await expect(items(page)).toHaveText([
      'Toggle Sidebar⌘B',
      'Toggle Canvas⌥⌘B',
      'Toggle View Mode⌘\\'
    ])
    for (const i of [1, 2, 0, 1]) {
      await page.keyboard.press(next)
      await expect(items(page).nth(i)).toHaveClass(/selected/)
    }
    await page.keyboard.press('Enter')
    await expect(palette(page)).toHaveCount(0)
    await expect(canvas).toBeVisible()
    await typesIntoTerminal(page, 'shown')

    await openPalette(launched)
    await page.keyboard.type('toggle')
    for (const i of [2, 1]) {
      await page.keyboard.press(previous)
      await expect(items(page).nth(i)).toHaveClass(/selected/)
    }
    await page.keyboard.press('Enter')
    await expect(canvas).toBeHidden()
    await typesIntoTerminal(page, 'hidden')
  })
}

function paletteLayout(page: Page) {
  return page.evaluate(() => {
    const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect()
    const box = rect('.palette')
    const query = rect('.palette .query')
    const first = rect('.palette .item, .palette .empty')
    const header = rect('.pane.focused .pane-header')
    return {
      top: box.top,
      bottom: innerHeight - box.bottom,
      gap: query.top - first.bottom,
      clearsHeader: box.bottom <= header.top
    }
  })
}

const atBottom = ({ top, bottom, gap }: Awaited<ReturnType<typeof paletteLayout>>) =>
  bottom >= 0 && bottom <= top && gap >= 0

test('팔레트는 기본으로 창 아래쪽에 pane 헤더를 가리지 않게 뜨고, 입력줄이 맨 아래, 첫 후보와 빈 줄은 그 바로 위에 놓인다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  await expect(items(page).first()).toHaveClass(/selected/)
  const layout = await paletteLayout(page)
  expect(atBottom(layout)).toBe(true)
  expect(layout.clearsHeader).toBe(true)
  await page.keyboard.type('xyz')
  await expect(palette(page)).toContainText('No matching commands')
  expect((await paletteLayout(page)).gap).toBe(layout.gap)
})

test('layout.palette = "top" 이면 팔레트는 창 위쪽에 뜨고 입력줄이 맨 위에 놓이며, 열린 채로 고쳐도 옮긴다', async ({
  launch,
  dataDir
}) => {
  writeConfig(dataDir, '[layout]\npalette = "top"\n')
  const launched = await launch()
  const { page } = launched
  await openPalette(launched)
  const above = await paletteLayout(page)
  expect(above.top).toBeGreaterThanOrEqual(0)
  expect(above.top).toBeLessThanOrEqual(above.bottom)
  expect(above.gap).toBeLessThan(0)
  writeConfig(dataDir, '[layout]\npalette = "bottom"\n')
  await expect.poll(async () => atBottom(await paletteLayout(page))).toBe(true)
  await expect(palette(page).locator('.query')).toBeFocused()
})

for (const [position, label, toLast] of [
  ['bottom', '아래', 'ArrowDown'],
  ['top', '위', 'ArrowUp']
] as const) {
  test(`팔레트가 ${label}일 때 창이 낮아도 팔레트는 창 안에 남고, 화살표로 고른 후보가 보이도록 목록이 스크롤된다`, async ({
    launch,
    dataDir
  }) => {
    writeConfig(dataDir, `[layout]\npalette = "${position}"\n`)
    const launched = await launch()
    const { app, page } = launched
    await resizeBy(app, 0, -400)
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(400)
    await openPalette(launched)
    const inside = await paletteLayout(page)
    expect(inside.top).toBeGreaterThanOrEqual(0)
    expect(inside.bottom).toBeGreaterThanOrEqual(0)

    await page.keyboard.press(toLast)
    const last = items(page).last()
    await expect(last).toHaveClass(/selected/)
    const list = (await palette(page).locator('.list').boundingBox())!
    await expect
      .poll(async () => {
        const box = (await last.boundingBox())!
        return box.y >= list.y && box.y + box.height <= list.y + list.height
      })
      .toBe(true)
  })
}

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

test('Next·Previous Cell 는 사이드바의 다음·이전 cell 을 선택하고 끝에서는 반대쪽 끝으로 돌며, 키는 그 터미널로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await clickMenu(app, 'new-workspace')
  await expect(cellItems(page)).toHaveCount(2)
  await clickMenu(app, 'new-workspace')
  await expect(cellItems(page)).toHaveCount(3)
  await activeTerminal(page)

  for (const [id, i] of [
    ['next-cell', 0],
    ['next-cell', 1],
    ['previous-cell', 0],
    ['previous-cell', 2]
  ] as const) {
    await clickMenu(app, id)
    await expect(cellGroups(page).nth(i)).toHaveClass(/selected/)
    await typesIntoTerminal(page, `at-${i}-${id}`)
  }
})

test('View 메뉴의 Toggle Sidebar 는 사이드바를 접고 다시 펴며, 터미널이 그 폭을 쓴다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const sidebar = page.locator('.sidebar')
  const before = await shellSize(page)

  await clickMenu(app, 'toggle-sidebar')

  await expect(sidebar).toHaveClass(/collapsed/)
  await expect.poll(async () => (await shellSize(page)).cols).toBeGreaterThan(before.cols)
  await typesIntoTerminal(page, 'hidden')

  await clickMenu(app, 'toggle-sidebar')

  await expect(sidebar).not.toHaveClass(/collapsed/)
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
  // 글자를 치기 전에 본다. 사이드바의 버튼이 포커스를 받으면 친 공백이 그 버튼을 눌러 터미널로 포커스를 되돌리기 때문이다.
  await expect(page.locator('.terminal-view.active .xterm-helper-textarea')).toBeFocused()
  await typesIntoTerminal(page, 'tabbed')
})

test('팔레트가 열린 동안 선택된 cell 의 셸이 끝나면 팔레트가 닫히고 키는 남은 터미널로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await clickMenu(app, 'new-workspace')
  await expect(cellItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await run(page, 'echo ready-$((1+1))', 'ready-2')
  await page.keyboard.type('sleep 1; exit\n')
  await openPalette(launched)
  await expect(cellItems(page)).toHaveCount(1)
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
  await expect(cellItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await run(page, 'echo ready-$((1+1))', 'ready-2')
  await page.keyboard.type('sleep 2; exit\n')
  await openPalette(launched)
  await windowLosesFocus(page)
  await expect(cellItems(page)).toHaveCount(1)
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
  await expect(cellItems(page)).toHaveCount(1)
  await typesIntoTerminal(page, 'outside')
})

test('팔레트가 열린 동안에는 사이드바·Canvas 헤더 위를 눌러도 창을 끌지 않는다', async ({
  launch
}) => {
  const launched = await launch(DRAG_LOG_ENV)
  const { app, page } = launched
  const region = dragRegion(app)
  await clickMenu(app, 'toggle-canvas')
  await expect.poll(region).toBe('0,0 1000x700')

  await openPalette(launched)
  await expect.poll(region).toBe('0,0 0x0')
  await page.keyboard.press('Escape')
  await expect.poll(region).toBe('0,0 1000x700')
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
  await expect(cellItems(page)).toHaveCount(2)
  await activeTerminal(page)
  await typesIntoTerminal(page, 'menu')
})
