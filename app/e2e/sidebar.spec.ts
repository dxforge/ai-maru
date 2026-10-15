import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  claudeHook,
  clickMenu,
  expect,
  newWorkspace,
  paneRows,
  panes,
  resizeBy,
  run,
  split,
  test,
  toggleView,
  workspaceGroups,
  workspaceItems,
  zshHome
} from './app'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })
}

function repoHome(dataDir: string): string {
  const home = zshHome(dataDir, 'proj', 'notes')
  git(join(home, 'proj'), 'init', '-q', '-b', 'main')
  git(join(home, 'proj'), 'commit', '-q', '--allow-empty', '-m', 'init')
  return home
}

const branch = (page: Page) =>
  workspaceGroups(page).and(page.locator('.selected')).locator('.branch')
const path = (page: Page) => workspaceGroups(page).locator('.path')

function win(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { title: w.getTitle(), path: w.getRepresentedFilename() }
  })
}

test('저장소 안에서는 저장소 이름과 branch 를, 밖에서는 디렉토리 이름만 사이드바와 타이틀바에 보인다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await expect(workspaceItems(page)).toHaveText(['home'])
  await expect(branch(page)).toHaveCount(0)
  await expect(path(page)).toHaveText('~')

  await page.keyboard.type('cd proj/.git\n')
  await page.keyboard.type('cd ..; mkdir -p a/b; cd a/b\n')
  await expect(workspaceItems(page)).toHaveText(['proj'])
  await expect(branch(page)).toHaveText(/main$/)
  await expect(path(page)).toHaveText('~/proj/a/b')
  await expect.poll(() => win(app)).toEqual({ title: 'proj — main', path: join(home, 'proj/a/b') })

  await page.keyboard.type('cd ~/notes\n')
  await expect(workspaceItems(page)).toHaveText(['notes'])
  await expect(branch(page)).toHaveCount(0)
  await expect.poll(() => win(app)).toEqual({ title: 'notes', path: join(home, 'notes') })
})

test('셸에서 branch 를 바꾸면 다음 프롬프트에 따라가고, worktree 는 원래 저장소 이름을 쓴다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)

  await page.keyboard.type('git switch -q -c feat/1-x\n')
  await expect(branch(page)).toHaveText(/feat\/1-x$/)
  await expect.poll(async () => (await win(app)).title).toBe('proj — feat/1-x')

  await page.keyboard.type('git switch -q --detach\n')
  await expect(branch(page)).toHaveText(/[0-9a-f]{7}$/)

  await page.keyboard.type('git worktree add -q -b wt ../proj-wt && cd ../proj-wt\n')
  await expect(workspaceItems(page)).toHaveText(['proj'])
  await expect(branch(page)).toHaveText(/wt$/)
})

test('프롬프트가 뜨지 않아도 Claude 의 상태가 바뀌면 branch 를 다시 읽는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)

  // claude 가 일하는 동안처럼 프롬프트가 돌아오지 않게 sleep 으로 붙든다.
  const hook = claudeHook('UserPromptSubmit').trimEnd()
  await page.keyboard.type(`git switch -q -c by-claude && ${hook} && sleep 30\n`)
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(branch(page)).toHaveText(/by-claude$/)
})

test('경로는 고른 workspace 에만 보이고 눌러도 키 입력이 터미널에 남으며, columns 의 workspace 머리에도 branch 가 붙는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await newWorkspace(launched, 2)
  await expect(path(page)).toHaveCount(1)
  await expect(workspaceGroups(page).nth(1).locator('.path')).toHaveText('~/proj')

  await workspaceItems(page).nth(0).click()
  await expect(workspaceGroups(page).nth(0).locator('.path')).toHaveText('~/proj')
  await expect(path(page)).toHaveCount(1)
  await path(page).click()
  await run(page, 'echo path-$((1+1))', 'path-2')

  await toggleView(launched, 'columns')
  await expect(page.locator('.workspace-header .branch')).toHaveText(['main', 'main'])
})

