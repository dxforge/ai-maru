import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import {
  clickMenu,
  collapseSidebar,
  dragHandle,
  grabHandle,
  expect,
  foregroundNames,
  git,
  newWorkspace,
  openPalette,
  paneRows,
  panes,
  programStatus,
  resizeBy,
  restartWith,
  run,
  screen,
  shellRows,
  shellSize,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarResizer,
  sidebarWidth,
  split,
  test,
  watchTerminalWidths,
  cellGroups,
  cellItems,
  cellFavorite,
  CLASSIC_SCROLLBARS,
  cellPlaces,
  dialogCalls,
  END_EVERYTHING,
  newCell,
  openCanvas,
  sockets,
  stubDialog,
  workspaceHeads,
  workspaceNames,
  toast,
  writeConfig,
  zshHome
} from './app'

// 셸에서 친 git 은 `/usr/bin/git`(xcrun shim)을 거치므로, 부하가 걸리면 `git switch` 한 번에 최대 3.6초 걸렸다. 15초는 그 값에 여유를 둔 것이고 잰 근거는 없다.
const shellGit = { timeout: 15_000 }

const opacity = (el: Locator) => el.evaluate((e) => Number(getComputedStyle(e).opacity))

function repoHome(dataDir: string): string {
  const home = zshHome(dataDir, 'proj', 'notes')
  git(join(home, 'proj'), 'init', '-q', '-b', 'main', '--ref-format=files')
  git(join(home, 'proj'), 'commit', '-q', '--allow-empty', '-m', 'init')
  return home
}

const branch = (page: Page) =>
  cellGroups(page).and(page.locator('.selected')).locator('.pane-row.focused .place .branch')
const tip = (page: Page) =>
  cellGroups(page).and(page.locator('.selected')).locator('.pane-row.focused')

function win(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { title: w.getTitle(), path: w.getRepresentedFilename() }
  })
}

test('저장소 안에서는 저장소 이름과 branch 를, 밖에서는 디렉토리 이름만 툴팁과 타이틀바에 보인다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await expect(cellPlaces(page)).toHaveText(['~'])
  await expect(branch(page)).toHaveCount(0)
  await expect(tip(page)).toHaveAttribute('data-tooltip', /\n~$/)

  await page.keyboard.type('cd proj/.git\n')
  await page.keyboard.type('cd ..; mkdir -p a/b; cd a/b\n')
  await expect(branch(page)).toHaveText(/main$/)
  await expect(tip(page)).toHaveAttribute('data-tooltip', /\n~\/proj\/a\/b$/)
  await expect.poll(() => win(app)).toEqual({ title: 'proj — main', path: join(home, 'proj/a/b') })

  await page.keyboard.type('cd ~/notes\n')
  await expect(cellPlaces(page)).toHaveText(['notes'])
  await expect(branch(page)).toHaveCount(0)
  await expect.poll(() => win(app)).toEqual({ title: 'notes', path: join(home, 'notes') })
})

test('workspace 이름 줄은 첫 pane 이 홈 밖으로 처음 간 디렉토리의 저장소 이름(저장소 밖이면 디렉토리 이름)이고 branch 가 없으며, 첫 cell 이 닫히면 남은 첫 pane 을 따르고 접은 사이드바에서도 보인다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { app, page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await expect(workspaceNames(page)).toHaveText(['proj'])

  await newCell(launched, 2)
  await page.keyboard.type('cd ~/notes\n')
  await expect(cellPlaces(page)).toHaveText([/main$/, 'notes'])
  await expect(workspaceNames(page)).toHaveText(['proj'])

  await cellItems(page).nth(0).click()
  await page.keyboard.type('exit\n')
  await expect(cellPlaces(page)).toHaveText(['notes'])
  await expect(workspaceNames(page)).toHaveText(['notes'])

  await collapseSidebar(app, page)
  await expect(workspaceNames(page)).toBeVisible()
  await expect.poll(() => opacity(workspaceNames(page))).toBeGreaterThan(0)
})

test('cell 이름은 workspace 와 다른 부분만 적는다: 같은 저장소는 branch, 이름이 같은 다른 클론은 이름과 branch', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  // 두 저장소는 이름이 같으므로 `main/git.ts` 가 찾은 common 디렉토리가 renderer 까지 와야만 다른 저장소로 갈린다.
  mkdirSync(join(home, 'clone'))
  git(join(home, 'clone'), 'init', '-q', '-b', 'main', 'proj')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await newCell(launched, 2)
  await page.keyboard.type('cd ~/clone/proj\n')
  await expect(cellPlaces(page).nth(1)).toHaveText(/^proj\S?main$/)
  await expect(cellPlaces(page).nth(0)).toHaveText(/^\S?main$/)
  await expect(cellGroups(page).nth(0).locator('.name')).toHaveCount(0)
})

test('reftable 저장소로 cd 하면 앱이 git 으로 branch 를 읽는 동안 cell 이름에 이전 저장소의 branch 를 남기지 않고 디렉토리 이름을 보인다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  mkdirSync(join(home, 'proj', 'app', 'e2e'), { recursive: true })
  mkdirSync(join(home, 'rt'))
  git(join(home, 'rt'), 'init', '-q', '-b', 'dev', '--ref-format=reftable')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await newCell(launched, 2)
  await page.keyboard.type('cd app/e2e\n')
  const place = cellPlaces(page).nth(1)
  await expect(place).toHaveText(/^\S?main· app\/e2e$/)

  // 화면에 그린 cell 이름을 바뀔 때마다 모은다. 명령이 도는 동안에는 `.place` 대신 명령을 그리므로 null 이 섞인다.
  await cellGroups(page)
    .nth(1)
    .evaluate((g) => {
      const read = () => g.querySelector('.pane-row:first-of-type .place')?.textContent ?? null
      const places = [read()]
      Object.assign(window, { places })
      new MutationObserver(() => {
        const now = read()
        if (places.at(-1) !== now) places.push(now)
      }).observe(g, { childList: true, subtree: true, characterData: true })
    })
  await page.keyboard.type('cd ~/rt\n')
  await expect(place).toHaveText(/^rt\S?dev$/, shellGit)
  const drawn = await page.evaluate(
    () => (window as unknown as { places: (string | null)[] }).places
  )
  const places: string[] = []
  for (const p of drawn) if (p !== null && p !== places.at(-1)) places.push(p)
  expect(places).toEqual([
    expect.stringMatching(/^\S?main· app\/e2e$/),
    'rt',
    expect.stringMatching(/^rt\S?dev$/)
  ])
})

test('셸로 branch 를 바꾸면 다음 프롬프트에 따라가고, worktree 는 원래 저장소 이름을 쓴다', async ({
  launch,
  dataDir
}) => {
  // `shellGit` 을 네 번 기다리므로 다 쓰면 기본 30초를 넘는다.
  test.slow()
  const home = repoHome(dataDir)
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/, shellGit)

  await page.keyboard.type('git switch -q -c feat/1-x\n')
  await expect(branch(page)).toHaveText(/feat\/1-x$/, shellGit)
  await expect.poll(async () => (await win(app)).title).toBe('proj — feat/1-x')

  await page.keyboard.type('git switch -q --detach\n')
  await expect(branch(page)).toHaveText(/[0-9a-f]{7}$/, shellGit)

  await page.keyboard.type('git worktree add -q -b wt ../proj-wt && cd ../proj-wt\n')
  // worktree 로 cd 하기 전에도 cell 이름이 `proj` 이므로, branch 가 `wt` 로 바뀐 뒤에 이름을 확인한다.
  await expect(branch(page)).toHaveText(/wt$/, shellGit)
  await expect(tip(page)).toHaveAttribute('data-tooltip', /\n~\/proj-wt$/)
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
  const report = programStatus('working').trimEnd()
  await page.keyboard.type(`(git switch -q -c by-claude && ${report} && sleep 30)\n`)
  await expect(paneRows(page)).toHaveClass(/working/, shellGit)
  await expect(branch(page)).toHaveText(/by-claude$/)
})

test('돌고 있는 프로그램이 다른 worktree 로 옮겨 간 채 Claude 의 상태가 바뀌면 그 프로그램의 cwd 로 branch 를 읽고, 프롬프트가 돌아오면 셸의 cwd 로 돌아간다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  git(join(home, 'proj'), 'worktree', 'add', '-q', '-b', 'wt', '../proj-wt')
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)

  // claude 가 EnterWorktree 로 cwd 를 옮긴 채 일하는 상황을 흉내 낸다. 서브셸이 worktree 로 cd 한 뒤 상태를 보고하고, sleep 으로
  // 프롬프트가 돌아오지 않게 한다. 서브셸이 foreground 프로세스 그룹의 리더이므로 pty 는 서브셸의 cwd 를 답한다. 프롬프트가
  // 마지막으로 보낸 OSC 7 은 아직 `~/proj` 다.
  const report = programStatus('working').trimEnd()
  await page.keyboard.type(`(cd ../proj-wt && ${report} && sleep 30)\n`)
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(tip(page)).toHaveAttribute('data-tooltip', /\n~\/proj-wt$/)

  await page.keyboard.press('Control+C')
  await expect(tip(page)).toHaveAttribute('data-tooltip', /\n~\/proj$/)
})

test('셸이 심볼릭 링크 경로에 있으면 Claude 의 상태가 바뀌어도 pane 의 경로는 그대로 두고 branch 만 다시 읽는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  symlinkSync(join(home, 'proj'), join(home, 'link'))
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd link\n')
  await expect(tip(page)).toHaveAttribute('data-tooltip', /\n~\/link$/)

  // `foreground` 는 실제 경로(`~/proj`)를 답하고, OSC 7 은 `$PWD`(`~/link`)를 준다. branch 를 바꿔 두고, branch 를 다시 읽은
  // 것을 확인한 뒤에 경로를 확인한다.
  const report = programStatus('working').trimEnd()
  await page.keyboard.type(`(git switch -q -c by-claude && ${report} && sleep 30)\n`)
  await expect(paneRows(page)).toHaveClass(/working/, shellGit)
  await expect(branch(page)).toHaveText(/by-claude$/)
  await expect(tip(page)).toHaveAttribute('data-tooltip', /\n~\/link$/)
  expect((await win(app)).path).toBe(join(home, 'link'))
})

