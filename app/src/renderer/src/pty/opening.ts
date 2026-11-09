/** 열기 시작해 이만큼 지나도 pty 가 뜨지 않았으면 여는 중임을 보인다. */
export const OPENING_SHOW_MS = 1000
/** 여는 중이 이만큼 길어지면 다시 열기를 더한다. */
export const OPENING_RETRY_MS = 5000

export type OpeningView =
  | { kind: 'hidden' }
  | { kind: 'opening'; seconds: number; retry: boolean }
  | { kind: 'failed'; message: string; retry: boolean }

/**
 * pty 가 뜨기 전 터미널 첫 줄에 보일 것을 고른다. `failed` 는 띄우지 못한 이유이고, `retryable` 이 false 인
 * pane(CLI 가 답을 기다리는 pane)에는 다시 열기를 두지 않는다.
 */
export function openingView({
  elapsedMs,
  failed,
  retryable
}: {
  elapsedMs: number
  failed?: string
  retryable: boolean
}): OpeningView {
  if (failed !== undefined) return { kind: 'failed', message: failed, retry: retryable }
  if (elapsedMs < OPENING_SHOW_MS) return { kind: 'hidden' }
  return {
    kind: 'opening',
    seconds: Math.floor(elapsedMs / 1000),
    retry: retryable && elapsedMs >= OPENING_RETRY_MS
  }
}
