/** 열기 시작해 이만큼 지나도 pty 가 뜨지 않았으면 여는 중임을 보인다. */
export const OPENING_SHOW_MS = 3000
/** 여는 중이 이만큼 길어지면 다시 열기를 더한다. */
export const OPENING_RETRY_MS = 5000

export type OpeningView =
  | { kind: 'hidden' }
  | { kind: 'opening'; seconds: number; retry: boolean }
  | { kind: 'failed'; message: string; retry: boolean }

/**
 * pty 가 뜨기 전 터미널 첫 줄에 보일 것을 고른다. `failed` 는 띄우지 못한 이유다. `retryable` 은 CLI 가 답을 기다리는
 * pane 에서 false 이고, 그 pane 에는 다시 열기를 두지 않는다. `attaching` 은 되살린 pane 이 떠 있는 pty 에 붙는 중이라는
 * 뜻이다. 이때 다시 열면 붙으려던 pty 를 끄고 새로 띄우므로, `opening` 에는 `retry` 를 켜지 않는다.
 */
export function openingView({
  elapsedMs,
  failed,
  retryable,
  attaching = false
}: {
  elapsedMs: number
  failed?: string
  retryable: boolean
  attaching?: boolean
}): OpeningView {
  if (failed !== undefined) return { kind: 'failed', message: failed, retry: retryable }
  if (elapsedMs < OPENING_SHOW_MS) return { kind: 'hidden' }
  return {
    kind: 'opening',
    seconds: Math.floor(elapsedMs / 1000),
    retry: retryable && !attaching && elapsedMs >= OPENING_RETRY_MS
  }
}
