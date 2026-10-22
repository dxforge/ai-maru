/** 터미널 링크를 ⌘+클릭한 결과. 못 열었으면 `reason` 을 토스트로 보인다. */
export type LinkOpenResult = { ok: true } | { ok: false; reason: string }