test('maru cell new 로 바로 띄운 Claude 가 한 상태에 머문 채 다른 worktree 로 옮겨 가면, pty 가 알린 foreground 의 cwd 로 그 cell 의 branch 를 읽는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  git(join(home, 'proj'), 'worktree', 'add', '-q', '-b', 'wt', '../proj-wt')
  // claude 가 셸 없이 pane 의 명령으로 떠서, 한 턴 안에서 EnterWorktree 로 cwd 를 옮기는 상황을 흉내 낸다. 프롬프트가 없으므로
  // OSC 7 은 오지 않고, 옮긴 뒤 보고도 오지 않는다. pty 는 레코드가 생기면 foreground 의 cwd 를 바로 재고 그 뒤 1초마다 잰다.
  // 옮기기 전 디렉토리가 먼저 보이는지도 보려고 3초 뒤에 옮긴다.
  writeFileSync(
    join(home, 'claude.sh'),
    `${programStatus('working')}sleep 3\ncd ../proj-wt\nsleep 30\n`
  )
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('maru cell new --cwd ~/proj bash ~/claude.sh >/dev/null\n')
  const opened = cellGroups(page).nth(1).locator('.pane-row')
  await expect(paneRows(page)).toHaveClass(/working/)
  await expect(opened).toHaveAttribute('data-tooltip', /\n~\/proj$/)
  await expect(opened).toHaveAttribute('data-tooltip', /\n~\/proj-wt$/)
  await expect(paneRows(page)).toHaveClass(/working/)
})

test('maru cell new --cwd 로 심볼릭 링크 경로에 바로 띄운 Claude 의 cell 은 Claude 의 상태가 바뀌어도 그 링크 경로로 보인다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  symlinkSync(join(home, 'proj'), join(home, 'link'))
  // 셸 없이 pane 의 명령으로 뜬 claude 라 OSC 7 이 오지 않는다. `foreground` 는 실제 경로(`~/proj`)를 답한다. 두 번째 보고가
  // 보일 때는 첫 보고 때 잰 foreground cwd 가 이미 화면에 닿아 있다.
  writeFileSync(
    join(home, 'claude.sh'),
    `${programStatus('working')}sleep 2\n${programStatus('blocked')}sleep 30\n`
  )
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('maru cell new --cwd ~/link bash ~/claude.sh >/dev/null\n')
  const opened = cellGroups(page).nth(1).locator('.pane-row')
  await expect(paneRows(page)).toHaveClass(/blocked/)
  await expect(opened).toHaveAttribute('data-tooltip', /\n~\/link$/)
})

test('경로는 cell 마다 헤더 툴팁에 있고, 헤더를 눌러도 키 입력이 터미널에 남으며, cell 헤더에도 branch 가 붙는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await newWorkspace(launched, 2)
  await page.keyboard.type('cd ~/notes\n')
  await expect(cellItems(page).nth(1)).toHaveAttribute('data-tooltip', /\n~\/notes$/)
  await expect(cellItems(page).nth(0)).toHaveAttribute('data-tooltip', /\n~\/proj$/)

  await cellItems(page).nth(0).click()
  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)
  await run(page, 'echo path-$((1+1))', 'path-2')

  const branches = page.locator('.cell-header .branch')
  await expect(branches).toHaveText(['main'])
  await expect(branches).toBeVisible()
})

test('고른 cell 을 바꾸면 창 제목과 폴더 아이콘이 그것을 따른다', async ({ launch, dataDir }) => {
  const home = repoHome(dataDir)
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { app, page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await newWorkspace(launched, 2)
  await page.keyboard.type('cd ~/notes\n')
  await expect.poll(() => win(app)).toEqual({ title: 'notes', path: join(home, 'notes') })

  await cellItems(page).nth(0).click()
  await expect.poll(() => win(app)).toEqual({ title: 'proj — main', path: join(home, 'proj') })
  await cellItems(page).nth(1).click()
  await expect.poll(() => win(app)).toEqual({ title: 'notes', path: join(home, 'notes') })
})

test('창 틀은 시스템 설정 대신 터미널 배경의 밝기를 따른다', async ({ launch }) => {
  const { app } = await launch()
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
})

test('branch 이름이 길면 셸 줄의 위치에서 branch 를 줄이고, 위치는 줄 안에 남는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await page.keyboard.type(`git switch -q -c ${'b'.repeat(120)}; echo ok-$((1+1))\n`)
  await expect(screen(page)).toShow('ok-2', shellGit)
  await expect(branch(page)).toHaveText(/b{120}$/)
  const list = page.locator('.sidebar .list')
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0)
  const fit = await page.evaluate(() => {
    const row = document.querySelector('.sidebar .pane-row')!.getBoundingClientRect()
    const place = document.querySelector('.sidebar .place')!.getBoundingClientRect()
    const name = document.querySelector<HTMLElement>('.sidebar .branch-name')!
    return { placeInside: place.right <= row.right, branchCut: name.scrollWidth > name.clientWidth }
  })
  expect(fit).toEqual({ placeInside: true, branchCut: true })
})

test('마지막 cell 을 닫으면 창 제목과 폴더 아이콘이 앱의 것으로 돌아온다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect.poll(async () => (await win(app)).title).toBe('proj — main')
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(0)
  await expect.poll(() => win(app)).toEqual({ title: 'AI Maru', path: '' })
})

const collapsedGroups = (page: Page) => page.locator('.sidebar.collapsed .group')

async function twoClaudes(app: ElectronApplication, page: Page): Promise<void> {
  await page.keyboard.type(`(${programStatus('working').trimEnd()} && sleep 600)\n`)
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(
    `(${programStatus('blocked', 'kind=permission').trimEnd()} && sleep 600)\n`
  )
  await expect(paneRows(page)).toHaveClass([/working/, /blocked/])
}

test('접은 사이드바는 같은 목록을 오른쪽만 잘라 글자를 남기고 꼬리표를 숨기며, pane 줄은 그 pane 을 고른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await twoClaudes(app, page)
  await newWorkspace(launched, 2)

  await collapseSidebar(app, page)

  await expect(collapsedGroups(page).nth(1)).toHaveClass(/selected/)
  await expect(collapsedGroups(page).nth(0).locator('.pane-row')).toHaveClass([
    /working/,
    /blocked/
  ])
  await expect(collapsedGroups(page).nth(1).locator('.pane-row')).toHaveClass(/shell/)
  const title = collapsedGroups(page).locator('.pane-row .title').first()
  await expect(title).toBeVisible()
  await expect(title).toHaveText('Claude')
  await expect(collapsedGroups(page).locator('.pane-row .place')).toHaveCount(3)
  await expect(collapsedGroups(page).locator('.pane-row .place').first()).toBeHidden()

  await collapsedGroups(page).nth(0).locator('.pane-row').nth(0).click()

  await expect(collapsedGroups(page).nth(0)).toHaveClass(/selected/)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await collapsedGroups(page).nth(1).locator('.pane-row').click()
  await expect(collapsedGroups(page).nth(1)).toHaveClass(/selected/)
})

test('접고 펴도 pane 줄의 상태 아이콘과 cell 면은 같은 자리에 있고, 아이콘은 workspace 이름의 첫 글자와 같은 x 에 선다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await twoClaudes(app, page)
  await newWorkspace(launched, 2)
  const marks = (): Promise<number[][]> =>
    page.evaluate(() => [
      ...Array.from(document.querySelectorAll('.sidebar .row .state'), (el) => {
        const r = el.getBoundingClientRect()
        return [r.x + r.width / 2, r.y]
      }),
      Array.from(document.querySelectorAll('.sidebar .group'), (el) => el.getBoundingClientRect().y)
    ])
  const expanded = await marks()
  const lefts = await page.evaluate(() =>
    [
      document.querySelector('.sidebar .row .state')!,
      document.querySelector('.sidebar .workspace-name')!
    ].map((el) => {
      const r = el.getBoundingClientRect()
      return r.x + parseFloat(getComputedStyle(el).paddingLeft)
    })
  )
  expect(lefts[0]).toBe(lefts[1])

  await collapseSidebar(app, page)

  expect(await marks()).toEqual(expanded)
})

test('사이드바를 접고 펴는 동안에는 터미널 크기를 맞추지 않고, 폭이 다 바뀐 뒤 한 번 맞춘다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await shellSize(page)
  const width = await sidebarWidth(page)
  const widths = await watchTerminalWidths(page)

  await collapseSidebar(app, page)
  const collapsed = await shellSize(page)
  await clickMenu(app, 'toggle-sidebar')
  await expect.poll(() => sidebarWidth(page)).toBe(width)
  const expanded = await shellSize(page)

  expect(collapsed.cols).toBeGreaterThan(before.cols)
  expect(expanded.cols).toBe(before.cols)
  expect(await widths()).toHaveLength(3)
})

test('접히는 도중에 다시 펴도 터미널을 중간 폭으로 맞추지 않는다', async ({ launch }) => {
  const { app, page } = await launch()
  const width = await sidebarWidth(page)
  const widths = await watchTerminalWidths(page)

  await clickMenu(app, 'toggle-sidebar')
  // `.side` 의 width transition(180ms, `App.vue`)이 도는 도중에 되돌린다.
  await page.waitForTimeout(60)
  await clickMenu(app, 'toggle-sidebar')

  await expect.poll(() => sidebarWidth(page)).toBe(width)
  await expect.poll(() => page.locator('.side').evaluate((el) => el.getAnimations().length)).toBe(0)
  expect(await widths()).toHaveLength(1)
})

