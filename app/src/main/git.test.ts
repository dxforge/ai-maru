import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitHead } from './git'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'maru-git-')))
  dirs.push(d)
  return d
}

// 테스트가 만드는 저장소의 ref 형식을 `files` 로 고정한다. 전역 `init.defaultRefFormat` 이
// reftable 이면 `gitHead`(`git.ts`)가 branch 를 돌려주지 않기 때문이다. 그때 HEAD 파일은
// `refs/heads/.invalid` 만 가리킨다.
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultRefFormat=files', ...args],
    { cwd, encoding: 'utf8' }
  ).trim()
}

function repo(name = 'proj'): string {
  const dir = join(tempDir(), name)
  mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}

describe('gitHead', () => {
  it('저장소 맨 위와 그 아래 디렉토리에서 저장소 이름과 branch 를 읽는다', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'a', 'b'), { recursive: true })
    expect(await gitHead(dir)).toEqual({ repo: 'proj', branch: 'main' })
    expect(await gitHead(join(dir, 'a', 'b'))).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('/ 가 든 branch 이름을 그대로 읽고, 바꾸면 다시 읽을 때 따라간다', async () => {
    const dir = repo()
    git(dir, 'switch', '-q', '-c', 'feat/32-x')
    expect(await gitHead(dir)).toEqual({ repo: 'proj', branch: 'feat/32-x' })
    git(dir, 'switch', '-q', 'main')
    expect(await gitHead(dir)).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('HEAD 가 branch 를 가리키지 않으면 커밋 해시 앞 7자리를 쓴다', async () => {
    const dir = repo()
    git(dir, 'switch', '-q', '--detach')
    const sha = git(dir, 'rev-parse', 'HEAD')
    expect(await gitHead(dir)).toEqual({ repo: 'proj', branch: sha.slice(0, 7) })
  })

  it('linked worktree 는 원래 저장소 이름과 그 worktree 의 branch 를 쓴다', async () => {
    const dir = repo('ai-maru')
    const wt = join(dir, '.claude', 'worktrees', 'feat-1-x')
    git(dir, 'worktree', 'add', '-q', '-b', 'feat/1-x', wt)
    expect(await gitHead(wt)).toEqual({ repo: 'ai-maru', branch: 'feat/1-x' })
    expect(await gitHead(dir)).toEqual({ repo: 'ai-maru', branch: 'main' })
  })

  it('submodule 은 그 디렉토리 이름을 쓴다', async () => {
    const top = repo('top')
    const modules = join(top, '.git', 'modules', 'lib')
    mkdirSync(modules, { recursive: true })
    writeFileSync(join(modules, 'HEAD'), 'ref: refs/heads/dev\n')
    mkdirSync(join(top, 'vendor', 'lib'), { recursive: true })
    writeFileSync(join(top, 'vendor', 'lib', '.git'), 'gitdir: ../../.git/modules/lib\n')
    expect(await gitHead(join(top, 'vendor', 'lib'))).toEqual({ repo: 'lib', branch: 'dev' })
  })

  it('bare 저장소에 붙은 worktree 는 bare 저장소의 이름을 쓴다', async () => {
    const dir = repo()
    const bare = join(dirname(dir), 'myrepo.git')
    git(dirname(dir), 'clone', '-q', '--bare', dir, bare)
    const wt = join(dirname(dir), 'wt-main')
    git(bare, 'worktree', 'add', '-q', wt, 'main')
    expect(await gitHead(wt)).toEqual({ repo: 'myrepo', branch: 'main' })
  })

  it('.bare 에 bare 저장소를 두고 .git 파일로 가리키는 배치는 그 위 디렉토리 이름을 쓴다', async () => {
    const src = repo()
    const top = join(dirname(src), 'top')
    mkdirSync(top)
    git(top, 'clone', '-q', '--bare', src, '.bare')
    writeFileSync(join(top, '.git'), 'gitdir: ./.bare\n')
    git(top, 'worktree', 'add', '-q', '-b', 'wt', join(top, 'wt'), 'main')
    expect(await gitHead(top)).toEqual({ repo: 'top', branch: 'main' })
    expect(await gitHead(join(top, 'wt'))).toEqual({ repo: 'top', branch: 'wt' })
  })

  it('--separate-git-dir 로 git 디렉토리를 다른 곳에 두면 작업 트리 이름을 쓴다', async () => {
    const base = tempDir()
    mkdirSync(join(base, 'store'))
    git(
      base,
      'init',
      '-q',
      '-b',
      'main',
      '--separate-git-dir',
      join(base, 'store', 'abc123'),
      'myproj'
    )
    expect(await gitHead(join(base, 'myproj'))).toEqual({ repo: 'myproj', branch: 'main' })
  })

  it('reftable 저장소는 HEAD 의 자리표시를 branch 로 쓰지 않는다', async () => {
    const dir = join(tempDir(), 'rt')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/.invalid\n')
    expect(await gitHead(dir)).toEqual({ repo: 'rt' })
  })

  it('심링크는 풀어서, 저장소 안을 가리키면 그 저장소로 본다', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'sub'))
    const links = tempDir()
    symlinkSync(join(dir, 'sub'), join(links, 'sublink'))
    symlinkSync(dir, join(links, 'toplink'))
    expect(await gitHead(join(links, 'sublink'))).toEqual({ repo: 'proj', branch: 'main' })
    expect(await gitHead(join(links, 'toplink'))).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('HEAD 가 없는 .git 디렉토리는 건너뛰고 위로 찾는다', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'inner', '.git'), { recursive: true })
    expect(await gitHead(join(dir, 'inner'))).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('저장소 밖이거나 절대 경로가 아니면 null 이다', async () => {
    expect(await gitHead(tempDir())).toBeNull()
    expect(await gitHead('proj')).toBeNull()
  })

  it('.git 파일이 깨졌거나 없는 곳을 가리키면 바깥 저장소로 올라가지 않고 null 이다', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'broken'))
    writeFileSync(join(dir, 'broken', '.git'), 'nonsense\n')
    mkdirSync(join(dir, 'moved'))
    writeFileSync(join(dir, 'moved', '.git'), 'gitdir: /nonexistent/.git/worktrees/x\n')
    expect(await gitHead(join(dir, 'broken'))).toBeNull()
    expect(await gitHead(join(dir, 'moved'))).toBeNull()
  })
})