test('고른 workspace 를 바꾸면 창 제목과 폴더 아이콘이 그것을 따른다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { app, page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await newWorkspace(launched, 2)
  await page.keyboard.type('cd ~/notes\n')
  await expect.poll(() => win(app)).toEqual({ title: 'notes', path: join(home, 'notes') })

  await workspaceItems(page).nth(0).click()
  await expect.poll(() => win(app)).toEqual({ title: 'proj — main', path: join(home, 'proj') })
  await workspaceItems(page).nth(1).click()
  await expect.poll(() => win(app)).toEqual({ title: 'notes', path: join(home, 'notes') })
})

test('창 틀은 시스템 설정 대신 터미널 배경의 밝기를 따른다', async ({ launch }) => {
  const { app } = await launch()
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
})

test('branch 이름이 길면 branch 를 줄이고, 셸 수는 제 너비로 workspace 줄 안에 남는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await run(page, `git switch -q -c ${'b'.repeat(120)}; echo ok-$((1+1))`, 'ok-2')
  await expect(branch(page)).toHaveText(/b{120}$/)
  const list = page.locator('.sidebar .list')
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0)
  const fit = await page.evaluate(() => {
    const row = document.querySelector('.sidebar .workspace')!.getBoundingClientRect()
    const shells = document.querySelector<HTMLElement>('.sidebar .shells')!
    const name = document.querySelector<HTMLElement>('.sidebar .branch-name')!
    return {
      shellsWhole: shells.scrollWidth <= shells.clientWidth,
      shellsInside: shells.getBoundingClientRect().right <= row.right,
      branchCut: name.scrollWidth > name.clientWidth
    }
  })
  expect(fit).toEqual({ shellsWhole: true, shellsInside: true, branchCut: true })
})

test('마지막 workspace 를 닫으면 창 제목과 폴더 아이콘이 앱의 것으로 돌아온다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect.poll(async () => (await win(app)).title).toBe('proj — main')
  await page.keyboard.type('exit\n')
  await expect(workspaceItems(page)).toHaveCount(0)
  await expect.poll(() => win(app)).toEqual({ title: 'AI Maru', path: '' })
})

const railGroups = (page: Page) => page.locator('.rail .group')

async function sidebarWidth(page: Page): Promise<number> {
  return (await page.locator('.sidebar').boundingBox())!.width
}

async function dragResizer(page: Page, dx: number): Promise<void> {
  const handle = (await page.locator('.resizer').boundingBox())!
  const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
}

async function twoClaudes(app: ElectronApplication, page: Page): Promise<void> {
  await page.keyboard.type(`${claudeHook('UserPromptSubmit', 'c-1').trimEnd()} && sleep 600\n`)
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(`${claudeHook('PermissionRequest', 'c-2').trimEnd()} && sleep 600\n`)
  await expect(paneRows(page)).toHaveClass([/working/, /waiting/])
}

test('접기 화살표는 Claude pane 이 있는 workspace 에만 있고, 그 pane 줄을 접고 편다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await twoClaudes(app, page)
  await newWorkspace(launched, 2)
  const fold = workspaceGroups(page).locator('.fold')
  await expect(fold).toHaveCount(1)

  await fold.click()

  await expect(fold).toHaveAttribute('aria-expanded', 'false')
  await expect(paneRows(page)).toHaveCount(0)
  await fold.click()
  await expect(paneRows(page)).toHaveCount(2)
})

test('접은 사이드바는 workspace 마다 이름과 Claude pane 상태를 한 카드에 보이고, 카드는 workspace 를, 상태 아이콘은 그 pane 을 고른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await twoClaudes(app, page)
  await newWorkspace(launched, 2)
  const names = await workspaceItems(page).allInnerTexts()

  await clickMenu(app, 'toggle-sidebar')

  await expect(page.locator('.sidebar')).toBeHidden()
  await expect(railGroups(page).locator('.workspace')).toHaveText(names)
  await expect(railGroups(page).nth(1)).toHaveClass(/selected/)
  await expect(railGroups(page).nth(0).locator('.pane-row')).toHaveClass([/working/, /waiting/])

  await railGroups(page).nth(0).locator('.pane-row').nth(0).click()

  await expect(railGroups(page).nth(0)).toHaveClass(/selected/)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await railGroups(page).nth(1).click()
  await expect(railGroups(page).nth(1)).toHaveClass(/selected/)
})

