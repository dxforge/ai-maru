/**
 * 앱과 `maru-pty` 가 주고받는 기존 메시지의 뜻이나 모양을 바꿀 때만 올린다. 더하는 변경은 올리지 않는다 — 옛
 * `maru-pty` 가 무시하는 옵션 필드나, 옛 쪽이 `unknown_request` 로 답하거나 넘기는 새 요청·메시지로 넣는다. 올려도 앱은
 * `MIN_PROTOCOL_VERSION` 부터의 버전으로 떠 있는 pty 에 그 버전의 요청을 보내 붙는다. 떠 있는 pty 는 재시작 뒤에도 옛
 * 바이너리로 돌기 때문이다. `maru-pty` 의 같은 값은 `core/crates/maru-pty/src/lib.rs` 에 있다.
 */
export const PROTOCOL_VERSION = 4

/** 앱이 붙는 가장 낮은 pty 버전. 이 버전의 요청과 응답은 `PROTOCOL_VERSION` 을 올려도 지킨다. */
export const MIN_PROTOCOL_VERSION = 4

export const TAG_TEXT = 1
export const TAG_BINARY = 2
