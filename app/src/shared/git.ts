/**
 * `branch` 는 HEAD 가 branch 를 가리키지 않으면 커밋 해시 앞 7자리다. reftable 저장소에서 `git` 으로 읽지
 * 못하면 `branch` 는 없다. `repo` 는 작업 트리 최상위 디렉토리의 이름이다. linked worktree 에서는 원래 저장소의
 * 이름이다.
 */
export type GitHead = { repo: string; branch?: string }
