import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  claudeHook,
  expect,
  newWorkspace,
  paneRows,
  run,
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
  const sidebar = page.locator('.sidebar')
  expect(await sidebar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0)
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