test('사이드바가 창 폭의 반에 걸린 채 창을 줄이면, 사이드바는 바로 따라가고 터미널은 한 번 맞춘다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await resizeBy(app, -500, 0)
  await expect.poll(() => sidebarWidth(page)).toBe(250)
  const widths = await watchTerminalWidths(page)

  await resizeBy(app, -60, 0)

  expect(await page.locator('.side').evaluate((el) => el.getAnimations().length)).toBe(0)
  await expect.poll(() => sidebarWidth(page)).toBe(220)
  await expect.poll(widths).toHaveLength(2)
  await page.waitForTimeout(300)
  expect(await widths()).toHaveLength(2)
})

test('창이 좁아 사이드바가 창 폭의 반에 걸려 있어도, 경계를 끈 만큼 폭이 바로 바뀐다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await dragHandle(page, sidebarResizer(page), 600)
  await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_MAX_WIDTH)
  await resizeBy(app, -400, 0)
  await expect.poll(() => sidebarWidth(page)).toBe(300)

  await dragHandle(page, sidebarResizer(page), -50)

  await expect.poll(() => sidebarWidth(page)).toBe(250)
})

test('경계는 왼쪽 버튼으로 끌 때만 폭이 바뀐다', async ({ launch }) => {
  const { page } = await launch()
  const before = await sidebarWidth(page)

  await dragHandle(page, sidebarResizer(page), 80, { button: 'right' })

  expect(await sidebarWidth(page)).toBe(before)
  await expect(page.locator('.side')).not.toHaveClass(/resizing/)
})

test('Canvas 를 연 채 사이드바를 펴는 동안에도 터미널이 Canvas 를 덮지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await clickMenu(app, 'toggle-canvas')
  await expect(page.locator('.canvas')).toBeVisible()
  await collapseSidebar(app, page)
  await page.evaluate(() => {
    const hits: boolean[] = []
    Object.assign(window, { hits })
    const c = document.querySelector('.canvas')!.getBoundingClientRect()
    const t0 = performance.now()
    const tick = (): void => {
      hits.push(!!document.elementFromPoint(c.left + 20, c.top + 200)?.closest('.canvas'))
      if (performance.now() - t0 < 300) requestAnimationFrame(tick)
      else Object.assign(window, { done: true })
    }
    requestAnimationFrame(tick)
  })

  await clickMenu(app, 'toggle-sidebar')

  await expect.poll(() => page.evaluate(() => 'done' in window)).toBe(true)
  const hits = await page.evaluate(() => (window as unknown as { hits: boolean[] }).hits)
  expect(hits.length).toBeGreaterThan(5)
  expect(hits.every(Boolean)).toBe(true)
})

test('사이드바 오른쪽 경계를 끌어 폭을 최소 폭과 최대 폭 사이로 바꾸고, 접었다 펴도 그 폭이다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await sidebarWidth(page)

  await dragHandle(page, sidebarResizer(page), 60)
  await expect.poll(() => sidebarWidth(page)).toBe(before + 60)
  await dragHandle(page, sidebarResizer(page), -600)
  await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_MIN_WIDTH)
  await dragHandle(page, sidebarResizer(page), 600)
  await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_MAX_WIDTH)

  await collapseSidebar(app, page)
  await clickMenu(app, 'toggle-sidebar')
  await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_MAX_WIDTH)
})

test('끄는 도중 사이드바를 닫아도 끌기가 끝나고, 그 뒤에도 키 입력이 터미널에 가며 터미널이 창 크기를 따른다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await grabHandle(page, sidebarResizer(page), 30)

  await clickMenu(app, 'toggle-sidebar')
  await page.mouse.up()

  await expect(page.locator('.side')).not.toHaveClass(/resizing/)
  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.side')).not.toHaveClass(/resizing/)
  const before = await shellSize(page)
  await resizeBy(app, -200, 0)
  await expect.poll(async () => (await shellSize(page)).cols).toBeLessThan(before.cols)
})

test('창이 좁아지면 사이드바는 창 폭의 반까지만 차지한다', async ({ launch }) => {
  const { app, page } = await launch()
  await dragHandle(page, sidebarResizer(page), 600)
  await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_MAX_WIDTH)

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
  await collapseSidebar(app, page)
  await page.locator('.sidebar .list').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  expect(await underButtons()).toBeNull()
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
  expect(await region('.sidebar .pane-row')).toBe('no-drag')
  expect(await region('.resizer')).toBe('no-drag')
  await collapseSidebar(app, page)
  expect(await region('.sidebar')).toBe('drag')
  expect(await region('.sidebar .pane-row')).toBe('no-drag')
})

const jobRows = (page: Page) => page.locator('.sidebar .job-row')

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  await new Promise((r) => server.close(r))
  return port
}

test('maru job 으로 띄운 job 은 그 cell 의 pane 줄 아래에 이름·듣는 포트·돈 시간으로 보이고, kill 하거나 cell 을 닫으면 사라진다', async ({
  launch
}) => {
  // 포트는 `PORT_INTERVAL_MS`(5초)마다 다시 재므로 포트가 보이기까지 기다리는 시간이 길어진다. 그래서 기본 시간 제한 30초를 넘을 수 있다.
  test.slow()
  const launched = await launch()
  const { page } = launched
  const port = await freePort()
  await run(
    page,
    `maru job new --name web python3 -m http.server ${port} --bind 127.0.0.1 && echo started-$((1+1))`,
    'started-2'
  )
  await expect(jobRows(page)).toHaveCount(1)
  const web = jobRows(page).first()
  await expect(web.locator('.state svg[data-icon="gear"]')).toBeVisible()
  await expect(web.locator('.title')).toHaveText('web')
  await expect(web).toHaveAttribute(
    'data-tooltip',
    `python3 -m http.server ${port} --bind 127.0.0.1`
  )
  await expect(web.locator('.time')).toHaveText('<1m')
  await expect(web.locator('.ports')).toHaveText(`:${port}`, { timeout: 15_000 })

  await run(page, 'maru job new sleep 600 && echo second-$((1+1))', 'second-2')
  await expect(jobRows(page).locator('.title')).toHaveText(['web', 'sleep 600'])

  await run(page, 'maru job kill web && echo killed-$((1+1))', 'killed-2')
  await expect(jobRows(page).locator('.title')).toHaveText(['sleep 600'])

  await newCell(launched, 2)
  await run(page, 'maru job new --name other sleep 600 && echo third-$((1+1))', 'third-2')
  await expect(cellGroups(page).nth(1).locator('.job-row .title')).toHaveText(['other'])
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(1)
  await expect(jobRows(page).locator('.title')).toHaveText(['sleep 600'])
})

test('끝난 job 은 남아 시간 자리에 exited 를 쓰고 종료 코드는 툴팁에 있으며, ✕ 를 누르면 묻지 않고 지운다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await stubDialog(app, 1)
  await run(page, "maru job new --name build sh -c 'exit 3' && echo started-$((1+1))", 'started-2')
  const build = jobRows(page).first()
  await expect(build).toHaveClass(/exited/)
  await expect(build.locator('.time')).toHaveText('exited')
  await expect(build).toHaveAttribute('data-tooltip', 'sh -c exit 3\nExited with code 3')

  await build.hover()
  await build.locator('.kill').click()

  await expect(jobRows(page)).toHaveCount(0)
  expect(await dialogCalls(app)).toEqual([])
  await run(page, 'maru job list', 'no jobs')
})

test('도는 job 의 ✕ 는 확인 창을 띄우고, 취소하면 남기며 Stop 을 고르면 끈다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await run(page, 'maru job new --name dev sleep 600 && echo started-$((1+1))', 'started-2')
  const dev = jobRows(page).first()
  await expect(dev.locator('.kill')).toHaveCSS('opacity', '0')
  await dev.hover()
  await expect.poll(() => opacity(dev.locator('.kill'))).toBeGreaterThan(0)
  await expect(dev.locator('.time')).toBeHidden()

  await stubDialog(app, 1)
  await dev.locator('.kill').click()
  await expect
    .poll(() => dialogCalls(app))
    .toMatchObject([
      { message: 'Stop this job?', detail: '`dev` is still running.', buttons: ['Stop', 'Cancel'] }
    ])
  await expect(jobRows(page)).toHaveCount(1)
  await run(page, 'maru job list', /dev\s+running/)

  await stubDialog(app, 0)
  await dev.hover()
  await dev.locator('.kill').click()
  await expect(jobRows(page)).toHaveCount(0)
  await run(page, 'maru job list', 'no jobs')
})

test('접은 사이드바에서는 job 줄의 꼬리표를 숨긴다', async ({ launch }) => {
  const { app, page } = await launch()
  await run(page, 'maru job new --name dev sleep 600 && echo started-$((1+1))', 'started-2')
  await expect(jobRows(page)).toHaveCount(1)

  await collapseSidebar(app, page)
  await expect(jobRows(page).locator('.title')).toBeVisible()
  await expect(jobRows(page).locator('.time')).toBeHidden()
  await jobRows(page).first().hover()
  await expect(jobRows(page).locator('.kill')).toBeHidden()
})

test('job ✕ 는 키보드로도 닿고, 포커스를 받으면 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await run(page, 'maru job new --name dev sleep 600 && echo started-$((1+1))', 'started-2')
  const kill = jobRows(page).first().locator('.kill')
  await kill.focus()
  await expect(kill).toBeFocused()
  await expect.poll(() => opacity(kill)).toBeGreaterThan(0)
  await stubDialog(app, 0)
  await page.keyboard.press('Enter')
  await expect(jobRows(page)).toHaveCount(0)
})

test('job 줄은 두 번째 workspace 의 cell 아래에도 붙고, 접었다 펴면 돌아온다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await run(page, 'maru job new --name second sleep 600 && echo started-$((1+1))', 'started-2')
  await expect(cellGroups(page).nth(0).locator('.job-row')).toHaveCount(0)
  await expect(cellGroups(page).nth(1).locator('.job-row .title')).toHaveText(['second'])
  const fold = workspaceHeads(page).nth(1)
  await fold.click()
  await expect(jobRows(page)).toHaveCount(0)
  await fold.click()
  await expect(cellGroups(page).nth(1).locator('.job-row .title')).toHaveText(['second'])
})

