import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  activeHeader,
  clickMenu,
  expect,
  focusPane,
  inProgram,
  newWorkspace,
  restartWith,
  paneHeader,
  paneRows,
  panes,
  pressNew,
  programStatus as status,
  run,
  shellRows,
  shellValue,
  split,
  test,
  typesInto,
  cellGroups as groups,
  cellItems,
  windowLosesFocus,
  writeConfig,
  zshHome
} from './app'
import { ICONS, STATE_LABELS } from '../src/renderer/src/icons'
import { DEFAULT_NOTIFICATION } from '../src/renderer/src/config/notification'

const SEEN_MS = DEFAULT_NOTIFICATION.seenMs!

/** 보고 있는 pane 에 쓴 done 이 바로 idle 로 바뀌지 않게 한다. done 을 보이는 것을 재는 테스트가 쓴다. */
function keepDone(dataDir: string): void {
  writeConfig(dataDir, '[notification]\nseen-ms = false\n')
}

test('claude 가 clear 를 보내지 못하고 죽어도 foreground 가 셸로 돌아오면 상태가 사라진다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir)
  const bin = join(dataDir, 'fakebin')
  mkdirSync(bin)
  const pidFile = join(dataDir, 'claude.pid')
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh\necho $$ > '${pidFile}'\n${status('idle')}sleep 60\n`,
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

test('claude 가 clear 없이 끝나면 maru status 로 쓴 하위 레코드도 함께 지운다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir)
  const bin = join(dataDir, 'fakebin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh\nprintf '\\033]7501;state=done:app=claude-code\\033\\\\'\n"$MARU_CLI" status put blocked --id ask --kind question\nsleep 2\n`,
    { mode: 0o755 }
  )
  const { page } = await launch({
    SHELL: '/bin/zsh',
    HOME: home,
    PATH: `${bin}:${process.env.PATH}`
  })
  await page.keyboard.type('claude\n')
  await expect(paneRows(page)).toHaveClass(/blocked/)

  await expect(paneRows(page)).toHaveCount(0)
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(0)
})

test('OSC 7501 보고가 오면 사이드바의 pane 줄과 pane 헤더의 상태가 바뀌고, clear 로 사라진다', async ({
  launch,
  dataDir
}) => {
  keepDone(dataDir)
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
  await expect(paneRows(page)).toHaveAttribute('aria-label', 'Working: task-42, ~')
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

test('상태 아이콘은 상태마다 SVG 로 그리고, working 만 움직이며, 상태가 사라지면 terminal glyph 로 돌아온다', async ({
  launch,
  dataDir
}) => {
  keepDone(dataDir)
  const { page } = await launch()
  const icons = [
    paneRows(page).locator('.state'),
    activeHeader(page).locator('.status-icon'),
    page.locator('.cell-header .status-icon')
  ]
  // 사이드바는 쉬는 agent 의 앞 칸에 상태 아이콘 대신 agent 아이콘을 두므로, agent 가 아닌 app 으로 모든 상태를 그린다.
  for (const state of Object.keys(STATE_LABELS)) {
    await page.keyboard.type(status(state, undefined, 'make'))
    await expect(paneRows(page)).toHaveClass(new RegExp(state))
    for (const icon of icons) {
      const svg = icon.locator('svg')
      await expect(svg).toHaveAttribute('data-state', state)
      expect(await svg.evaluate((el) => el.getAnimations().length)).toBe(
        state === 'working' ? 1 : 0
      )
    }
  }

  await page.keyboard.type(status('clear'))
  await expect(paneRows(page)).toHaveCount(0)
  const header = activeHeader(page).locator('.status-icon')
  await expect(header.locator('svg')).toHaveCount(0)
  await expect(header).toHaveText(ICONS.terminal)
  await expect(page.locator('.cell-header .status-icon svg')).toHaveCount(0)
})

test('루트 레코드의 app 이 claude-code 가 아니면 Claude 이름·아이콘 대신 app 값을 보인다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(status('working', undefined, 'make'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(paneRows(page).locator('.title')).toHaveText('make')
  await expect(paneRows(page)).toHaveAttribute('aria-label', /^Working: make, /)
  await expect(activeHeader(page).locator('.title')).toHaveText('make')
  await expect(activeHeader(page).locator('.status-icon')).toHaveAttribute('title', 'Working')
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(0)
})

test('maru status 로 쓴 하위 레코드가 루트보다 급하면 사이드바·pane 헤더·cell 헤더가 그것을 보인다', async ({
  launch,
  dataDir
}) => {
  keepDone(dataDir)
  const { page } = await launch()
  const cellHeader = page.locator('.cell-header')
  await inProgram(page)
  await page.keyboard.type(status('done'))
  await expect(paneRows(page)).toHaveClass(/done/)

  await page.keyboard.type("maru status put blocked --id ask --kind question --msg 'Which one?'\n")
  await expect(paneRows(page)).toHaveClass(/blocked/)
  await expect(paneRows(page).locator('.title')).toHaveText('Claude')
  await expect(activeHeader(page)).toHaveClass(/blocked/)
  await expect(activeHeader(page).locator('.claude-icon')).toHaveCount(1)
  await expect(cellHeader).toHaveClass(/blocked/)
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
  await expect(shellRows(page).first()).toHaveAttribute('aria-label', /^bash, /)
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
  launch,
  dataDir
}) => {
  keepDone(dataDir)
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(status('working'))
  await focusPane(app, page, 'focus-pane-left', 0)
  await page.keyboard.type(status('done'))
  await expect(paneRows(page)).toHaveClass([/done/, /working/])

  await page.keyboard.type('exit\n')
  await expect(panes(page)).toHaveCount(1)
  await expect(paneRows(page)).toHaveCount(1)
  await expect(paneRows(page)).toHaveClass(/working/)
})

