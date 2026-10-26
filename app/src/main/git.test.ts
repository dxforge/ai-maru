import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitHead } from './git'

// 테스트 하나가 진짜 git 을 많게는 7번 실행한다. load average 100 인 Mac 에서 `git symbolic-ref` 하나가 가장 오래
// 걸린 것이 2984ms 였으므로(`git.ts` 의 `GIT_TIMEOUT_MS` 주석), 부하가 걸리면 테스트 하나가 vitest 기본 시간 제한
// 5초를 넘길 수 있다. 2984ms 는 589번 가운데 가장 오래 걸린 값이라 7번이 모두 그만큼 걸리지는 않는다고 보고 15초로
// 둔다.
vi.setConfig({ testTimeout: 15_000 })

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'maru-git-')))
  dirs.push(d)
  return d
}

// `git` 은 `--ref-format` 을 넘기지 않고 만드는 저장소의 ref 형식을 `files` 로 고정한다. 전역
// `init.defaultRefFormat` 이 reftable 이면 `.git` 을 직접 읽는 files 경로를 시험하지 못하기 때문이다.
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultRefFormat=files', ...args],
    { cwd, encoding: 'utf8' }
  ).trim()
}

async function head(cwd: string, timeoutMs?: number) {
  const h = await gitHead(cwd, timeoutMs)
  return h && { repo: h.repo, branch: h.branch }
}

type RefFormat = 'files' | 'reftable'

function repo(name = 'proj', format: RefFormat = 'files', commit = true): string {
  const dir = join(tempDir(), name)
  mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'main', `--ref-format=${format}`)
  if (commit) git(dir, 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}