test('OSC 7501 의 app 이 agent 표에 없는 이름이면 사이드바와 pane 헤더에 agent 아이콘을 그리지 않는다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(programStatus('idle', undefined, 'constructor'))
  await expect(paneRows(page)).toHaveClass(/idle/)
  await expect(paneRows(page).locator('.state svg[data-state="idle"]')).toHaveCount(1)
  await expect(page.locator('.pane-header .claude-icon')).toHaveCount(0)
})

test('Codex 와 Kiro 는 쉬는 동안 사이드바 앞 칸에, 어느 상태에서나 pane 헤더에 그 로고를 둔다', async ({
  launch
}) => {
  const { page } = await launch()
  for (const [app, logo] of [
    ['codex', 'codex'],
    ['kiro-cli', 'kiro']
  ]) {
    await page.keyboard.type(programStatus('idle', undefined, app))
    await expect(paneRows(page).locator(`.state svg[data-icon="${logo}"]`)).toBeVisible()
    await expect(page.locator(`.pane-header .claude-icon[data-icon="${logo}"]`)).toBeVisible()
    await page.keyboard.type(programStatus('working', undefined, app))
    await expect(paneRows(page).locator('.state svg[data-state="working"]')).toBeVisible()
    await expect(page.locator(`.pane-header .claude-icon[data-icon="${logo}"]`)).toBeVisible()
  }
})

test('다른 저장소의 이름이 길어도 셸 줄의 branch 아이콘은 cell 면 안에 남는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const long = 'a-very-long-repository-name-that-does-not-fit'
  mkdirSync(join(home, long))
  git(join(home, long), 'init', '-q', '-b', 'dev')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await newCell(launched, 2)
  await page.keyboard.type(`cd ~/${long}\n`)
  await expect(cellGroups(page).nth(1).locator('.name')).toHaveText(long)
  // `.name` 은 git 을 읽기 전에도 디렉토리 이름이라 이미 맞으므로, 아이콘이 생길 때까지 따로 기다린다.
  await expect(cellGroups(page).nth(1).locator('.branch')).toHaveText(/dev$/)
  const inside = (): Promise<boolean> =>
    cellGroups(page)
      .nth(1)
      .evaluate((g) => {
        const face = g.getBoundingClientRect()
        const icon = g.querySelector('.branch svg')!.getBoundingClientRect()
        return icon.left >= face.left && icon.right <= face.right
      })
  expect(await inside()).toBe(true)
})

test('pane 줄은 오른쪽 끝에 위치를 두고, Claude 가 뜨고 끝나도 그 자리에 남으며, 쉬는 Claude 는 앞 칸에 Claude 아이콘을 둔다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  const row = cellGroups(page).locator('.pane-row')
  const place = row.locator('.place')
  await expect(place).toHaveText(/main$/)
  const right = async () => (await place.boundingBox())!.x + (await place.boundingBox())!.width
  const before = await right()
  await expect(row.locator('.state svg[data-icon="terminal"]')).toBeVisible()

  await page.keyboard.type(programStatus('working'))
  await expect(row).toHaveClass(/working/)
  await expect(row.locator('.state svg[data-state="working"]')).toHaveCount(1)
  await expect(place).toHaveText(/main$/)
  expect(await right()).toBe(before)

  await page.keyboard.type(programStatus('idle'))
  await expect(row).toHaveClass(/idle/)
  await expect(row.locator('.state svg[data-icon="claude"]')).toBeVisible()
  expect(await right()).toBe(before)

  await page.keyboard.type(programStatus('clear'))
  await expect(row).toHaveClass(/shell/)
  expect(await right()).toBe(before)
})

test('workspace 머리 줄을 누르면 그 workspace 의 cell 과 job 줄을 접고, 다시 누르면 편다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'maru job new --name dev sleep 600 && echo started-$((1+1))', 'started-2')
  await newWorkspace(launched, 2)
  await expect(cellGroups(page)).toHaveCount(2)

  await workspaceHeads(page).nth(0).click()

  await expect(workspaceHeads(page).nth(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(cellGroups(page)).toHaveCount(1)
  await expect(jobRows(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveCount(2)

  await workspaceHeads(page).nth(0).click()
  await expect(cellGroups(page)).toHaveCount(2)
  await expect(jobRows(page)).toHaveCount(1)
})

test('접은 workspace 는 머리 줄 앞 칸에 cell 들 가운데 가장 급한 상태를 보이고, 접은 사이드바에서도 남는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await twoClaudes(app, page)
  await newCell(launched, 2)
  const head = workspaceHeads(page).nth(0)
  await expect(head.locator('.state')).toHaveCount(0)

  await head.click()

  await expect(head.locator('.state')).toHaveClass(/blocked/)
  const expanded = (await head.locator('.state').boundingBox())!
  await collapseSidebar(app, page)
  await expect(head.locator('.state')).toBeVisible()
  expect(await head.locator('.state').boundingBox()).toEqual(expanded)
})

test('셸 pane 에서 명령이 도는 동안 이름 자리에 명령을, 꼬리에 돈 시간을 보이고, 실패하면 종료 코드를 남기며, 다음 명령이 지운다. Ctrl-Z 로 멈추거나 Ctrl-C 로 끈 명령은 실패로 남지 않는다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  const row = shellRows(page)
  await expect(row.locator('.title')).toHaveText('zsh')
  await expect(row.locator('.place')).toHaveText('~')

  await page.keyboard.type('sleep 30\n')
  await expect(row.locator('.title')).toHaveText('sleep 30')
  await expect(row).toHaveClass(/command-running/)
  await expect(row.locator('.state svg[data-icon="running"]')).toBeVisible()
  await expect(row.locator('.command-tail')).toHaveText('<1m')
  await expect(row.locator('.place')).toHaveCount(0)
  await expect(row).toHaveAttribute('data-tooltip', 'sleep 30\nRunning for <1m\n~')
  await expect(row).toHaveAttribute('aria-label', 'Running: sleep 30')

  // 셸은 preexec 에서 OSC 133 C 로 명령을 알린 뒤에 명령을 tty 의 foreground 로 넘긴다. 앱은 OSC 133 C 를 받으면 제목을
  // 바꾸므로, 제목이 바뀐 직후의 Ctrl-Z·Ctrl-C 는 명령이 아니라 셸이 받는다. 그래서 명령이 foreground 에 들어선 것을 본 뒤에 보낸다.
  await expect.poll(() => foregroundNames(dataDir)).toContain('sleep')
  await page.keyboard.press('Control+Z')
  await expect(row.locator('.title')).toHaveText('zsh')
  await expect(row).not.toHaveClass(/command-/)
  await page.keyboard.type('fg\n')
  await expect(row.locator('.title')).toHaveText('sleep 30')
  await expect(row).toHaveClass(/command-running/)

  // `fg` 도 preexec 뒤에 job 을 foreground 로 넘기므로 같은 틈이 있다.
  await expect.poll(() => foregroundNames(dataDir)).toContain('sleep')
  await page.keyboard.press('Control+C')
  await expect(row.locator('.title')).toHaveText('zsh')
  await expect(row).not.toHaveClass(/command-/)

  await page.keyboard.type("sh -c 'exit 3'\n")
  await expect(row).toHaveClass(/command-failed/)
  await expect(row.locator('.title')).toHaveText("sh -c 'exit 3'")
  await expect(row.locator('.state svg[data-icon="failed"]')).toBeVisible()
  await expect(row.locator('.command-tail')).toHaveText('3')
  await expect(row).toHaveAttribute('data-tooltip', "sh -c 'exit 3'\nExited with code 3\n~")

  await page.keyboard.type('false\n')
  await expect(row.locator('.title')).toHaveText('false')
  await expect(row.locator('.command-tail')).toHaveText('1')

  await page.keyboard.type('true\n')
  await expect(row.locator('.title')).toHaveText('zsh')
  await expect(row).not.toHaveClass(/command-/)
  await expect(row.locator('.command-tail')).toHaveCount(0)
  await expect(row.locator('.place')).toHaveText('~')
})

test('명령을 주어 띄운 pane 은 이름 자리에 명령 전체를 쓰고, 꼬리에는 돈 시간 대신 위치를 둔다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(`maru pane new bash -c 'read x'\n`)
  await expect(panes(page)).toHaveCount(2)
  const row = shellRows(page).nth(1)
  await expect(row.locator('.title')).toHaveText('bash -c read x')
  await expect(row).toHaveClass(/command-running/)
  await expect(row.locator('.command-tail')).toHaveCount(0)
  await expect(row.locator('.place')).not.toHaveCount(0)
  await expect(row).toHaveAttribute('data-tooltip', /^bash -c read x\nRunning for <1m\n/)
})

const nameInput = (page: Page) => page.locator('.sidebar .workspace-name-input')
const workspaceMenu = (page: Page) => page.locator('.sidebar .workspace-menu')

// 메뉴는 ⋮ 아래에 오른쪽 끝을 맞춰 떠 그 아래 줄을 덮는다. ⋮ 오른쪽의 접기 화살표 아래인 줄의 오른쪽 끝만 덮지 않는다.
// 그 자리 안쪽에는 마우스를 올리면 즐겨찾기 별이 뜨므로 별 바깥의 끝을 누른다.
async function clickRightEnd(el: Locator, inset = 3): Promise<void> {
  const b = (await el.boundingBox())!
  await el.click({ position: { x: b.width - inset, y: b.height / 2 } })
}

async function openWorkspaceMenu(page: Page, i: number): Promise<void> {
  await workspaceHeads(page).nth(i).hover()
  await workspaceHeads(page).nth(i).locator('.workspace-menu-button').click()
  await expect(nameInput(page)).toBeFocused()
}

