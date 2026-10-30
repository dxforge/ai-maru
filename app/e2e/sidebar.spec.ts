import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { ICONS } from '../src/renderer/src/icons'
import {
  clickMenu,
  collapseSidebar,
  dragHandle,
  grabHandle,
  expect,
  foregroundNames,
  git,
  newWorkspace,
  paneRows,
  panes,
  programStatus,
  resizeBy,
  rows,
  run,
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
  cellPlaces,
  dialogCalls,
  newCell,
  stubDialog,
  workspaceHeads,
  workspaceNames,
  zshHome
} from './app'

// 셸에서 친 git 은 `/usr/bin/git`(xcrun shim)을 거치므로, 부하가 걸리면 `git switch` 한 번에 최대 3.6초 걸렸다. 15초는 그 값에 여유를 둔 것이고 잰 근거는 없다.
const shellGit = { timeout: 15_000 }

function repoHome(dataDir: string, format: 'files' | 'reftable' = 'files'): string {
  const home = zshHome(dataDir, 'proj', 'notes')
  git(join(home, 'proj'), 'init', '-q', '-b', 'main', `--ref-format=${format}`)
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
  await expect(tip(page)).toHaveAttribute('title', /\n~$/)

  await page.keyboard.type('cd proj/.git\n')
  await page.keyboard.type('cd ..; mkdir -p a/b; cd a/b\n')
  await expect(branch(page)).toHaveText(/main$/)
  await expect(tip(page)).toHaveAttribute('title', /\n~\/proj\/a\/b$/)
  await expect.poll(() => win(app)).toEqual({ title: 'proj — main', path: join(home, 'proj/a/b') })

  await page.keyboard.type('cd ~/notes\n')
  await expect(cellPlaces(page)).toHaveText(['notes'])
  await expect(branch(page)).toHaveCount(0)
  await expect.poll(() => win(app)).toEqual({ title: 'notes', path: join(home, 'notes') })
})

test('workspace 이름 줄은 첫 cell 의 첫 pane 의 저장소 이름(저장소 밖이면 디렉토리 이름, 홈이면 ~)이고 branch 가 없으며, 접은 사이드바에서도 보인다', async ({
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
  await page.keyboard.type('cd ~/notes\n')
  await expect(workspaceNames(page)).toHaveText(['notes'])
  await page.keyboard.type('cd ~\n')
  await expect(workspaceNames(page)).toHaveText(['~'])

  await page.keyboard.type('exit\n')
  await expect(cellPlaces(page)).toHaveText(['notes'])
  await expect(workspaceNames(page)).toHaveText(['notes'])

  await collapseSidebar(app, page)
  await expect(workspaceNames(page)).toBeVisible()
  await expect(workspaceNames(page)).toHaveCSS('opacity', '1')
})

test('cell 이름은 workspace 와 다른 부분만 적는다: 같은 저장소는 branch(하위 폴더면 상대 경로), 다른 저장소는 이름과 branch, git 밖은 폴더 이름', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  git(join(home, 'proj'), 'worktree', 'add', '-q', '-b', 'wt', '../proj-wt')
  mkdirSync(join(home, 'proj', 'app', 'e2e'), { recursive: true })
  mkdirSync(join(home, 'other'))
  git(join(home, 'other'), 'init', '-q', '-b', 'dev')
  // 이름이 같은 다른 클론은 다른 저장소다.
  mkdirSync(join(home, 'clone'))
  git(join(home, 'clone'), 'init', '-q', '-b', 'main', 'proj')
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  const steps: [string, string | RegExp][] = [
    ['cd ~/proj-wt', /^\S?wt$/],
    ['cd ~/proj/app/e2e', /^\S?main· app\/e2e$/],
    ['cd ~/other', /^other\S?dev$/],
    ['cd ~/clone/proj', /^proj\S?main$/],
    ['cd ~/notes', 'notes']
  ]
  for (const [i, [cd, label]] of steps.entries()) {
    await newCell(launched, i + 2)
    await page.keyboard.type(`${cd}\n`)
    await expect(cellPlaces(page).nth(i + 1)).toHaveText(label)
  }
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

for (const format of ['files', 'reftable'] as const) {
  test(`${format} 저장소에서 셸로 branch 를 바꾸면 다음 프롬프트에 따라가고, worktree 는 원래 저장소 이름을 쓴다`, async ({
    launch,
    dataDir
  }) => {
    // `shellGit` 을 네 번 기다리므로 다 쓰면 기본 30초를 넘는다.
    test.slow()
    const home = repoHome(dataDir, format)
    const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
    await page.keyboard.type('cd proj\n')
    // reftable 저장소는 앱도 `git` 을 실행해 branch 를 읽는다. 첫 대기에는 zsh 가 뜨는 시간도 더해진다.
    await expect(branch(page)).toHaveText(/main$/, shellGit)

    await page.keyboard.type('git switch -q -c feat/1-x\n')
    await expect(branch(page)).toHaveText(/feat\/1-x$/, shellGit)
    await expect.poll(async () => (await win(app)).title).toBe('proj — feat/1-x')

    await page.keyboard.type('git switch -q --detach\n')
    await expect(branch(page)).toHaveText(/[0-9a-f]{7}$/, shellGit)

    await page.keyboard.type('git worktree add -q -b wt ../proj-wt && cd ../proj-wt\n')
    // worktree 로 cd 하기 전에도 cell 이름이 `proj` 이므로, branch 가 `wt` 로 바뀐 뒤에 이름을 확인한다.
    await expect(branch(page)).toHaveText(/wt$/, shellGit)
    await expect(tip(page)).toHaveAttribute('title', /\n~\/proj-wt$/)
  })
}

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
  await page.keyboard.type(`git switch -q -c by-claude && ${report} && sleep 30\n`)
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
  await expect(tip(page)).toHaveAttribute('title', /\n~\/proj-wt$/)

  await page.keyboard.press('Control+C')
  await expect(tip(page)).toHaveAttribute('title', /\n~\/proj$/)
})

