/**
 * `branch` 는 HEAD 가 branch 를 가리키지 않으면 커밋 해시 앞 7자리이고, `.git` 만으로 알 수 없으면(reftable
 * 저장소) 없다. 저장소 이름은 작업 트리 맨 위의 이름이고, linked worktree 는 원래 저장소의 것을 쓴다.
 */
export type GitHead = { repo: string; branch?: string }
