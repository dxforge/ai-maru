import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DEVELOPER_GIT_CONFIG, git } from './test-repo-env'

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

it('테스트가 실행하는 git 은 개발자의 git 설정과 env 의 GIT_* 를 읽지 않는다', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'maru-repo-env-')))
  dirs.push(dir)
  const home = join(dir, 'home')
  mkdirSync(home)
  writeFileSync(join(home, '.gitconfig'), DEVELOPER_GIT_CONFIG)
  writeFileSync(join(dir, 'gitconfig'), DEVELOPER_GIT_CONFIG)
  const outer = join(dir, 'outer.git')
  vi.stubEnv('HOME', home)
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(dir, 'gitconfig'))
  vi.stubEnv('GIT_DEFAULT_REF_FORMAT', 'reftable')
  vi.stubEnv('GIT_DIR', outer)

  const repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  expect(git(repo, 'rev-parse', '--show-ref-format').trim()).toBe('files')
  expect(existsSync(outer)).toBe(false)
})