test('셸이 심볼릭 링크 경로에 있으면 Claude 의 상태가 바뀌어도 pane 의 경로는 그대로 두고 branch 만 다시 읽는다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  symlinkSync(join(home, 'proj'), join(home, 'link'))
  const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
  await page.keyboard.type('cd link\n')
  await expect(tip(page)).toHaveAttribute('title', /\n~\/link$/)

  // `foreground` 는 실제 경로(`~/proj`)를 답하고, OSC 7 은 `$PWD`(`~/link`)를 준다. branch 를 바꿔 두고, branch 를 다시 읽은
  // 것을 확인한 뒤에 경로를 확인한다.
  const report = programStatus('working').trimEnd()
  await page.keyboard.type(`git switch -q -c by-claude && ${report} && sleep 30\n`)
  await expect(paneRows(page)).toHaveClass(/working/, shellGit)
  await expect(branch(page)).toHaveText(/by-claude$/)
  await expect(tip(page)).toHaveAttribute('title', /\n~\/link$/)
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
  await expect(opened).toHaveAttribute('title', /\n~\/proj$/)
  await expect(opened).toHaveAttribute('title', /\n~\/proj-wt$/)
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
  await expect(opened).toHaveAttribute('title', /\n~\/link$/)
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
  await expect(cellItems(page).nth(1)).toHaveAttribute('title', /\n~\/notes$/)
  await expect(cellItems(page).nth(0)).toHaveAttribute('title', /\n~\/proj$/)

  await cellItems(page).nth(0).click()
  await expect(cellGroups(page).nth(0)).toHaveClass(/selected/)
  await run(page, 'echo path-$((1+1))', 'path-2')

  const branches = page.locator('.cell-header .branch')
  await expect(branches).toHaveText(['main'])
  await expect(branches).toBeVisible()
})

