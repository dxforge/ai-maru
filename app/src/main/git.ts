import { execFile } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { GitHead } from '../shared/git'

async function read(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return undefined
  }
}

/**
 * linked worktree·submodule·`--separate-git-dir` 은 `.git` 이 git 디렉토리를 가리키는 파일이다. git 처럼,
 * HEAD 가 없는 `.git` 디렉토리는 건너뛰고 위로 더 찾지만 깨지거나 끊긴 `.git` 파일에서는 멈춘다.
 */
async function findGitDir(
  cwd: string
): Promise<{ top: string; gitDir: string; head: string } | undefined> {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const dotGit = join(dir, '.git')
    const s = await stat(dotGit).catch(() => undefined)
    if (s?.isFile()) {
      const to = /^gitdir: (.+)$/.exec((await read(dotGit)) ?? '')?.[1]
      const gitDir = to && resolve(dir, to)
      const head = gitDir && (await read(join(gitDir, 'HEAD')))
      return gitDir && head ? { top: dir, gitDir, head } : undefined
    }
    if (s?.isDirectory()) {
      const head = await read(join(dotGit, 'HEAD'))
      if (head) return { top: dir, gitDir: dotGit, head }
    }
    if (dirname(dir) === dir) return undefined
  }
}

function commonName(commonDir: string): string {
  const name = basename(commonDir)
  return name.startsWith('.') ? basename(dirname(commonDir)) : name.replace(/\.git$/, '')
}

/** reftable 저장소의 HEAD 파일은 이 placeholder 만 담는다. 실제 HEAD 는 reftable 에 있다. */
const REFTABLE_HEAD = 'ref: refs/heads/.invalid'

const run = promisify(execFile)

/**
 * 멈춘 git 에 매달리지 않기 위한 상한이라 넉넉히 둔다 — 늦게 온 답은 `lastRead`(`renderer/src/workspace/store.ts`)가
 * 버린다. 부하가 걸린 Mac(load 100)에서 `git symbolic-ref` 를 589번 재니 최대 2984ms 였다. 그 세 배쯤으로 둔다.
 */
const GIT_TIMEOUT_MS = 10_000

/**
 * lock 을 잡지 않는 `symbolic-ref`·`rev-parse` 로 읽는다. 앱이 lock 을 잡으면 그동안 사용자의 git 이
 * ref 를 쓰지 못하기 때문이다. git 이 나중에 optional lock 을 더해도 잡지 않도록 `--no-optional-locks` 를
 * 넘긴다. 앱 env 의 `GIT_COMMON_DIR` 같은 변수가 읽을 저장소를 바꾸지 않도록 `GIT_*` 는 넘기지 않는다.
 */
async function readReftableHead(gitDir: string, timeoutMs: number): Promise<string | undefined> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await run('git', ['--no-optional-locks', `--git-dir=${gitDir}`, ...args], {
      env,
      timeout: timeoutMs
    })
    return stdout.trim()
  }
  try {
    const ref = await git('symbolic-ref', '-q', 'HEAD')
    return ref ? `ref: ${ref}` : undefined
  } catch (err) {
    // exit 1 은 HEAD 가 branch 를 가리키지 않는다는 뜻이다. git 이 없거나 실패한 것과 구별한다.
    if ((err as { code?: unknown }).code !== 1) return undefined
  }
  return git('rev-parse', '-q', '--verify', 'HEAD').catch(() => undefined)
}

/**
 * `git` 을 실행하지 않고 `.git` 을 읽는다 — Command Line Tools 가 없는 Mac 에서는 `git` 을 부르면
 * 설치 창이 뜬다. reftable 저장소의 HEAD 만은 `.git` 으로 읽을 수 없어 `git` 을 실행한다. reftable 저장소는
 * git 이 만드므로 git 이 설치되어 있다고 본다.
 */
export async function gitHead(cwd: string, timeoutMs = GIT_TIMEOUT_MS): Promise<GitHead | null> {
  if (!isAbsolute(cwd)) return null
  const found = await findGitDir(await realpath(cwd).catch(() => cwd))
  if (!found) return null
  const common = await read(join(found.gitDir, 'commondir'))
  const repo = common ? commonName(resolve(found.gitDir, common)) : basename(found.top)
  const head =
    found.head === REFTABLE_HEAD ? await readReftableHead(found.gitDir, timeoutMs) : found.head
  if (!head) return { repo }
  const ref = /^ref: (.+)$/.exec(head)?.[1]
  return { repo, branch: ref ? ref.replace(/^refs\/heads\//, '') : head.slice(0, 7) }
}
