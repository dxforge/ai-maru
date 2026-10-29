/** 터미널 링크를 ⌘+클릭한 결과. 못 열었으면 `reason` 을 토스트로 보인다. */
export type LinkOpenResult = { ok: true } | { ok: false; reason: string }

/** `/` 로 시작하고 끝 조각에 확장자가 있는 절대경로. 뒤에 `:줄:칸` 이 붙어도 된다. */
export const ABS_PATH =
  /\/+(?:[^\s/:,;'"`)>\]{}]+\/+)*[^\s/:,;'"`)>\]{}]+\.[a-zA-Z0-9]+(?::\d+(?::\d+)?)?/.source
/** `a/b.ext` 꼴의 상대경로. 뒤에 `:줄:칸` 이 붙어도 된다. */
export const REL_PATH = /(?:[a-zA-Z0-9_@.-]+\/)+[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+(?::\d+(?::\d+)?)?/
  .source
const PATH_TEXT_RE = new RegExp(`^(?:${ABS_PATH}|${REL_PATH})$`)

export const isPathText = (text: string): boolean => PATH_TEXT_RE.test(text)

/**
 * 줄을 넘어 이어 붙인 경로 하나의 후보들. `text.slice(s, e)`(`s` 는 `starts`, `e` 는 `ends` 가운데 하나)가 후보다.
 * `ends` 는 오름차순이다.
 */
export type PathCandidates = { text: string; starts: number[]; ends: number[] }

/** 후보마다 실제로 있는 가장 긴 것의 `[s, e]`. 있는 것이 없으면 null. */
export type FoundPath = readonly [number, number] | null

export function isPathCandidates(v: unknown): v is PathCandidates {
  if (typeof v !== 'object' || v === null) return false
  const { text, starts, ends } = v as Record<string, unknown>
  const indexes = (a: unknown) => Array.isArray(a) && a.every((n) => Number.isInteger(n) && n >= 0)
  return typeof text === 'string' && indexes(starts) && indexes(ends)
}