test('아이콘은 모두 앞 글꼴의 fallback 이 아니라 함께 실은 Nerd Font 를 글꼴로 정해 그린다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { app, page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await page.keyboard.type(programStatus('working'))
  await expect(page.locator('.cell-header')).toHaveClass(/working/)
  await split(app, page, 'split-right', 2)
  await expect(shellRows(page).locator('.place .branch')).toHaveText(/main$/)

  // 사이드바의 workspace 접기·Claude 아이콘·셸 줄의 터미널 아이콘과 branch, pane 헤더의 Claude 아이콘이 모두 그려진 뒤에 잰다.
  const families = await page.evaluate((glyphs) => {
    const found: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (glyphs.some((g) => node!.textContent!.includes(g)))
        found.push(getComputedStyle(node.parentElement!).fontFamily)
    return found
  }, Object.values(ICONS))

  expect(families.length).toBeGreaterThanOrEqual(5)
  expect(new Set(families)).toEqual(new Set(['"Symbols Nerd Font Mono"']))
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
  await expect(rows(page)).toContainText('ok-2', shellGit)
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
  await page.keyboard.type(`${programStatus('working').trimEnd()} && sleep 600\n`)
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(
    `${programStatus('blocked', 'kind=permission').trimEnd()} && sleep 600\n`
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
  await expect(web.locator('.state')).toHaveText(ICONS.gear)
  await expect(web.locator('.title')).toHaveText('web')
  await expect(web).toHaveAttribute('title', `python3 -m http.server ${port} --bind 127.0.0.1`)
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
  await expect(build).toHaveAttribute('title', 'sh -c exit 3\nExited with code 3')

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
  await expect(dev.locator('.kill')).toHaveCSS('opacity', '1')
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
  await expect(kill).toHaveCSS('opacity', '1')
  await stubDialog(app, 0)
  await page.keyboard.press('Enter')
  await expect(jobRows(page)).toHaveCount(0)
})

test('시그널로 끝난 job 은 툴팁에 그 시그널을 쓴다', async ({ launch }) => {
  const { page } = await launch()
  await run(
    page,
    "maru job new --name crash sh -c 'kill -9 $$' && echo started-$((1+1))",
    'started-2'
  )
  await expect(jobRows(page).first()).toHaveAttribute(
    'title',
    'sh -c kill -9 $$\nKilled by signal 9'
  )
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
  await expect(paneRows(page).locator('.state svg')).toHaveCount(1)
  await expect(page.locator('.pane-header .claude-icon')).toHaveCount(0)
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
        const icon = g.querySelector('.branch .nerd-icon')!.getBoundingClientRect()
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
  await expect(row.locator('.state')).toHaveText(ICONS.terminal)

  await page.keyboard.type(programStatus('working'))
  await expect(row).toHaveClass(/working/)
  await expect(row.locator('.state svg')).toHaveCount(1)
  await expect(place).toHaveText(/main$/)
  expect(await right()).toBe(before)

  await page.keyboard.type(programStatus('idle'))
  await expect(row).toHaveClass(/idle/)
  await expect(row.locator('.state')).toHaveText(ICONS.claude)
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
  await expect(row.locator('.state')).toHaveText(ICONS.running)
  await expect(row.locator('.command-tail')).toHaveText('<1m')
  await expect(row.locator('.place')).toHaveCount(0)
  await expect(row).toHaveAttribute('title', 'sleep 30\nRunning for <1m\n~')
  await expect(row).toHaveAttribute('aria-label', 'Running: sleep 30')

  // 셸은 명령을 tty 의 foreground 로 넘기기 전에 preexec 에서 제목을 바꾼다. 그 사이의 Ctrl-Z·Ctrl-C 는 명령이 아니라
  // 셸이 받으므로, 명령이 foreground 에 들어선 뒤에 보낸다. `fg` 도 preexec 뒤에 job 을 foreground 로 넘긴다.
  await expect.poll(() => foregroundNames(dataDir)).toContain('sleep')
  await page.keyboard.press('Control+Z')
  await expect(row.locator('.title')).toHaveText('zsh')
  await expect(row).not.toHaveClass(/command-/)
  await page.keyboard.type('fg\n')
  await expect(row.locator('.title')).toHaveText('sleep 30')
  await expect(row).toHaveClass(/command-running/)

  await expect.poll(() => foregroundNames(dataDir)).toContain('sleep')
  await page.keyboard.press('Control+C')
  await expect(row.locator('.title')).toHaveText('zsh')
  await expect(row).not.toHaveClass(/command-/)

  await page.keyboard.type("sh -c 'exit 3'\n")
  await expect(row).toHaveClass(/command-failed/)
  await expect(row.locator('.title')).toHaveText("sh -c 'exit 3'")
  await expect(row.locator('.state')).toHaveText(ICONS.error)
  await expect(row.locator('.command-tail')).toHaveText('3')
  await expect(row).toHaveAttribute('title', "sh -c 'exit 3'\nExited with code 3\n~")

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
  await expect(row).toHaveAttribute('title', /^bash -c read x\nRunning for <1m\n/)
})