test('cell 헤더는 pane 상태 가운데 급한 것을 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await split(app, page, 'split-right', 2)
  const header = page.locator('.cell-header')
  await page.keyboard.type(status('working'))
  await expect(header).toHaveClass(/working/)
  await focusPane(app, page, 'focus-pane-left', 0)
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

/** 지금 focus 를 가진 pane 의 pty id. */
function ptyIdOf(page: Page, dataDir: string, name: string): Promise<string> {
  return shellValue(page, dataDir, name, '$MARU_PTY_ID')
}

test('다른 pane 에 있을 때 done 이 된 pane 에 들어가 머물면 떠나지 않아도 idle 이 된다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const left = await ptyIdOf(page, dataDir, 'left')
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(`maru status put done --pty ${left} --app claude-code\n`)
  await expect(paneHeader(page, 0)).toHaveClass(/done/)
  await focusPane(app, page, 'focus-pane-left', 0)
  await expect(paneHeader(page, 0)).toHaveClass(/idle/)
  await expect(paneRows(page)).toHaveClass(/idle/)
  await expect(paneRows(page).locator('.title')).toHaveText('Claude')
  await expect(page.locator('.cell-header')).toHaveClass(/idle/)
})

test('보고 있는 pane 에 온 done 은 바로 idle 이 되고, 앱 창에 focus 가 없을 때 온 done 은 남는다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(status('working'))
  await expect(paneRows(page)).toHaveClass(/working/)
  await page.keyboard.type(status('done'))
  await expect(paneRows(page)).toHaveClass(/idle/)

  await windowLosesFocus(page)
  await page.keyboard.type(status('done'))
  await expect(paneRows(page)).toHaveClass(/done/)
  await page.waitForTimeout(SEEN_MS)
  await expect(paneRows(page)).toHaveClass(/done/)
})

test('런처로 키보드 focus 가 머무는 시간 안에 빠지면 done 이 남고, 런처를 닫고 돌아오면 그때부터 다시 잰다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const left = await ptyIdOf(page, dataDir, 'left')
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(`maru status put done --pty ${left} --app claude-code\n`)
  await expect(paneHeader(page, 0)).toHaveClass(/done/)
  const launcherQuery = page.locator('.launcher .query')

  await focusPane(app, page, 'focus-pane-left', 0)
  await clickMenu(app, 'launcher')
  await expect(launcherQuery).toBeFocused()
  await page.waitForTimeout(SEEN_MS)
  await page.keyboard.press('Escape')
  await expect(page.locator('.xterm-helper-textarea:focus')).toHaveCount(1)
  await clickMenu(app, 'launcher')
  await expect(launcherQuery).toBeFocused()
  await page.waitForTimeout(SEEN_MS)
  await expect(paneHeader(page, 0)).toHaveClass(/done/)

  await page.keyboard.press('Escape')
  await expect(panes(page).nth(0).locator('.xterm-helper-textarea:focus')).toHaveCount(1)
  await expect(paneHeader(page, 0)).toHaveClass(/idle/)
})

test('마우스로 pane 을 눌러 들어와도 머물면 idle 이 된다', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  const left = await ptyIdOf(page, dataDir, 'left')
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(`maru status put done --pty ${left} --app claude-code\n`)
  await expect(paneHeader(page, 0)).toHaveClass(/done/)
  await panes(page).nth(0).locator('.xterm-screen').click()
  await expect(paneHeader(page, 0)).toHaveClass(/idle/)
})

test('idle 로 바꾼 레코드는 재시작한 앱에도 idle 이다', async ({ launch }) => {
  const { app, page } = await launch()
  await page.keyboard.type(status('done'))
  await expect(paneRows(page)).toHaveClass(/idle/)

  await restartWith(app)
  const { page: again } = await launch()
  await expect(paneRows(again)).toHaveClass(/idle/)
})

test('idle 로 바꿀 때 루트와 하위의 done 은 idle 이 되고 blocked·error 는 그대로다', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const left = await ptyIdOf(page, dataDir, 'left')
  await inProgram(page)
  await run(
    page,
    'maru status put done --app claude-code --title T --msg finished && maru status put done --id build && maru status put blocked --id ask --kind question && maru status put error --id fail; echo put-$((1+1))',
    'put-2'
  )
  await expect(paneRows(page)).toHaveClass(/blocked/)
  await split(app, page, 'split-right', 2)
  await page.waitForTimeout(SEEN_MS)
  await expect(paneRows(page)).toHaveClass(/blocked/)

  await page.keyboard.type(`maru status clear --pty ${left} --id ask\n`)
  await expect(paneRows(page)).toHaveClass(/error/)
  // build 가 done 으로 남았으면 루트의 idle 대신 done 을 보인다.
  await page.keyboard.type(`maru status clear --pty ${left} --id fail\n`)
  await expect(paneRows(page)).toHaveClass(/idle/)
  await expect(paneRows(page).locator('.title')).toHaveText('Claude')
  // idle 로 다시 쓴 루트 레코드가 app 과 message 를 그대로 가졌다.
  const out = join(dataDir, 'panes.out')
  await run(page, `maru pane list >${out}; echo listed-$?`, 'listed-0')
  const row = readFileSync(out, 'utf8')
    .split('\n')
    .map((l) => l.split('\t'))
    .find((cols) => cols[0] === left)!
  expect([row[1], row[2], row[7]]).toEqual(['idle', 'claude-code', 'finished'])
})
