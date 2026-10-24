import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import {
  activeHeader,
  clickMenu,
  expect,
  newWorkspace,
  paneHeader,
  paneRows,
  panes,
  pressNew,
  programStatus as status,
  screenshotPixels,
  shellRows,
  split,
  test,
  typesInto,
  cellGroups as groups,
  cellItems,
  zshHome
} from './app'
import { ICONS, STATE_LABELS } from '../src/renderer/src/icons'

test('claude 가 clear 를 보내지 못하고 죽어도 셸 함수가 clear 를 써서 상태가 사라진다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir)
  const bin = join(dataDir, 'fakebin')
  mkdirSync(bin)
  const pidFile = join(dataDir, 'claude.pid')
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh\necho $$ > '${pidFile}'\nprintf '\\033]7501;state=idle\\033\\\\'\nsleep 60\n`,
    { mode: 0o755 }
  )
  const { page } = await launch({
    SHELL: '/bin/zsh',
    HOME: home,
    PATH: `${bin}:${process.env.PATH}`
  })
  await page.keyboard.type('claude\n')
  await expect(paneRows(page)).toHaveClass(/idle/)

  process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL')

  await expect(paneRows(page)).toHaveCount(0)
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(0)
})

test('OSC 7501 보고가 오면 사이드바의 pane 줄과 pane 헤더의 상태가 바뀌고, clear 로 사라진다', async ({
  launch
}) => {
  const { page } = await launch()
  await expect(paneRows(page)).toHaveCount(0)
  await page.keyboard.type(status('working'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page).locator('.title')).toHaveText('Claude')
  await expect(paneRows(page).locator('.state')).toHaveAttribute('title', 'Working')
  await expect(activeHeader(page).locator('.status-icon')).toHaveAttribute('title', 'Working')
  await expect(activeHeader(page)).toHaveClass(/working/)
  await page.keyboard.type("printf '\\e]0;task-%s\\a' $((6*7))\n")
  await expect(paneRows(page).locator('.title')).toHaveText('task-42')
  await expect(paneRows(page)).toHaveAttribute('aria-label', 'Working: task-42')
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(1)
  await page.keyboard.type(status('blocked', 'kind=permission:msg=aGk='))
  await expect(paneRows(page)).toHaveClass(/blocked/)
  await expect(paneRows(page)).toHaveAttribute('aria-label', /^Blocked: /)
  await expect(activeHeader(page)).toHaveClass(/blocked/)
  await page.keyboard.type(status('done'))
  await expect(paneRows(page)).toHaveClass(/done/)
  await expect(activeHeader(page).locator('.status-icon')).toHaveAttribute('title', 'Done')
  await page.keyboard.type(status('idle'))
  await expect(paneRows(page)).toHaveClass(/idle/)
  await expect(activeHeader(page)).toHaveClass(/idle/)
  await page.keyboard.type(status('clear'))
  await expect(paneRows(page)).toHaveCount(0)
  await expect(activeHeader(page)).not.toHaveClass(/idle/)
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(0)
})

test('상태 아이콘은 상태마다 SVG 로 줄 가운데에 그리고, 선과 면은 아이콘 자리의 글자색을 따르며, working 만 원 중심을 축으로 돌고, 상태가 사라지면 terminal glyph 로 돌아온다', async ({
  launch
}) => {
  const { page } = await launch()
  const icons = [
    [paneRows(page).locator('.state'), paneRows(page)],
    [activeHeader(page).locator('.status-icon'), activeHeader(page)],
    [page.locator('.cell-header .status-icon'), page.locator('.cell-header')]
  ] as const
  for (const state of Object.keys(STATE_LABELS)) {
    await page.keyboard.type(status(state))
    await expect(paneRows(page)).toHaveClass(new RegExp(state))
    for (const [icon, row] of icons) {
      const svg = icon.locator('svg')
      await expect(svg).toHaveAttribute('data-state', state)
      const middle = (b: { y: number; height: number }) => b.y + b.height / 2
      expect(
        Math.abs(middle((await svg.boundingBox())!) - middle((await row.boundingBox())!))
      ).toBeLessThanOrEqual(0.5)
      const paint = await icon.evaluate((el) => ({
        color: getComputedStyle(el).color,
        painted: [...el.querySelectorAll('svg *')].flatMap((s) => {
          const c = getComputedStyle(s)
          return [c.fill, c.stroke].filter((v) => v !== 'none')
        })
      }))
      expect(paint.painted.length).toBeGreaterThan(0)
      for (const v of paint.painted) expect(v).toBe(paint.color)

      const spin = await svg.evaluate((el) => {
        const anims = el.getAnimations()
        if (anims.length === 0) return null
        const center = (s: Element) => {
          const r = s.getBoundingClientRect()
          return [r.x + r.width / 2, r.y + r.height / 2]
        }
        const [a] = anims
        a.pause()
        const duration = Number(a.effect!.getComputedTiming().duration)
        a.currentTime = 0
        const ring0 = center(el.querySelector('circle')!)
        const arc0 = center(el.querySelector('path')!)
        a.currentTime = duration / 4
        const ring1 = center(el.querySelector('circle')!)
        const arc1 = center(el.querySelector('path')!)
        a.play()
        return { count: anims.length, ring0, ring1, arc0, arc1 }
      })
      if (state !== 'working') {
        expect(spin).toBeNull()
        continue
      }
      expect(spin!.count).toBe(1)
      for (const i of [0, 1]) expect(Math.abs(spin!.ring1[i] - spin!.ring0[i])).toBeLessThan(0.5)
      expect(
        Math.hypot(spin!.arc1[0] - spin!.arc0[0], spin!.arc1[1] - spin!.arc0[1])
      ).toBeGreaterThan(1)
    }
  }

  await page.keyboard.type(status('clear'))
  await expect(paneRows(page)).toHaveCount(0)
  const header = activeHeader(page).locator('.status-icon')
  await expect(header.locator('svg')).toHaveCount(0)
  await expect(header).toHaveText(ICONS.terminal)
  await expect(header).toHaveCSS('font-family', '"Symbols Nerd Font Mono"')
  await expect(page.locator('.cell-header .status-icon svg')).toHaveCount(0)
})

test('루트 레코드의 app 이 claude-code 가 아니면 Claude 이름·아이콘 대신 app 값을, app 이 비었으면 Program 을 보인다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(status('working', undefined, 'make'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page).locator('.title')).toHaveText('make')
  await expect(paneRows(page)).toHaveAttribute('aria-label', 'Working: make')
  await expect(paneRows(page).locator('.app')).toHaveCount(0)
  await expect(activeHeader(page).locator('.title')).toHaveText('make')
  await expect(activeHeader(page).locator('.status-icon')).toHaveAttribute('title', 'Working')
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(0)
  await groups(page).locator('.fold').click()
  await expect(groups(page).locator('.summary .title')).toHaveText('make 1')
  await groups(page).locator('.fold').click()

  await page.keyboard.type(status('idle', undefined, ''))
  await expect(paneRows(page)).toHaveClass(/idle/)
  await expect(paneRows(page).locator('.title')).toHaveText('Program')
  await expect(paneRows(page).locator('.app')).toHaveCount(0)
  await expect(activeHeader(page).locator('.title')).toHaveText('Program')
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(0)

  await page.keyboard.type(status('idle'))
  await expect(paneRows(page).locator('.title')).toHaveText('Claude')
  await expect(paneRows(page).locator('.app')).toHaveCount(1)
  await expect(activeHeader(page).locator('.title')).toHaveText('Claude')
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(1)
})

test('루트가 아닌 레코드만 있으면 상태를 보이지 않고, 루트 레코드가 오면 그 상태를 보인다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(status('working', 'id=build'))
  await page.keyboard.type('echo sub-$((1+1))\n')
  await expect(panes(page).first()).toContainText('sub-2')
  await expect(paneRows(page)).toHaveCount(0)
  await page.keyboard.type(status('error'))
  await expect(paneRows(page)).toHaveClass(/error/)
  await expect(activeHeader(page).locator('.status-icon')).toHaveAttribute('title', 'Error')
})

test('pane 줄은 그 터미널의 cell 아래에만, pane 헤더는 보이는 pane 의 상태를 따른다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await pressNew(app)
  await expect(cellItems(page)).toHaveCount(2)
  await page.waitForSelector('.terminal-view.active .xterm-screen')
  await page.keyboard.type(status('working'))
  await expect(groups(page).nth(1).locator('.pane-row')).toHaveClass(/working/)
  await expect(groups(page).nth(0).locator('.pane-row')).toHaveClass(/shell/)
  await expect(activeHeader(page)).toHaveClass(/working/)
  await cellItems(page).nth(0).click()
  await expect(activeHeader(page)).not.toHaveClass(/working/)
  await cellItems(page).nth(1).click()
  await expect(activeHeader(page)).toHaveClass(/working/)
})

test('셸 pane 과 Claude pane 모두 pane 마다 줄이 있고, 포커스된 pane 의 줄만 밝다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  const [left, right] = [0, 1].map((i) => paneHeader(page, i))
  await expect(shellRows(page)).toHaveCount(2)
  await expect(shellRows(page)).toHaveClass([/^(?!.*focused)/, /focused/])
  await expect(shellRows(page).first()).toHaveAttribute('aria-label', 'Shell')
  await page.keyboard.type(status('working'))
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

test('상태가 있는 pane 의 셸이 끝나면 pane 과 함께 사라지고, 다른 pane 의 상태는 그대로다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(status('working'))
  await clickMenu(app, 'focus-pane-left')
  await page.keyboard.type(status('done'))
  await expect(paneRows(page)).toHaveClass([/done/, /working/])

  await page.keyboard.type('exit\n')
  await expect(panes(page)).toHaveCount(1)
  await expect(paneRows(page)).toHaveCount(1)
  await expect(paneRows(page)).toHaveClass(/working/)
})

test('cell 헤더는 pane 상태 가운데 blocked, error, done, working 순으로 급한 것을 본다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  const header = page.locator('.cell-header')
  await page.keyboard.type(status('working'))
  await expect(header).toHaveClass(/working/)
  await clickMenu(app, 'focus-pane-left')
  await page.keyboard.type(status('done'))
  await expect(header).toHaveClass(/done/)
  await clickMenu(app, 'focus-pane-right')
  await page.keyboard.type(status('error'))
  await expect(header).toHaveClass(/error/)
  await clickMenu(app, 'focus-pane-left')
  await page.keyboard.type(status('blocked'))
  await expect(header).toHaveClass(/blocked/)
})

test('셸 pane 의 줄을 눌러도 그 pane 에 키 입력이 간다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)

  await shellRows(page).nth(0).click()

  await expect(shellRows(page).nth(0)).toHaveClass(/focused/)
  await typesInto(page, 0, 'shell-row')
})

test('pane 줄을 누르면 그 cell 을 고르고 그 pane 에 키 입력이 간다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(status('working'))
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

test('사이드바의 상태 아이콘과 Claude 아이콘은 잉크의 가운데를 행 가운데에서 0.5px 안에 그린다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(status('idle'))
  await split(app, page, 'split-down', 3)
  await page.keyboard.type(status('blocked', 'kind=permission'))
  await expect(paneRows(page)).toHaveClass([/idle/, /blocked/])
  const shell = shellRows(page)
  const [idle, blocked] = [paneRows(page).nth(0), paneRows(page).nth(1)]

  for (const [row, icons] of [
    [shell, ['.state']],
    [idle, ['.state', '.app']],
    [blocked, ['.state', '.app']]
  ] as const) {
    for (const offset of await inkOffsets(page, row, icons))
      expect(Math.abs(offset)).toBeLessThanOrEqual(0.5)
  }
})

async function inkOffsets(page: Page, row: Locator, icons: readonly string[]): Promise<number[]> {
  const clip = (await row.boundingBox())!
  const boxes = await Promise.all(icons.map(async (s) => (await row.locator(s).boundingBox())!))
  const image = await screenshotPixels(page, clip)
  const scale = image.width / clip.width
  const at = (x: number, y: number) => {
    const i = (y * image.width + x) * 4
    return image.data.slice(i, i + 3)
  }
  const background = at(image.width - 1, 0)
  return boxes.map((box) => {
    const inked = (y: number) => {
      for (
        let x = Math.floor((box.x - clip.x) * scale);
        x < (box.x + box.width - clip.x) * scale;
        x++
      )
        if (at(x, y).some((v, i) => Math.abs(v - background[i]) > 30)) return true
      return false
    }
    const rows = [...Array(image.height).keys()].filter(inked)
    return (rows[0] + rows[rows.length - 1] + 1) / 2 / scale - clip.height / 2
  })
}