test('접은 workspace 는 접은 사이드바에서 가장 급한 상태 하나로 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await twoClaudes(app, page)
  await workspaceGroups(page).locator('.fold').click()

  await clickMenu(app, 'toggle-sidebar')

  await expect(railGroups(page).locator('.pane-row')).toHaveCount(0)
  await expect(railGroups(page).locator('.icons > .waiting')).toHaveCount(1)
})

test('사이드바 오른쪽 경계를 끌어 폭을 200~480 사이로 바꾸고, 접었다 펴도 그 폭이다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await sidebarWidth(page)

  await dragResizer(page, 60)
  await expect.poll(() => sidebarWidth(page)).toBe(before + 60)
  await dragResizer(page, -600)
  await expect.poll(() => sidebarWidth(page)).toBe(200)
  await dragResizer(page, 600)
  await expect.poll(() => sidebarWidth(page)).toBe(480)

  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.sidebar')).toBeHidden()
  await clickMenu(app, 'toggle-sidebar')
  await expect.poll(() => sidebarWidth(page)).toBe(480)
})

test('끄는 도중 사이드바를 닫아도 끌기가 끝나, 다시 여닫을 때 폭이 부드럽게 바뀐다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const handle = (await page.locator('.resizer').boundingBox())!
  const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 30, y, { steps: 3 })

  await clickMenu(app, 'toggle-sidebar')
  await page.mouse.up()

  await expect(page.locator('.side')).not.toHaveClass(/resizing/)
  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.side')).not.toHaveClass(/resizing/)
})

test('창이 좁아지면 사이드바는 창 폭의 반까지만 차지한다', async ({ launch }) => {
  const { app, page } = await launch()
  await dragResizer(page, 600)
  await expect.poll(() => sidebarWidth(page)).toBe(480)

  await resizeBy(app, -400, 0)

  await expect
    .poll(async () => (await sidebarWidth(page)) / (await page.evaluate(() => innerWidth)))
    .toBeLessThanOrEqual(0.5)
  const terminals = async (): Promise<number> =>
    (await page.locator('.terminals').boundingBox())!.width
  await expect.poll(terminals).toBeGreaterThan(250)
})

test('목록을 스크롤해도 신호등 버튼 자리는 비어 있다', async ({ launch }) => {
  const launched = await launch()
  const { app, page } = launched
  await resizeBy(app, 0, -450)
  for (let n = 2; n <= 8; n++) await newWorkspace(launched, n)
  const underButtons = (): Promise<string | null> =>
    page.evaluate(() => document.elementFromPoint(40, 14)!.closest('button')?.className ?? null)

  await page.locator('.sidebar .list').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  expect(await underButtons()).toBeNull()
  await clickMenu(app, 'toggle-sidebar')
  await page.locator('.rail .list').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  expect(await underButtons()).toBeNull()
})

test('펼친 사이드바에서도 접은 workspace 는 가장 급한 상태 하나를 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await twoClaudes(app, page)

  await workspaceGroups(page).locator('.fold').click()

  await expect(workspaceGroups(page).locator('.summary')).toHaveClass(/waiting/)
})

test('Claude 가 다 끝나면 접힘이 풀려, 다시 띄우면 pane 줄이 펼쳐져 나온다', async ({ launch }) => {
  const { page } = await launch()
  await page.keyboard.type(claudeHook('UserPromptSubmit'))
  await workspaceGroups(page).locator('.fold').click()
  await expect(paneRows(page)).toHaveCount(0)

  await page.keyboard.type('"$MARU_CLI" claude exit\n')
  await expect(workspaceGroups(page).locator('.fold')).toHaveCount(0)
  await page.keyboard.type(claudeHook('UserPromptSubmit'))

  await expect(paneRows(page)).toHaveCount(1)
})

test('사이드바와 접은 사이드바의 빈 곳으로 창을 끌고, 누르는 곳은 끌지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const region = (selector: string): Promise<string> =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))

  expect(await region('.sidebar')).toBe('drag')
  expect(await region('.sidebar .workspace')).toBe('no-drag')
  expect(await region('.resizer')).toBe('no-drag')
  await clickMenu(app, 'toggle-sidebar')
  expect(await region('.rail')).toBe('drag')
  expect(await region('.rail .group')).toBe('no-drag')
})
