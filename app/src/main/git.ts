import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
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

/**
 * `git` 을 실행하지 않고 `.git` 을 읽는다 — Command Line Tools 가 없는 Mac 에서는 `git` 을 부르면
 * 설치 창이 뜬다.
 */
export async function gitHead(cwd: string): Promise<GitHead | null> {
  if (!isAbsolute(cwd)) return null
  const found = await findGitDir(await realpath(cwd).catch(() => cwd))
  if (!found) return null
  const common = await read(join(found.gitDir, 'commondir'))
  const repo = common ? commonName(resolve(found.gitDir, common)) : basename(found.top)
  const ref = /^ref: (.+)$/.exec(found.head)?.[1]
  // reftable 저장소의 HEAD 는 이 자리표시만 담고, 진짜 branch 는 reftable 에 있다.
  if (ref === 'refs/heads/.invalid') return { repo }
  return { repo, branch: ref ? ref.replace(/^refs\/heads\//, '') : found.head.slice(0, 7) }
}