test('workspace 메뉴의 이름 칸은 지금 이름을 들고 열리고, Enter 로 정한 이름은 셸이 cd 해도 그대로이며 cell 줄은 저장소 이름을 온전히 쓴다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd proj\n')
  await expect(workspaceNames(page)).toHaveText(['proj'])
  await expect(cellPlaces(page)).toHaveText([/main$/])
  await expect(cellPlaces(page).locator('.name')).toHaveCount(0)

  const head = workspaceHeads(page).nth(0)
  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await expect(nameInput(page)).toHaveValue('proj')
  await page.keyboard.type('review')
  await page.keyboard.press('Enter')
  await expect(nameInput(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveText(['review'])
  await expect(head).toHaveAttribute('aria-expanded', 'true')
  await expect(head).toHaveAttribute('aria-label', 'Collapse review')
  await expect(head).toHaveAttribute('data-tooltip', 'proj')
  await expect(cellPlaces(page).locator('.name')).toHaveText(['proj'])

  await page.keyboard.type('cd ~/notes\n')
  await expect(cellPlaces(page)).toHaveText(['notes'])
  await expect(workspaceNames(page)).toHaveText(['review'])
  await expect(head).toHaveAttribute('data-tooltip', 'notes')
})

test('메뉴에서 이름을 고치다 Esc 를 누르면 메뉴가 닫히고 이름이 그대로이며, 비우고 정하면 자동 이름으로 돌아가며, 두 경우 모두 터미널이 입력을 받는다', async ({
  launch
}) => {
  const { page } = await launch()
  await run(page, 'echo up-$((1+1))', 'up-2')
  const auto = (await workspaceNames(page).textContent())!

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('review')
  await page.keyboard.press('Enter')
  await expect(workspaceNames(page)).toHaveText(['review'])

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('other')
  await page.keyboard.press('Escape')
  await expect(nameInput(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveText(['review'])
  await run(page, 'echo esc-$((1+1))', 'esc-2')

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('   ')
  await page.keyboard.press('Enter')
  await expect(workspaceNames(page)).toHaveText([auto])
  await run(page, 'echo empty-$((1+1))', 'empty-2')
})

test('이름을 고치다 다른 workspace 의 메뉴를 열면 고치던 이름을 정하고 그 workspace 의 메뉴가 뜨며, 오류를 남기지 않는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await newWorkspace(launched, 2)
  // 새 workspace 의 이름은 셸이 디렉토리를 알린 뒤에 정해진다.
  const first = '~'
  await expect(workspaceNames(page).nth(1)).toHaveText(first)
  await expect(workspaceNames(page).nth(0)).toHaveText(first)

  // 메뉴는 ⋮ 아래로 떠 아래쪽 workspace 의 헤더를 덮으므로 위쪽 workspace 의 메뉴를 연다.
  await openWorkspaceMenu(page, 1)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('second')
  await openWorkspaceMenu(page, 0)
  await expect(workspaceMenu(page)).toHaveCount(1)
  await expect(nameInput(page)).toHaveCount(1)
  await expect(nameInput(page)).toHaveValue(first)
  await expect(workspaceNames(page)).toHaveText([first, 'second'])

  await page.keyboard.type('first')
  await page.keyboard.press('Enter')
  await expect(nameInput(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveText(['first', 'second'])
  await run(page, 'echo switch-$((1+1))', 'switch-2')
  expect(errors).toEqual([])
})

test('명령 팔레트의 Rename Workspace… 는 고른 cell 의 workspace 메뉴를 이름 칸에 포커스를 두고 열며, 접은 사이드바도 펴지 않고 연다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await newWorkspace(launched, 2)
  await collapseSidebar(app, page)

  await openPalette(launched)
  await page.keyboard.type('rename')
  await page.keyboard.press('Enter')
  await expect(nameInput(page)).toBeFocused()
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  await page.keyboard.type('second')
  await page.keyboard.press('Enter')
  await expect(workspaceNames(page).nth(1)).toHaveText('second')
  await expect(workspaceNames(page).nth(0)).not.toHaveText('second')
  await run(page, 'echo palette-$((1+1))', 'palette-2')
})

test('터미널에 포커스가 있을 때 ⇧⌘R 이 거는 Rename Workspace… 메뉴 항목은 workspace 메뉴의 이름 칸을 열고, 정하면 터미널이 입력을 받는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await run(page, 'echo up-$((1+1))', 'up-2')

  await clickMenu(app, 'rename-workspace')
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('menu')
  await page.keyboard.press('Enter')
  await expect(workspaceNames(page)).toHaveText(['menu'])
  await run(page, 'echo menu-$((1+1))', 'menu-2')
})

test('이름을 고치다 pane 줄을 누르면 이미 고른 줄이든 아니든 친 이름으로 정하고 그 pane 이 입력을 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  const first = workspaceNames(page).nth(0)

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('review')
  await clickRightEnd(cellItems(page).nth(1))
  await expect(nameInput(page)).toHaveCount(0)
  await expect(first).toHaveText('review')
  await run(page, 'echo same-$((1+1))', 'same-2')
  await expect(first).toHaveText('review')

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('again')
  await clickRightEnd(cellItems(page).nth(0))
  await expect(nameInput(page)).toHaveCount(0)
  await expect(first).toHaveText('again')
  await run(page, 'echo other-$((1+1))', 'other-2')
  await expect(first).toHaveText('again')
})

test('이름을 고치다 다른 workspace 줄을 누르면 친 이름으로 정하고 그 workspace 를 접으며, 터미널이 입력을 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  const heads = workspaceHeads(page)

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('review')
  await clickRightEnd(heads.nth(1), 16)
  await expect(nameInput(page)).toHaveCount(0)
  await expect(workspaceNames(page).nth(0)).toHaveText('review')
  await expect(heads.nth(1)).toHaveAttribute('aria-expanded', 'false')
  await run(page, 'echo fold-$((1+1))', 'fold-2')
})

