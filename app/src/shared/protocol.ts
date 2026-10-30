/**
 * 세션이 알아야 하는 것을 바꿀 때 올린다 — 새 요청을 더하거나, 기존 요청의 동작을 고치거나, 세션을 만들 때 넣는 env 나
 * 셸이 뜰 때 읽는 파일을 바꾸는 경우다. 버전이 다른 pty 에는 다음에 뜬 앱이 붙지 않고, 끈 뒤 레이아웃만 되살려 pane 마다
 * 새 셸을 띄운다. 그래서 이전 빌드의 `maru-pty` 에 붙으려고 버전 올리기를 미루지 않는다. `maru-pty` 의 같은 값은
 * `core/crates/maru-pty/src/lib.rs` 에 있다.
 */
export const PROTOCOL_VERSION = 1

export const TAG_TEXT = 1
export const TAG_BINARY = 2
