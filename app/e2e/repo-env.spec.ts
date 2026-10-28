import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, git, rows, test } from './app'

// 저장소를 reftable 로 만들게 하고, 서명할 수 없는 커밋 서명을 켠다. 이 설정을 읽은 git 은 files 저장소를 만들지 못하고 커밋도 실패한다.
const DEVELOPER_CONFIG =
  '[init]\n\tdefaultRefFormat = reftable\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /nonexistent\n'

function imitateDeveloper(dataDir: string, defer: (fn: () => void) => void): string {
  const home = join(dataDir, 'home')
  mkdirSync(home)
  writeFileSync(join(home, '.gitconfig'), DEVELOPER_CONFIG)
  const config = join(dataDir, 'gitconfig')
  writeFileSync(config, DEVELOPER_CONFIG)
  const outer = join(dataDir, 'outer.git')
  const vars = {
    HOME: home,
    GIT_CONFIG_GLOBAL: config,
    GIT_DEFAULT_REF_FORMAT: 'reftable',
    GIT_DIR: outer
  }
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  Object.assign(process.env, vars)
  defer(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
  return outer
}

test('테스트가 실행하는 git 은 개발자의 git 설정과 env 의 GIT_* 를 읽지 않는다', async ({
  dataDir,
  defer
}) => {
  const outer = imitateDeveloper(dataDir, defer)
  const repo = join(dataDir, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  expect(git(repo, 'rev-parse', '--show-ref-format').trim()).toBe('files')
  expect(existsSync(outer)).toBe(false)
})

test('앱이 띄운 셸의 git 은 개발자의 git 설정과 env 의 GIT_* 를 읽지 않는다', async ({
  launch,
  dataDir,
  defer
}) => {
  const outer = imitateDeveloper(dataDir, defer)
  const { page } = await launch()
  await page.keyboard.type(
    'cd && git init -q repo && cd repo && git commit -q --allow-empty -m init && echo ref-$(git rev-parse --show-ref-format)\n'
  )
  // 셸에서 친 git 은 `/usr/bin/git`(xcrun shim)을 거쳐 느릴 수 있으므로 `sidebar.spec.ts` 의 `shellGit` 과 같이 기다린다.
  await expect(rows(page)).toContainText('ref-files', { timeout: 15_000 })
  expect(existsSync(outer)).toBe(false)
})