test('이름을 고치다 New Cell·Next Cell 로 cell 을 고르거나 사이드바를 접으면 친 이름으로 정하고 터미널이 입력을 받는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('new')
  await newCell(launched, 2)
  await expect(nameInput(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveText(['new'])
  await run(page, 'echo new-$((1+1))', 'new-2')

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('next')
  await clickMenu(app, 'next-cell')
  await expect(nameInput(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveText(['next'])
  await run(page, 'echo next-$((1+1))', 'next-2')

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('fold')
  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  await expect(nameInput(page)).toHaveCount(0)
  await expect(workspaceHeads(page).nth(0)).toHaveAttribute('aria-label', 'Collapse fold')
  await run(page, 'echo fold-$((1+1))', 'fold-2')
})

test('이름을 바꾸지 않은 채 다른 곳을 눌러 끝내면 자동 이름이 첫 pane 의 저장소를 계속 따라가고, 같은 이름이라도 Enter 로 정하면 고정한다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const { page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('mkdir -p proj/sub; cd proj/sub\n')
  await expect(workspaceNames(page)).toHaveText(['proj'])
  const head = workspaceHeads(page).nth(0)

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toHaveValue('proj')
  await clickRightEnd(cellItems(page).nth(0))
  await expect(nameInput(page)).toHaveCount(0)
  await page.keyboard.type('cd ~/notes\n')
  await expect(workspaceNames(page)).toHaveText(['notes'])

  await openWorkspaceMenu(page, 0)
  await expect(nameInput(page)).toHaveValue('notes')
  await page.keyboard.press('Enter')
  await expect(nameInput(page)).toHaveCount(0)
  await page.keyboard.type('cd ~/proj/sub\n')
  await expect(head).toHaveAttribute('data-tooltip', 'proj')
  await expect(workspaceNames(page)).toHaveText(['notes'])
})

test('workspace 핀은 핀을 꽂은 workspace 에 늘 보이고 아니면 헤더에 마우스가 있을 때만 보이며, 누르기는 접기·끌기로 번지지 않는다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'echo up-$((1+1))', 'up-2')
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  const pin = (i: number) => workspaceHeads(page).nth(i).locator('.pin')
  for (const i of [0, 1, 2]) await expect(pin(i)).toBeHidden()

  await workspaceHeads(page).nth(0).hover()
  await expect(pin(0)).toBeVisible()
  await expect(pin(0)).toHaveAttribute('aria-label', 'Pin Workspace')
  await expect(pin(2)).toBeHidden()
  await pin(0).click()
  await expect(pin(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(pin(0)).toHaveAttribute('aria-label', 'Unpin Workspace')
  await expect(workspaceHeads(page).nth(0)).toHaveAttribute('aria-expanded', 'true')

  // 핀에서 눌러 다른 workspace 위로 끌어도 workspace 를 옮기지 않는다.
  await grabHandle(page, pin(0), 0)
  const b = (await workspaceHeads(page).nth(2).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.75, { steps: 6 })
  await expect(page.locator('.sidebar .dragging')).toHaveCount(0)
  await page.mouse.up()
  for (const i of [0, 1, 2])
    await expect(workspaceHeads(page).nth(i)).toHaveAttribute('aria-expanded', 'true')

  await panes(page).nth(0).hover()
  await expect(pin(0)).toBeVisible()
  await expect(pin(1)).toBeHidden()
  await run(page, 'echo pin-$((1+1))', 'pin-2')
})

test('핀을 꽂거나 빼도 workspace 들의 세로 위치가 그대로다', async ({ launch }) => {
  const launched = await launch()
  const { page } = launched
  await newWorkspace(launched, 2)
  await newWorkspace(launched, 3)
  const tops = async () => {
    const ys: number[] = []
    for (const i of [0, 1, 2]) ys.push((await workspaceHeads(page).nth(i).boundingBox())!.y)
    return ys
  }
  const before = await tops()
  const pin = workspaceHeads(page).nth(0).locator('.pin')

  await workspaceHeads(page).nth(0).hover()
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(tops).toEqual(before)

  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(tops).toEqual(before)
})

test('workspace 메뉴는 헤더를 가리킬 때 접기 화살표 바로 왼쪽에 보이는 ⋮ 를 누르면 그 버튼 아래에 오른쪽 끝을 맞춰 사이드바 안에 뜨고, 즐겨찾기가 없으면 안내 한 줄을 보이며, Pin Workspace 는 핀을 꽂고 Close Workspace 는 고른 cell 이 아니라 그 workspace 를 확인 창을 거쳐 닫는다', async ({
  launch,
  dataDir
}) => {
  const launched = await launch()
  const { app, page } = launched
  await page.keyboard.type('cat\n')
  await expect.poll(() => foregroundNames(dataDir)).toContain('cat')
  await newWorkspace(launched, 2)
  const second = await workspaceNames(page).nth(1).textContent()
  const button = workspaceHeads(page).nth(0).locator('.workspace-menu-button')
  await expect(button).toBeHidden()

  await openWorkspaceMenu(page, 0)
  const b = await box(button)
  const c = await box(workspaceHeads(page).nth(0).locator('.chevron'))
  expect(c.x).toBeGreaterThanOrEqual(b.x + b.width)
  expect(c.x).toBeLessThan(b.x + b.width + 8)
  const m = await box(workspaceMenu(page))
  expect(m.x + m.width).toBeCloseTo(b.x + b.width, 0)
  expect(m.x + m.width).toBeLessThanOrEqual(await sidebarWidth(page))
  expect(m.y).toBeGreaterThanOrEqual(b.y + b.height)
  expect(m.y).toBeLessThan(b.y + b.height + 8)
  await expect(favoriteItems(page)).toHaveCount(0)
  await expect(menuHint(page)).toHaveText('Star a pane to add its directory')
  await workspaceMenu(page).getByRole('menuitem', { name: 'Pin Workspace' }).click()
  await expect(workspaceMenu(page)).toHaveCount(0)
  await expect(workspaceHeads(page).nth(0).locator('.pin')).toHaveAttribute('aria-pressed', 'true')
  await run(page, 'echo pin-$((1+1))', 'pin-2')

  await openWorkspaceMenu(page, 0)
  await expect(workspaceMenu(page).getByRole('menuitem', { name: 'Unpin Workspace' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(workspaceMenu(page)).toHaveCount(0)

  await stubDialog(app, 1)
  await openWorkspaceMenu(page, 0)
  await workspaceMenu(page).getByRole('menuitem', { name: 'Close Workspace' }).click()
  await expect.poll(() => dialogCalls(app)).toMatchObject([{ message: 'Close this workspace?' }])
  await expect(workspaceNames(page)).toHaveCount(2)

  await stubDialog(app, 0)
  await openWorkspaceMenu(page, 0)
  await workspaceMenu(page).getByRole('menuitem', { name: 'Close Workspace' }).click()
  await expect(workspaceNames(page)).toHaveText([second!])
  await run(page, 'echo closed-$((1+1))', 'closed-2')
})

const dirRows = (page: Page) => page.locator('.sidebar .dir-row')
const favoriteItems = (page: Page) => workspaceMenu(page).locator('.favorite-open')

// 빼기 버튼은 즐겨찾기 줄에 마우스를 올려야 보인다.
async function removeFavorite(page: Page, name: string): Promise<void> {
  await workspaceMenu(page).locator('.favorite-item', { hasText: name }).hover()
  await workspaceMenu(page)
    .getByRole('button', { name: `Remove ${name} from Favorites` })
    .click()
}
const menuHint = (page: Page) => workspaceMenu(page).locator('.hint')
const launcher = (page: Page) => page.locator('.palette.launcher')

async function reopenShell(page: Page, row: Locator): Promise<void> {
  await row.click()
  await expect(launcher(page)).toBeVisible()
  await page.keyboard.type('shell')
  await page.keyboard.press('Enter')
  await expect(launcher(page)).toHaveCount(0)
}

test('핀을 꽂은 workspace 는 마지막 cell 을 닫아도 이름과 함께 남아 그 디렉토리의 줄을 보이고, 누르면 뜬 런처에서 고른 셸을 그 디렉토리에 열며, 재시작 뒤에도 남고 핀을 빼면 닫힌다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'sub')
  const shell = { SHELL: '/bin/zsh', HOME: home }
  const launched = await launch(shell)
  const { app, page } = launched
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await clickMenu(app, 'rename-workspace')
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('atlas')
  await page.keyboard.press('Enter')
  await openPalette(launched)
  await page.keyboard.type('workspace pin')
  await page.keyboard.press('Enter')
  const pin = workspaceHeads(page).nth(0).locator('.pin')
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await newWorkspace(launched, 2)

  await cellItems(page).nth(0).click()
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(1)
  await expect(workspaceNames(page)).toHaveText(['atlas', 'sub'])
  await expect(dirRows(page)).toHaveCount(1)
  await expect(dirRows(page)).toContainText('sub')
  await expect(dirRows(page).locator('.state svg[data-icon="folder"]')).toBeVisible()

  await reopenShell(page, dirRows(page))
  await expect(cellItems(page)).toHaveCount(2)
  await expect(dirRows(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveText(['atlas', 'sub'])
  await run(page, 'pwd', `${home}/sub`)
  await page.keyboard.type('exit\n')
  await expect(dirRows(page)).toHaveCount(1)
  await restartWith(app)

  const again = await launch(shell)
  await expect(workspaceNames(again.page)).toHaveText(['atlas', 'sub'])
  await expect(dirRows(again.page)).toHaveCount(1)
  await workspaceHeads(again.page).nth(0).locator('.pin').click()
  await expect(workspaceNames(again.page)).toHaveText(['sub'])
})

test('cell 이 있는 workspace 는 핀을 빼도 토스트가 뜨지 않고, cell 이 없는 핀 workspace 는 핀을 빼면 토스트가 뜨며, Undo 를 누르면 그 workspace 가 핀을 꽂은 채 같은 자리로 돌아오고 키 입력은 터미널로 간다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await clickMenu(app, 'rename-workspace')
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('atlas')
  await page.keyboard.press('Enter')
  const pin = workspaceHeads(page).nth(0).locator('.pin')
  await openPalette(launched)
  await page.keyboard.type('workspace pin')
  await page.keyboard.press('Enter')
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await run(page, 'echo in-$((1+1))', 'in-2')
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect(toast(page)).toHaveCount(0)
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await newWorkspace(launched, 2)
  await cellItems(page).nth(0).click()
  await page.keyboard.type('exit\n')
  await expect(dirRows(page)).toHaveCount(1)
  const names = await workspaceNames(page).allTextContents()
  const dir = await dirRows(page).getAttribute('aria-label')

  await pin.click()
  await expect(workspaceNames(page)).toHaveCount(1)
  await expect(toast(page)).toContainText("Removed 'atlas'")
  await toast(page).getByRole('button', { name: 'Undo' }).click()
  await expect(toast(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveText(names)
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await expect(dirRows(page)).toHaveAttribute('aria-label', dir!)
  await run(page, 'echo back-$((1+1))', 'back-2')
})

test('cell 이 없는 핀 workspace 만 남기고 끝내도 다음 실행에 그 workspace 가 남고 터미널 하나가 열리며, Close Workspace 는 핀 workspace 도 닫는다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await clickMenu(app, 'rename-workspace')
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('atlas')
  await page.keyboard.press('Enter')
  await openPalette(launched)
  await page.keyboard.type('workspace pin')
  await page.keyboard.press('Enter')
  await expect(workspaceHeads(page).nth(0).locator('.pin')).toHaveAttribute('aria-pressed', 'true')
  await run(page, 'echo in-$((1+1))', 'in-2')
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(0)
  await expect(dirRows(page)).toHaveCount(1)
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed

  const again = await launch()
  await expect(workspaceNames(again.page)).toHaveCount(2)
  await expect(workspaceNames(again.page).nth(0)).toHaveText('atlas')
  await expect(dirRows(again.page)).toHaveCount(1)
  await expect(cellItems(again.page)).toHaveCount(1)
  await run(again.page, 'echo up-$((1+1))', 'up-2')

  await reopenShell(again.page, dirRows(again.page))
  await expect(cellItems(again.page)).toHaveCount(2)
  await clickMenu(again.app, 'close-workspace')
  await expect(workspaceNames(again.page)).toHaveCount(1)
  await expect(workspaceNames(again.page)).not.toHaveText(['atlas'])
})

test('End everything 으로 끄면 터미널을 끝내고, 즐겨찾기가 있는 workspace 는 핀이 없어도 이름·즐겨찾기와 함께 cell 없이 남으며 둘 다 없는 workspace 는 남지 않는다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'sub')
  const shell = { SHELL: '/bin/zsh', HOME: home }
  const launched = await launch(shell)
  const { app, page } = launched
  await clickMenu(app, 'rename-workspace')
  await expect(nameInput(page)).toBeFocused()
  await page.keyboard.type('atlas')
  await page.keyboard.press('Enter')
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await cellItems(page).nth(0).hover()
  await cellFavorite(page, 0).click()
  await expect(cellFavorite(page, 0)).toHaveAttribute('aria-pressed', 'true')
  await expect(workspaceHeads(page).nth(0).locator('.pin')).toHaveAttribute('aria-pressed', 'false')
  await newWorkspace(launched, 2)
  await stubDialog(app, END_EVERYTHING)
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
  expect(sockets(dataDir)).toEqual([])

  const again = await launch(shell)
  await expect(workspaceNames(again.page)).toHaveCount(2)
  await expect(workspaceNames(again.page).nth(0)).toHaveText('atlas')
  await expect(dirRows(again.page)).toHaveCount(1)
  await expect(dirRows(again.page)).toContainText('sub')
  await expect(cellItems(again.page)).toHaveCount(1)
  await run(again.page, 'echo up-$((1+1))', 'up-2')
  await openWorkspaceMenu(again.page, 0)
  await expect(favoriteItems(again.page)).toContainText(['sub'])
})

test('cell 을 즐겨찾기에 넣어도 workspace 에 핀이 꽂히지 않고 줄이 옮겨지지 않으며 키는 그 터미널로 간다. 같은 디렉토리의 cell 은 함께 ★ 이고, 닫아도 사이드바에 줄이 남지 않으며, workspace 메뉴에서 고르면 뜬 런처에서 고른 셸을 workspace 끝에 그 디렉토리로 연다. 재시작 뒤에도 남는다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'sub')
  const shell = { SHELL: '/bin/zsh', HOME: home }
  const launched = await launch(shell)
  const { app, page } = launched
  await run(page, 'echo up-$((1+1))', 'up-2')
  await newWorkspace(launched, 2)
  await run(page, 'echo two-$((1+1))', 'two-2')
  await newCell(launched, 3)
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await newCell(launched, 4)
  await run(page, 'cd ~/sub && echo also-$((1+1))', 'also-2')

  const names = await workspaceNames(page).allTextContents()
  await cellItems(page).nth(2).hover()
  await expect(cellFavorite(page, 2)).toHaveAttribute('aria-pressed', 'false')
  await cellFavorite(page, 2).click()
  await expect(cellFavorite(page, 2)).toHaveAttribute('aria-pressed', 'true')
  await expect(cellFavorite(page, 2).locator('svg')).toHaveAttribute('fill', 'currentColor')
  await expect(cellFavorite(page, 3)).toHaveAttribute('aria-pressed', 'true')
  await expect(cellFavorite(page, 1)).toHaveAttribute('aria-pressed', 'false')
  await expect(workspaceHeads(page).nth(1).locator('.pin')).toHaveAttribute('aria-pressed', 'false')
  await expect(workspaceNames(page)).toHaveText(names)
  await run(page, 'echo kept-$((1+1))', 'kept-2')

  await page.keyboard.type('exit\n')
  await cellItems(page).nth(2).click()
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(2)
  await expect(page.locator('.sidebar .dir-row')).toHaveCount(0)

  await openWorkspaceMenu(page, 1)
  await expect(favoriteItems(page)).toHaveCount(1)
  await expect(favoriteItems(page)).toContainText('sub')
  await favoriteItems(page).click()
  await expect(workspaceMenu(page)).toHaveCount(0)
  await expect(launcher(page)).toBeVisible()
  await page.keyboard.type('shell')
  await page.keyboard.press('Enter')
  await expect(launcher(page)).toHaveCount(0)
  await expect(cellItems(page)).toHaveCount(3)
  await expect(cellGroups(page).nth(2)).toHaveClass(/selected/)
  await expect(cellFavorite(page, 2)).toHaveAttribute('aria-pressed', 'true')
  await run(page, 'pwd', `${home}/sub`)
  await restartWith(app)

  const again = await launch(shell)
  await openWorkspaceMenu(again.page, 1)
  await expect(favoriteItems(again.page)).toContainText('sub')
})

test('workspace 메뉴에서 즐겨찾기를 빼면 그 디렉토리의 cell 도 ★ 가 빠지고, cell 줄의 별로 빼도 메뉴에서 빠지며, workspace 의 핀을 빼도 즐겨찾기는 남는다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'sub', 'lib')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await run(page, 'echo up-$((1+1))', 'up-2')
  await newCell(launched, 2)
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await newCell(launched, 3)
  await run(page, 'cd ~/lib && echo lib-$((1+1))', 'lib-2')
  const pin = workspaceHeads(page).nth(0).locator('.pin')

  await cellItems(page).nth(1).hover()
  await cellFavorite(page, 1).click()
  await expect(cellFavorite(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await cellFavorite(page, 1).click()
  await expect(cellFavorite(page, 1)).toHaveAttribute('aria-pressed', 'false')
  // 다른 cell 의 별을 눌러도 키는 고른 cell 의 터미널로 간다.
  await run(page, 'echo un-$((1+1))', 'un-2')
  await expect(pin).toHaveAttribute('aria-pressed', 'false')

  await cellItems(page).nth(2).hover()
  await cellFavorite(page, 2).click()
  await cellItems(page).nth(1).hover()
  await cellFavorite(page, 1).click()
  await openWorkspaceMenu(page, 0)
  await expect(favoriteItems(page)).toHaveCount(2)
  await removeFavorite(page, 'lib')
  await expect(favoriteItems(page)).toHaveCount(1)
  await expect(cellFavorite(page, 2)).toHaveAttribute('aria-pressed', 'false')
  await expect(cellFavorite(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await panes(page).first().click()
  await expect(workspaceMenu(page)).toHaveCount(0)

  await workspaceHeads(page).nth(0).hover()
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect(cellFavorite(page, 1)).toHaveAttribute('aria-pressed', 'true')
})

test('workspace 메뉴는 workspace 디렉토리를 보이고, 즐겨찾기 줄의 tooltip 은 그 디렉토리 아래면 상대 경로를, 아니면 홈을 ~ 로 쓴 경로를 단다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'sub')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await newCell(launched, 2)
  await run(page, 'cd ~/sub && mkdir -p deep && cd deep && echo deep-$((1+1))', 'deep-2')
  for (const i of [0, 1]) {
    await cellItems(page).nth(i).hover()
    await cellFavorite(page, i).click()
  }

  await openWorkspaceMenu(page, 0)
  await expect(workspaceMenu(page).locator('.workspace-dir')).toHaveText('~/sub')
  await expect(favoriteItems(page)).toHaveCount(2)
  await expect(workspaceMenu(page).getByRole('menuitem', { name: 'Open sub' })).toHaveAttribute(
    'data-tooltip',
    '~/sub'
  )
  await expect(workspaceMenu(page).getByRole('menuitem', { name: 'Open deep' })).toHaveAttribute(
    'data-tooltip',
    'deep'
  )
})

test('workspace 메뉴는 바깥 어디를 눌러도 닫히며 누른 자리의 동작도 하고, 열린 동안에는 창 드래그 영역을 꺼서 사이드바 빈 곳·제목 줄을 눌러도 닫힌다', async ({
  launch
}) => {
  const launched = await launch()
  const { page } = launched
  await run(page, 'echo a-$((1+1))', 'a-2')
  await newWorkspace(launched, 2)
  await newCell(launched, 3)
  await openCanvas(launched)
  await expect(cellGroups(page).nth(2)).toHaveClass(/selected/)

  await openWorkspaceMenu(page, 0)
  await clickRightEnd(cellItems(page).nth(1))
  await expect(workspaceMenu(page)).toHaveCount(0)
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)

  await openWorkspaceMenu(page, 0)
  await panes(page).filter({ visible: true }).first().click()
  await expect(workspaceMenu(page)).toHaveCount(0)
  await run(page, 'echo t-$((1+1))', 't-2')

  const center = async (el: Locator) => {
    const b = (await el.boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const list = (await page.locator('.sidebar .list').boundingBox())!
  const spots = [
    { x: list.x + list.width / 2, y: list.y + list.height - 8 },
    await center(page.locator('.sidebar .titlebar')),
    await center(page.locator('.canvas .title-row')),
    await center(page.locator('.panel-bar .titlebar'))
  ]
  for (const { x, y } of spots) {
    expect(await appRegionAt(page, x, y)).toBe('drag')
    await openWorkspaceMenu(page, 0)
    expect(await appRegionAt(page, x, y)).toBe('no-drag')
    await page.mouse.click(x, y)
    await expect(workspaceMenu(page)).toHaveCount(0)
    expect(await appRegionAt(page, x, y)).toBe('drag')
  }
})

test('workspace 메뉴 안의 버튼이 아닌 곳을 눌러도 메뉴가 남고 이름 칸이 입력을 받으며, 창 크기가 바뀌어 닫히거나 마지막 즐겨찾기를 빼 workspace 와 함께 사라져도 터미널이 입력을 받는다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'sub')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { app, page } = launched
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await cellItems(page).nth(0).hover()
  await cellFavorite(page, 0).click()
  await expect(cellFavorite(page, 0)).toHaveAttribute('aria-pressed', 'true')
  await newWorkspace(launched, 2)

  await openWorkspaceMenu(page, 0)
  for (const spot of [
    workspaceMenu(page).locator('.section'),
    workspaceMenu(page).locator('hr').first(),
    workspaceMenu(page).locator('.name-field')
  ]) {
    const b = (await spot.boundingBox())!
    await page.mouse.click(b.x + 2, b.y + b.height / 2)
    await expect(workspaceMenu(page)).toHaveCount(1)
    await expect(nameInput(page)).toBeFocused()
  }
  await page.keyboard.press('Escape')
  await expect(workspaceMenu(page)).toHaveCount(0)

  await openWorkspaceMenu(page, 0)
  await resizeBy(app, -40, 0)
  await expect(workspaceMenu(page)).toHaveCount(0)
  await run(page, 'echo sized-$((1+1))', 'sized-2')

  await cellItems(page).nth(0).click()
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(1)
  await expect(workspaceHeads(page)).toHaveCount(2)
  await openWorkspaceMenu(page, 0)
  await removeFavorite(page, 'sub')
  await expect(workspaceHeads(page)).toHaveCount(1)
  await expect(workspaceMenu(page)).toHaveCount(0)
  await run(page, 'echo gone-$((1+1))', 'gone-2')
})

/**
 * 좌표 (x, y) 가 창 끌기 영역(`drag`)인지, 밑의 요소가 마우스를 받는 자리(`no-drag`)인지를 Chromium 과 Electron 이 정하는
 * 규칙대로 계산한다. 테스트가 보내는 마우스 이벤트는 OS 의 창 끌기 처리를 거치지 않고 페이지에 바로 가서, 실제 마우스가
 * 영역에 막히는 것을 볼 수 없기 때문이다. 규칙: DOM 순서로 보이는 박스마다 영역을 모으고, 겹치면 z-index 와 상관없이
 * DOM 에서 뒤의 것이 이긴다.
 */
function appRegionAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ({ x, y }) => {
      let region = 'none'
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const style = getComputedStyle(el)
        const mode = style.getPropertyValue('-webkit-app-region')
        if (mode === 'none' || style.visibility !== 'visible') continue
        const r = el.getBoundingClientRect()
        if (r.width && r.height && x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
          region = mode
        }
      }
      return region
    },
    { x, y }
  )
}

test('고전 스크롤바 설정에서도 cell 의 별 가운데는 창 끌기 영역이 아니어서 별이 보이고 눌리고, 목록 아래 끝은 창 끌기 영역으로 남는다', async ({
  launch
}) => {
  const { page } = await launch({}, undefined, CLASSIC_SCROLLBARS)
  await expect(page.locator('.sidebar .list > .os-scrollbar-vertical')).toHaveCount(1)
  // 즐겨찾기는 첫 pane 의 디렉토리를 알아야 넣을 수 있다.
  await run(page, 'echo up-$((1+1))', 'up-2')
  await cellItems(page).nth(0).hover()
  const star = cellFavorite(page, 0)
  const box = (await star.boundingBox())!
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await star.hover()
  await expect(star).toBeVisible()
  expect(await appRegionAt(page, center.x, center.y)).toBe('no-drag')
  await star.click()
  await expect(star).toHaveAttribute('aria-pressed', 'true')
  // 목록 아래 끝에는 쓰지 않는 가로 스크롤바가 보이지 않은 채 깔려 있다.
  const list = (await page.locator('.sidebar .list').boundingBox())!
  expect(await appRegionAt(page, list.x + list.width / 2, list.y + list.height - 4)).toBe('drag')
})

test('팔레트의 Toggle Favorite 는 고른 cell 의 포커스된 pane 의 디렉토리를 즐겨찾기에 넣고, 디렉토리가 없어진 즐겨찾기를 메뉴에서 고르면 런처를 띄우지 않고 이유를 보인다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'gone')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await run(page, 'echo up-$((1+1))', 'up-2')
  await newCell(launched, 2)
  await run(page, 'cd gone && echo in-$((1+1))', 'in-2')

  await openPalette(launched)
  await page.keyboard.type('toggle favorite')
  await page.keyboard.press('Enter')
  await expect(cellFavorite(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await expect(cellItems(page).nth(1)).toContainText('gone')
  await run(page, 'echo cmd-$((1+1))', 'cmd-2')

  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(1)
  rmSync(join(home, 'gone'), { recursive: true })
  await openWorkspaceMenu(page, 0)
  await favoriteItems(page).click()
  await expect(toast(page)).toContainText("Couldn't open the favorite directory")
  await expect(launcher(page)).toHaveCount(0)
  await expect(cellItems(page)).toHaveCount(1)
})

function useTool(dataDir: string): string {
  const bin = join(dataDir, 'tool')
  writeFileSync(bin, '#!/bin/sh\necho "ran-in-$(pwd -P)"\nexec sleep 60\n')
  chmodSync(bin, 0o755)
  writeConfig(dataDir, `[launcher]\ncommands = ["${bin}"]\n`)
  return bin
}

const box = async (el: Locator) => (await el.boundingBox())!

test('workspace 메뉴에서 즐겨찾기를 고르면 메뉴가 있던 자리에 메뉴의 폭으로 셸이 든 명령 목록이 뜨되 사이드바의 줄을 밀지 않고, Esc 는 아무것도 띄우지 않으며, 고른 명령은 workspace 끝의 cell 로 그 디렉토리에 뜬다', async ({
  launch,
  dataDir
}) => {
  const bin = useTool(dataDir)
  const home = zshHome(dataDir, 'sub')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await cellItems(page).nth(0).hover()
  await cellFavorite(page, 0).click()
  await expect(cellFavorite(page, 0)).toHaveAttribute('aria-pressed', 'true')
  await run(page, 'cd ~ && echo out-$((1+1))', 'out-2')
  await expect(cellFavorite(page, 0)).toHaveAttribute('aria-pressed', 'false')
  const next = cellGroups(page).nth(0)
  const before = await box(next)

  await openWorkspaceMenu(page, 0)
  const m = await box(workspaceMenu(page))
  await favoriteItems(page).click()
  await expect(launcher(page)).toBeVisible()
  await expect(launcher(page).locator('.item .path')).toHaveText([bin, 'shell'])
  await expect(launcher(page).locator('.item.selected .path')).toHaveText(bin)
  const l = await box(launcher(page))
  expect(l.x).toBeCloseTo(m.x, 0)
  expect(l.width).toBeCloseTo(m.width, 0)
  expect(l.y).toBeGreaterThanOrEqual(m.y)
  expect(l.y).toBeLessThan(m.y + 4)
  expect(await box(next)).toEqual(before)

  await page.keyboard.press('Escape')
  await expect(launcher(page)).toHaveCount(0)
  await expect(cellItems(page)).toHaveCount(1)

  await openWorkspaceMenu(page, 0)
  await favoriteItems(page).click()
  await expect(launcher(page).locator('.item.selected .path')).toHaveText(bin)
  await page.keyboard.press('Enter')
  await expect(launcher(page)).toHaveCount(0)
  await expect(cellItems(page)).toHaveCount(2)
  await expect(cellFavorite(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await expect(cellGroups(page).nth(1)).toHaveClass(/selected/)
  await expect(screen(page)).toShow(`ran-in-${home}/sub`)
})

test('사이드바를 접으면 cell 이 없는 workspace 의 디렉토리 줄의 런처가 펼친 최소 폭일 때의 줄 폭으로 뜨고, 목록을 스크롤해 창 아래 끝에 온 줄에서는 줄 위로 뒤집혀 뜬다', async ({
  launch,
  dataDir
}) => {
  // 런처를 창 위에 띄우는 설정이어야 뒤집힌 런처의 화살표 방향이 설정과 갈린다.
  writeConfig(dataDir, '[layout]\npalette = "top"\n')
  const home = zshHome(dataDir, 'sub')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { app, page } = launched
  await run(page, 'echo up-$((1+1))', 'up-2')
  for (let n = 2; n <= 3; n++) await newCell(launched, n)
  await newWorkspace(launched, 4)
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await openPalette(launched)
  await page.keyboard.type('workspace pin')
  await page.keyboard.press('Enter')
  await expect(workspaceHeads(page).nth(1).locator('.pin')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.type('exit\n')
  const row = page.locator('.sidebar .dir-row')
  await expect(row).toHaveCount(1)
  const card = page.locator('.sidebar .dir-card')
  const open = await sidebarWidth(page)

  await collapseSidebar(app, page)
  await row.click()
  await expect(launcher(page)).toBeVisible()
  const c = await box(card)
  const l = await box(launcher(page))
  expect(l.x).toBeCloseTo(c.x, 0)
  expect(l.width).toBeCloseTo(c.width + SIDEBAR_MIN_WIDTH - (await sidebarWidth(page)), 0)
  expect(l.y).toBeGreaterThanOrEqual(c.y + c.height)
  await page.keyboard.press('Escape')
  await expect(launcher(page)).toHaveCount(0)
  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/)
  await expect.poll(() => sidebarWidth(page)).toBe(open)

  const list = page.locator('.sidebar .list')
  const height = await page.evaluate(() => window.innerHeight)
  const unscrolled = await box(card)
  await resizeBy(app, 0, -(height - unscrolled.y + 20))
  await expect.poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const scrolled = await box(card)
  expect(scrolled.y).toBeLessThan(unscrolled.y)

  await row.click()
  await expect(launcher(page)).toBeVisible()
  const flipped = await box(launcher(page))
  expect(flipped.x).toBeCloseTo(scrolled.x, 0)
  expect(flipped.width).toBeCloseTo(scrolled.width, 0)
  expect(flipped.y + flipped.height).toBeLessThanOrEqual(scrolled.y)
  expect(flipped.y + flipped.height).toBeGreaterThan(scrolled.y - 4)
  // 뒤집힌 런처는 입력창이 줄 쪽인 아래에 오고, 화살표도 설정한 위가 아니라 이 방향을 따라 위쪽이 다음 후보다.
  const input = await box(launcher(page).locator('.query'))
  expect(input.y).toBeGreaterThan((await box(launcher(page).locator('.list'))).y)
  await expect(launcher(page).locator('.item.selected .path')).toHaveText('claude')
  await page.keyboard.press('ArrowUp')
  await expect(launcher(page).locator('.item.selected .path')).toHaveText('codex')
})

test('즐겨찾기의 런처를 닫은 뒤 디렉토리 단계부터 연 런처는 고른 디렉토리를 고른 자리에 띄운다', async ({
  launch,
  dataDir
}) => {
  const home = zshHome(dataDir, 'sub', 'other')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { app, page } = launched
  await run(page, 'echo up-$((1+1))', 'up-2')
  await newCell(launched, 2)
  await run(page, 'cd sub && echo in-$((1+1))', 'in-2')
  await cellItems(page).nth(1).hover()
  await cellFavorite(page, 1).click()
  await expect(cellFavorite(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.type('exit\n')
  await expect(cellItems(page)).toHaveCount(1)
  await openWorkspaceMenu(page, 0)
  await favoriteItems(page).click()
  await expect(launcher(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(launcher(page)).toHaveCount(0)

  await clickMenu(app, 'launcher')
  await expect(launcher(page).locator('.query')).toBeFocused()
  await page.keyboard.type(`${home}/other`)
  await page.keyboard.press('Enter')
  await expect(launcher(page).locator('.section')).toContainText('New Workspace')
  await page.keyboard.type('shell')
  await page.keyboard.press('Enter')
  await expect(launcher(page)).toHaveCount(0)
  await expect(workspaceNames(page)).toHaveCount(2)
  await expect(workspaceNames(page).nth(1)).toHaveText('other')
  await run(page, 'echo at-$PWD', `at-${home}/other`)
})
