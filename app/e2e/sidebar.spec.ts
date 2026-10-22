import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { ICONS } from '../src/renderer/src/icons'
import {
  claudeHook,
  clickMenu,
  dragHandle,
  grabHandle,
  expect,
  newWorkspace,
  paneRows,
  panes,
  resizeBy,
  rows,
  run,
  shellRows,
  shellSize,
  sidebarResizer,
  sidebarWidth,
  split,
  test,
  toggleView,
  watchTerminalWidths,
  workspaceGroups,
  workspaceItems,
  zshHome
} from './app'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })
}

// 셸에서 친 git 은 `/usr/bin/git`(xcrun shim)을 거치므로, 부하가 걸리면 `git switch` 한 번에 최대 3.6초 걸렸다. 15초는 그 값에 여유를 둔 것이고 잰 근거는 없다.
const shellGit = { timeout: 15_000 }

function repoHome(dataDir: string, format: 'files' | 'reftable' = 'files'): string {
  const home = zshHome(dataDir, 'proj', 'notes')
  git(join(home, 'proj'), 'init', '-q', '-b', 'main', `--ref-format=${format}`)
  git(join(home, 'proj'), 'commit', '-q', '--allow-empty', '-m', 'init')
  return home
}

const branch = (page: Page) =>
  workspaceGroups(page).and(page.locator('.selected')).locator('.branch')
const heads = (page: Page) => workspaceGroups(page).locator('.workspace')
const tip = (page: Page) =>
  workspaceGroups(page).and(page.locator('.selected')).locator('.workspace')

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
  await expect(tip(page)).toHaveAttribute('title', 'home\n~')

  await page.keyboard.type('cd proj/.git\n')
  await page.keyboard.type('cd ..; mkdir -p a/b; cd a/b\n')
  await expect(workspaceItems(page)).toHaveText(['proj'])
  await expect(branch(page)).toHaveText(/main$/)
  await expect(tip(page)).toHaveAttribute('title', 'proj — main\n~/proj/a/b')
  await expect.poll(() => win(app)).toEqual({ title: 'proj — main', path: join(home, 'proj/a/b') })

  await page.keyboard.type('cd ~/notes\n')
  await expect(workspaceItems(page)).toHaveText(['notes'])
  await expect(branch(page)).toHaveCount(0)
  await expect.poll(() => win(app)).toEqual({ title: 'notes', path: join(home, 'notes') })
})