/** lock 파일은 만들었다 지워도 디렉토리 mtime 을 바꾸므로 `.git` 자신과 그 아래 디렉토리의 mtime 까지 비교한다. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((p) => `${p} ${statSync(join(dir, p)).mtimeMs}`)
    .concat(`. ${statSync(dir).mtimeMs}`)
    .sort()
}

function fakeGit(script: string): { bin: string; calls: () => string[] } {
  const bin = tempDir()
  const log = join(bin, 'calls')
  writeFileSync(log, '')
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$*" >> '${log}'\n${script}\n`, { mode: 0o755 })
  return { bin, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) }
}

describe.each<RefFormat>(['files', 'reftable'])('%s 저장소의 gitHead', (format) => {
  it('저장소 맨 위와 그 아래 디렉토리에서 저장소 이름과 branch 를 읽는다', async () => {
    const dir = repo('proj', format)
    mkdirSync(join(dir, 'a', 'b'), { recursive: true })
    expect(await head(dir)).toEqual({ repo: 'proj', branch: 'main' })
    expect(await head(join(dir, 'a', 'b'))).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('/ 가 든 branch 이름을 그대로 읽고, 바꾸면 다시 읽을 때 따라간다', async () => {
    const dir = repo('proj', format)
    git(dir, 'switch', '-q', '-c', 'feat/32-x')
    expect(await head(dir)).toEqual({ repo: 'proj', branch: 'feat/32-x' })
    git(dir, 'switch', '-q', 'main')
    expect(await head(dir)).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('커밋이 없어도 HEAD 가 가리키는 branch 를 쓴다', async () => {
    expect(await head(repo('proj', format, false))).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('HEAD 가 branch 를 가리키지 않으면 커밋 해시 앞 7자리를 쓴다', async () => {
    const dir = repo('proj', format)
    git(dir, 'switch', '-q', '--detach')
    const sha = git(dir, 'rev-parse', 'HEAD')
    expect(await head(dir)).toEqual({ repo: 'proj', branch: sha.slice(0, 7) })
  })

  it('linked worktree 는 원래 저장소 이름과 그 worktree 의 branch 를 쓴다', async () => {
    const dir = repo('ai-maru', format)
    const wt = join(dir, '.claude', 'worktrees', 'feat-1-x')
    git(dir, 'worktree', 'add', '-q', '-b', 'feat/1-x', wt)
    expect(await head(wt)).toEqual({ repo: 'ai-maru', branch: 'feat/1-x' })
    expect(await head(dir)).toEqual({ repo: 'ai-maru', branch: 'main' })
  })
})

describe('gitHead 의 common·sub', () => {
  it('같은 저장소의 worktree 와 하위 폴더는 common 이 같고, sub 는 그 작업 트리 최상위부터 센다', async () => {
    const dir = repo()
    const wt = join(dirname(dir), 'proj-wt')
    git(dir, 'worktree', 'add', '-q', '-b', 'wt', wt)
    mkdirSync(join(wt, 'app', 'e2e'), { recursive: true })
    const top = await gitHead(dir)
    expect(top).toEqual({ repo: 'proj', branch: 'main', common: join(dir, '.git'), sub: '' })
    expect(await gitHead(join(wt, 'app', 'e2e'))).toEqual({
      repo: 'proj',
      branch: 'wt',
      common: join(dir, '.git'),
      sub: 'app/e2e'
    })
  })

  it('이름이 같은 다른 클론은 common 이 다르다', async () => {
    const a = repo('proj')
    const b = repo('proj')
    expect((await gitHead(a))!.common).not.toBe((await gitHead(b))!.common)
  })

  it('심링크로 들어가도 sub 는 실제 경로로 센다', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'sub'))
    const links = tempDir()
    symlinkSync(join(dir, 'sub'), join(links, 'sublink'))
    expect((await gitHead(join(links, 'sublink')))!.sub).toBe('sub')
  })
})

describe('gitHead', () => {
  it('submodule 은 그 디렉토리 이름을 쓴다', async () => {
    const top = repo('top')
    const modules = join(top, '.git', 'modules', 'lib')
    mkdirSync(modules, { recursive: true })
    writeFileSync(join(modules, 'HEAD'), 'ref: refs/heads/dev\n')
    mkdirSync(join(top, 'vendor', 'lib'), { recursive: true })
    writeFileSync(join(top, 'vendor', 'lib', '.git'), 'gitdir: ../../.git/modules/lib\n')
    expect(await head(join(top, 'vendor', 'lib'))).toEqual({ repo: 'lib', branch: 'dev' })
  })

  it('bare 저장소에 붙은 worktree 는 bare 저장소의 이름을 쓴다', async () => {
    const dir = repo()
    const bare = join(dirname(dir), 'myrepo.git')
    git(dirname(dir), 'clone', '-q', '--bare', dir, bare)
    const wt = join(dirname(dir), 'wt-main')
    git(bare, 'worktree', 'add', '-q', wt, 'main')
    expect(await head(wt)).toEqual({ repo: 'myrepo', branch: 'main' })
  })

  it('.bare 에 bare 저장소를 두고 .git 파일로 가리키는 배치는 그 위 디렉토리 이름을 쓴다', async () => {
    const src = repo()
    const top = join(dirname(src), 'top')
    mkdirSync(top)
    git(top, 'clone', '-q', '--bare', src, '.bare')
    writeFileSync(join(top, '.git'), 'gitdir: ./.bare\n')
    git(top, 'worktree', 'add', '-q', '-b', 'wt', join(top, 'wt'), 'main')
    expect(await head(top)).toEqual({ repo: 'top', branch: 'main' })
    expect(await head(join(top, 'wt'))).toEqual({ repo: 'top', branch: 'wt' })
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
    expect(await head(join(base, 'myproj'))).toEqual({ repo: 'myproj', branch: 'main' })
  })

  it('심링크는 풀어서, 저장소 안을 가리키면 그 저장소로 본다', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'sub'))
    const links = tempDir()
    symlinkSync(join(dir, 'sub'), join(links, 'sublink'))
    symlinkSync(dir, join(links, 'toplink'))
    expect(await head(join(links, 'sublink'))).toEqual({ repo: 'proj', branch: 'main' })
    expect(await head(join(links, 'toplink'))).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('HEAD 가 없는 .git 디렉토리는 건너뛰고 위로 찾는다', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'inner', '.git'), { recursive: true })
    expect(await head(join(dir, 'inner'))).toEqual({ repo: 'proj', branch: 'main' })
  })

  it('저장소 밖이거나 절대 경로가 아니면 null 이다', async () => {
    expect(await head(tempDir())).toBeNull()
    expect(await head('proj')).toBeNull()
  })

  it('.git 파일이 깨졌거나 없는 곳을 가리키면 바깥 저장소로 올라가지 않고 null 이다', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'broken'))
    writeFileSync(join(dir, 'broken', '.git'), 'nonsense\n')
    mkdirSync(join(dir, 'moved'))
    writeFileSync(join(dir, 'moved', '.git'), 'gitdir: /nonexistent/.git/worktrees/x\n')
    expect(await head(join(dir, 'broken'))).toBeNull()
    expect(await head(join(dir, 'moved'))).toBeNull()
  })
})

describe('reftable 저장소의 gitHead', () => {
  it('앱의 env 에 있는 GIT_* 는 git 에 넘기지 않는다', async () => {
    const dir = repo('rt', 'reftable')
    vi.stubEnv('GIT_DIR', '/elsewhere/.git')
    vi.stubEnv('GIT_COMMON_DIR', '/elsewhere/.git')
    vi.stubEnv(
      'PATH',
      fakeGit(`/usr/bin/env | /usr/bin/grep -q '^GIT_' && exit 3; echo refs/heads/clean`).bin
    )
    expect(await head(dir)).toEqual({ repo: 'rt', branch: 'clean' })
  })

  it('사용자의 git 이 ref 를 쓰는 중(tables.list.lock)에도 읽는다', async () => {
    const dir = repo('rt', 'reftable')
    writeFileSync(join(dir, '.git', 'reftable', 'tables.list.lock'), '')
    expect(await head(dir)).toEqual({ repo: 'rt', branch: 'main' })
  })

  it('읽어도 .git 아래에 아무것도 만들거나 바꾸지 않는다', async () => {
    const dir = repo('rt', 'reftable')
    const wt = join(dirname(dir), 'rt-wt')
    git(dir, 'worktree', 'add', '-q', '-b', 'wt', wt)
    git(dir, 'switch', '-q', '--detach')
    const before = snapshot(join(dir, '.git'))
    expect(await head(dir)).toMatchObject({ repo: 'rt' })
    expect(await head(wt)).toEqual({ repo: 'rt', branch: 'wt' })
    expect(snapshot(join(dir, '.git'))).toEqual(before)
  })

  it('git 이 없으면 branch 없이 저장소 이름만 쓴다', async () => {
    const dir = repo('rt', 'reftable')
    vi.stubEnv('PATH', tempDir())
    expect(await head(dir)).toEqual({ repo: 'rt' })
  })

  it('git 이 reftable 을 읽지 못하면 다시 실행하지 않고 branch 없이 저장소 이름만 쓴다', async () => {
    const dir = repo('rt', 'reftable')
    const fake = fakeGit('echo "fatal: unknown repository extension" >&2; exit 128')
    vi.stubEnv('PATH', fake.bin)
    expect(await head(dir)).toEqual({ repo: 'rt' })
    expect(fake.calls()).toHaveLength(1)
  })

  it('linked worktree 의 HEAD 가 branch 를 가리키지 않으면 그 worktree 의 커밋 해시 앞 7자리를 쓴다', async () => {
    const dir = repo('rt', 'reftable')
    const wt = join(dirname(dir), 'rt-wt')
    git(dir, 'worktree', 'add', '-q', '--detach', wt)
    const sha = git(wt, 'rev-parse', 'HEAD')
    expect(await head(wt)).toEqual({ repo: 'rt', branch: sha.slice(0, 7) })
    expect(await head(dir)).toEqual({ repo: 'rt', branch: 'main' })
  })

  it('HEAD 가 branch 를 가리키지 않는데 커밋 해시를 읽지 못하면 branch 없이 저장소 이름만 쓴다', async () => {
    const dir = repo('rt', 'reftable')
    const fake = fakeGit(`case "$*" in *symbolic-ref*) exit 1 ;; *) exit 128 ;; esac`)
    vi.stubEnv('PATH', fake.bin)
    expect(await head(dir)).toEqual({ repo: 'rt' })
    expect(fake.calls()).toHaveLength(2)
  })

  it('git 이 아무것도 출력하지 않으면 branch 없이 저장소 이름만 쓴다', async () => {
    const dir = repo('rt', 'reftable')
    vi.stubEnv('PATH', fakeGit('exit 0').bin)
    expect(await head(dir)).toEqual({ repo: 'rt' })
  })

  it('git 이 timeout 안에 끝나지 않으면 다시 실행하지 않고 branch 없이 저장소 이름만 쓴다', async () => {
    const dir = repo('rt', 'reftable')
    const fake = fakeGit('/bin/sleep 10')
    vi.stubEnv('PATH', fake.bin)
    const start = Date.now()
    // 가짜 git(셸 스크립트)이 호출을 기록하기 전에 timeout 으로 종료되면 `calls` 가 비므로, 부하가 걸려도 기록할 수
    // 있게 2초를 준다.
    expect(await head(dir, 2000)).toEqual({ repo: 'rt' })
    // 가짜 git 은 10초 뒤 스스로 끝나므로, `gitHead` 가 그보다 먼저 끝났으면 timeout 이 동작한 것이다. timeout 뒤
    // 가짜 git 을 종료하고 그 종료를 기다리는 시간은 부하가 걸리면 늘어나므로, 상한을 2초 timeout 에 맞추지 않는다.
    expect(Date.now() - start).toBeLessThan(9000)
    expect(fake.calls()).toHaveLength(1)
  })

  it('HEAD 가 branch 를 가리키지 않는데 커밋 해시 읽기가 timeout 안에 끝나지 않으면 branch 없이 저장소 이름만 쓴다', async () => {
    const dir = repo('rt', 'reftable')
    const fake = fakeGit(`case "$*" in *symbolic-ref*) exit 1 ;; *) /bin/sleep 10 ;; esac`)
    vi.stubEnv('PATH', fake.bin)
    const start = Date.now()
    expect(await head(dir, 2000)).toEqual({ repo: 'rt' })
    expect(Date.now() - start).toBeLessThan(9000)
    expect(fake.calls()).toHaveLength(2)
  })

  it('timeout 을 주지 않으면 기본값을 써서, 2초 넘게 걸린 git 의 답도 쓴다', async () => {
    const dir = repo('rt', 'reftable')
    const fake = fakeGit('/bin/sleep 2.2; echo refs/heads/slow')
    vi.stubEnv('PATH', fake.bin)
    expect(await head(dir)).toEqual({ repo: 'rt', branch: 'slow' })
  })
})
