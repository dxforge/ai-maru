import { execFileSync } from 'node:child_process'

/**
 * unit·e2e 테스트가 실행하는 git 과 e2e 가 띄운 앱의 셸에서 실행하는 git 이 쓰는 env. 개발자의 git 설정(예:
 * `init.defaultRefFormat=reftable`)과 env 의 `GIT_*`(예: hook 안에서 돌릴 때의 `GIT_DIR`)에 따라 테스트 저장소가
 * 달라지지 않도록, 전역·시스템 설정을 읽지 않게 하고 `GIT_*` 를 물려주지 않는다. 전역 설정이 없으면 커밋할 사용자
 * 정보도 없으므로 env 로 준다.
 */
export function gitEnv(): Record<string, string | undefined> {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    // `--ref-format` 을 주지 않고 만드는 저장소는 git 의 기본값과 상관없이 files 로 만든다. unit 테스트는 그 저장소로
    // `.git` 을 직접 읽는 files 경로를 시험한다. e2e 에서는 앱이 reftable 저장소의 branch 를 `git` 을 실행해 읽으므로
    // 느리다. 같은 테스트 40개를 병렬로 돌리면 cell 이름이 바뀌기까지 최대 4.9초 걸렸고, 40번 가운데 1번은 `expect` 의
    // 기본 대기 5초를 넘겼다.
    GIT_DEFAULT_REF_FORMAT: 'files',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t'
  }
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8' })
}

/**
 * 격리를 재는 테스트가 개발자의 git 설정 자리에 쓰는 내용이다. 이 설정을 읽은 git 은 `gpg.program` 이 없는 경로이므로
 * 커밋에 실패한다. `init.defaultRefFormat` 은 `gitEnv` 가 준 `GIT_DEFAULT_REF_FORMAT` 이 앞서므로, 설정을 읽었는지는 이
 * 값으로 드러나지 않는다.
 */
export const DEVELOPER_GIT_CONFIG =
  '[init]\n\tdefaultRefFormat = reftable\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /nonexistent\n'