for (const format of ['files', 'reftable'] as const) {
  test(`${format} 저장소에서 셸로 branch 를 바꾸면 다음 프롬프트에 따라가고, worktree 는 원래 저장소 이름을 쓴다`, async ({
    launch,
    dataDir
  }) => {
    // 셸 git 을 세 번 기다리므로 `shellGit` 을 다 쓰면 기본 30초를 넘는다.
    test.slow()
    const home = repoHome(dataDir, format)
    const { app, page } = await launch({ SHELL: '/bin/zsh', HOME: home })
    await page.keyboard.type('cd proj\n')
    await expect(branch(page)).toHaveText(/main$/)

    await page.keyboard.type('git switch -q -c feat/1-x\n')
    await expect(branch(page)).toHaveText(/feat\/1-x$/, shellGit)
    await expect.poll(async () => (await win(app)).title).toBe('proj — feat/1-x')

    await page.keyboard.type('git switch -q --detach\n')
    await expect(branch(page)).toHaveText(/[0-9a-f]{7}$/, shellGit)

    await page.keyboard.type('git worktree add -q -b wt ../proj-wt && cd ../proj-wt\n')
    // worktree 로 cd 하기 전에도 workspace 이름이 `proj` 이므로, branch 가 `wt` 로 바뀐 뒤에 이름을 확인한다.
    await expect(branch(page)).toHaveText(/wt$/, shellGit)
    await expect(workspaceItems(page)).toHaveText(['proj'])
    await expect(tip(page)).toHaveAttribute('title', 'proj — wt\n~/proj-wt')
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
  const hook = claudeHook('UserPromptSubmit').trimEnd()
  await page.keyboard.type(`git switch -q -c by-claude && ${hook} && sleep 30\n`)
  await expect(paneRows(page)).toHaveClass(/working/, shellGit)
  await expect(branch(page)).toHaveText(/by-claude$/)
})

test('경로는 workspace 마다 헤더 툴팁에 있고, 헤더를 눌러도 키 입력이 터미널에 남으며, columns 의 workspace 헤더에도 branch 가 붙는다', async ({
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
  await expect(heads(page).nth(1)).toHaveAttribute('title', 'notes\n~/notes')
  await expect(heads(page).nth(0)).toHaveAttribute('title', 'proj — main\n~/proj')

  await heads(page).nth(0).click()
  await expect(workspaceGroups(page).nth(0)).toHaveClass(/selected/)
  await run(page, 'echo path-$((1+1))', 'path-2')

  await toggleView(launched, 'columns')
  await expect(page.locator('.workspace-header .branch')).toHaveText(['main'])
})

test('아이콘은 모두 앞 글꼴의 fallback 이 아니라 함께 실은 Nerd Font 를 글꼴로 정해 그린다', async ({
  launch,
  dataDir
}) => {
  const home = repoHome(dataDir)
  const launched = await launch({ SHELL: '/bin/zsh', HOME: home })
  const { page } = launched
  await page.keyboard.type('cd proj\n')
  await expect(branch(page)).toHaveText(/main$/)
  await toggleView(launched, 'columns')
  await page.keyboard.type(claudeHook('UserPromptSubmit'))
  await expect(page.locator('.workspace-header')).toHaveClass(/working/)

  // 이 화면에서 `ICONS` 를 그리는 자리는 일곱이다: 사이드바의 branch·접기·상태·Claude 아이콘,
  // pane 헤더의 상태·Claude 아이콘, columns 보기의 workspace 헤더 상태 아이콘.
  const families = await page.evaluate((glyphs) => {
    const found: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (glyphs.some((g) => node!.textContent!.includes(g)))
        found.push(getComputedStyle(node.parentElement!).fontFamily)
    return found
  }, Object.values(ICONS))

  expect(families).toEqual(Array(7).fill('"Symbols Nerd Font Mono"'))
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

test('branch 이름이 길면 branch 를 줄이고, 접기 화살표는 헤더 줄 안에 남는다', async ({
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
    const head = document.querySelector('.sidebar .head')!.getBoundingClientRect()
    const fold = document.querySelector('.sidebar .fold')!.getBoundingClientRect()
    const name = document.querySelector<HTMLElement>('.sidebar .branch-name')!
    return { foldInside: fold.right <= head.right, branchCut: name.scrollWidth > name.clientWidth }
  })
  expect(fit).toEqual({ foldInside: true, branchCut: true })
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

const collapsedGroups = (page: Page) => page.locator('.sidebar.collapsed .group')

async function collapse(app: ElectronApplication, page: Page): Promise<void> {
  await clickMenu(app, 'toggle-sidebar')
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
  await expect.poll(() => sidebarWidth(page)).toBe(85)
}

async function twoClaudes(app: ElectronApplication, page: Page): Promise<void> {
  await page.keyboard.type(`${claudeHook('UserPromptSubmit').trimEnd()} && sleep 600\n`)
  await split(app, page, 'split-right', 2)
  await page.keyboard.type(
    `${claudeHook('PermissionRequest', { session: 'c-2' }).trimEnd()} && sleep 600\n`
  )
  await expect(paneRows(page)).toHaveClass([/working/, /waiting/])
}

test('접기 화살표는 workspace 의 pane 줄을 한 줄로 접고, 화살표나 그 줄을 누르면 편다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await twoClaudes(app, page)
  await newWorkspace(launched, 2)
  const fold = workspaceGroups(page).locator('.fold')
  await expect(fold).toHaveCount(2)

  await fold.nth(0).click()

  await expect(fold.nth(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(paneRows(page)).toHaveCount(0)
  await fold.nth(0).click()
  await expect(paneRows(page)).toHaveCount(2)

  await fold.nth(1).click()
  await expect(shellRows(page)).toHaveCount(0)
  const summary = workspaceGroups(page).nth(1).locator('.summary')
  await expect(summary).toHaveText(/Shell 1/)
  await summary.click()
  await expect(shellRows(page)).toHaveCount(1)
})

test('접은 사이드바는 같은 목록에서 글자만 빼고, 헤더는 workspace 를, pane 줄은 그 pane 을 고른다', async ({
  launch
}) => {
  const launched = await launch()
  const { app, page } = launched
  await twoClaudes(app, page)
  await newWorkspace(launched, 2)
  // 셸이 cwd 를 알리기 전에는 이름이 Shell 이다.
  await expect(workspaceItems(page).nth(1)).not.toHaveText('Shell')
  const names = await workspaceItems(page).allInnerTexts()

  await collapse(app, page)

  await expect(collapsedGroups(page).locator('.name')).toHaveText(names)
  await expect(collapsedGroups(page).nth(1)).toHaveClass(/selected/)
  await expect(collapsedGroups(page).nth(0).locator('.pane-row')).toHaveClass([
    /working/,
    /waiting/
  ])
  await expect(collapsedGroups(page).nth(1).locator('.pane-row')).toHaveClass(/shell/)
  await expect(collapsedGroups(page).locator('.pane-row .title').first()).toHaveCSS('opacity', '0')

  await collapsedGroups(page).nth(0).locator('.pane-row').nth(0).click()

  await expect(collapsedGroups(page).nth(0)).toHaveClass(/selected/)
  await expect(panes(page).nth(0).locator('.terminal-view')).toHaveClass(/active/)
  await collapsedGroups(page).nth(1).locator('.workspace').click()
  await expect(collapsedGroups(page).nth(1)).toHaveClass(/selected/)
})

test('접고 펴도 pane 줄의 상태 아이콘과 구획 선은 같은 자리에 있다', async ({ launch }) => {
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

  await collapse(app, page)

  expect(await marks()).toEqual(expanded)
})

test('접은 workspace 는 접은 사이드바에서도 가장 급한 상태 하나로 보인다', async ({ launch }) => {
  const { app, page } = await launch()
  await twoClaudes(app, page)
  await workspaceGroups(page).locator('.fold').click()

  await collapse(app, page)

  await expect(collapsedGroups(page).locator('.pane-row')).toHaveCount(0)
  await expect(collapsedGroups(page).locator('.summary')).toHaveClass(/waiting/)
})

test('사이드바를 접고 펴는 동안에는 터미널 크기를 맞추지 않고, 폭이 다 바뀐 뒤 한 번 맞춘다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await shellSize(page)
  const widths = await watchTerminalWidths(page)

  await collapse(app, page)
  const collapsed = await shellSize(page)
  await clickMenu(app, 'toggle-sidebar')
  await expect.poll(() => sidebarWidth(page)).toBe(282)
  const expanded = await shellSize(page)

  expect(collapsed.cols).toBeGreaterThan(before.cols)
  expect(expanded.cols).toBe(before.cols)
  expect(await widths()).toHaveLength(3)
})

test('접히는 도중에 다시 펴도 터미널을 중간 폭으로 맞추지 않는다', async ({ launch }) => {
  const { app, page } = await launch()
  const widths = await watchTerminalWidths(page)

  await clickMenu(app, 'toggle-sidebar')
  // `.side` 의 width transition(180ms, `App.vue`)이 도는 도중에 되돌린다.
  await page.waitForTimeout(60)
  await clickMenu(app, 'toggle-sidebar')

  await expect.poll(() => sidebarWidth(page)).toBe(282)
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
  await expect.poll(() => sidebarWidth(page)).toBe(480)
  await resizeBy(app, -400, 0)
  await expect.poll(() => sidebarWidth(page)).toBe(300)

  await dragHandle(page, sidebarResizer(page), -50)

  await expect.poll(() => sidebarWidth(page)).toBe(250)
})

test('경계는 왼쪽 버튼으로 끌 때만 폭이 바뀐다', async ({ launch }) => {
  const { page } = await launch()

  await dragHandle(page, sidebarResizer(page), 80, { button: 'right' })

  expect(await sidebarWidth(page)).toBe(282)
  await expect(page.locator('.side')).not.toHaveClass(/resizing/)
})

test('Canvas 를 연 채 사이드바를 펴는 동안에도 터미널이 Canvas 를 덮지 않는다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await clickMenu(app, 'toggle-canvas')
  await expect(page.locator('.canvas')).toBeVisible()
  await collapse(app, page)
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

test('사이드바 오른쪽 경계를 끌어 폭을 200~480 사이로 바꾸고, 접었다 펴도 그 폭이다', async ({
  launch
}) => {
  const { app, page } = await launch()
  const before = await sidebarWidth(page)

  await dragHandle(page, sidebarResizer(page), 60)
  await expect.poll(() => sidebarWidth(page)).toBe(before + 60)
  await dragHandle(page, sidebarResizer(page), -600)
  await expect.poll(() => sidebarWidth(page)).toBe(200)
  await dragHandle(page, sidebarResizer(page), 600)
  await expect.poll(() => sidebarWidth(page)).toBe(480)

  await collapse(app, page)
  await clickMenu(app, 'toggle-sidebar')
  await expect.poll(() => sidebarWidth(page)).toBe(480)
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
  await collapse(app, page)
  await page.locator('.sidebar .list').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  expect(await underButtons()).toBeNull()
})

test('펼친 사이드바에서 접은 workspace 는 가장 급한 상태와 pane 수를 한 줄로 보인다', async ({
  launch
}) => {
  const { app, page } = await launch()
  await twoClaudes(app, page)

  await workspaceGroups(page).locator('.fold').click()

  const summary = workspaceGroups(page).locator('.summary')
  await expect(summary).toHaveClass(/waiting/)
  await expect(summary).toHaveText(/Claude 2/)
})

test('접은 workspace 는 Claude 가 끝나도 접힌 채로, 요약 줄이 셸 수로 바뀐다', async ({
  launch
}) => {
  const { page } = await launch()
  await page.keyboard.type(claudeHook('UserPromptSubmit'))
  await workspaceGroups(page).locator('.fold').click()
  const summary = workspaceGroups(page).locator('.summary')
  await expect(summary).toHaveText(/Claude 1/)

  await page.keyboard.type('"$MARU_CLI" claude exit\n')

  await expect(summary).toHaveText(/Shell 1/)
  await expect(summary).not.toHaveClass(/working|waiting|idle/)
  await expect(paneRows(page)).toHaveCount(0)
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
  await collapse(app, page)
  expect(await region('.sidebar')).toBe('drag')
  expect(await region('.sidebar .pane-row')).toBe('no-drag')
})
