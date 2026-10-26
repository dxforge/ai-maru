/**
 * `branch` 는 HEAD 가 branch 를 가리키지 않으면 커밋 해시 앞 7자리다. reftable 저장소에서 `git` 으로 읽지
 * 못하면 `branch` 는 없다. `repo` 는 작업 트리 최상위 디렉토리의 이름이다. linked worktree 에서는 원래 저장소의
 * 이름이다. `common` 은 git common dir 의 경로라, 같은 저장소의 worktree 끼리 같고 이름이 같은 다른 클론과는
 * 다르다. `sub` 는 작업 트리 최상위부터 cwd 까지의 상대 경로이고 최상위면 빈 문자열이다. 두 값은 심링크를 푼
 * 실제 경로로 센다. 이 두 값을 더하기 전에 저장한 화면의 `git` 에는 없다.
 */
export type GitHead = { repo: string; branch?: string; common?: string; sub?: string }

const FIELDS = ['repo', 'branch', 'common', 'sub'] as const satisfies readonly (keyof GitHead)[]

export function sameGitHead(a: GitHead | undefined, b: GitHead | undefined): boolean {
  return FIELDS.every((k) => a?.[k] === b?.[k])
}
