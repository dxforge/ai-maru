# 글자 칸 격자와 재생

renderer 는 pane 을 터미널 글자 칸의 격자에 맞춰 놓고 열·행 수를 정하며, `maru-pty` 는 그 크기로 화면을 재생한다. 그래서 renderer 의 JS 셈과 CSS, renderer 의 xterm 과 `maru-pty` 의 VT 가 같은 값과 같은 규칙을 써야 한다. 이 파일은 그 약속을 적는다. 주로 닿는 코드는 `app/src/renderer/src/App.vue`, `components/TerminalView.vue`, `workspace/columns.ts`·`grid.ts`, `style.css`, `app/src/shared/layout.ts`, `app/src/renderer/src/pty/attach.ts`, `core/crates/maru-pty/src/attach.rs`·`pty.rs`·`vt/mod.rs` 다.

## 열 수 셈이 빼는 폭과 CSS 가 그리는 폭은 같다

`App.vue` 는 cell 마다 그 글꼴의 글자 칸 크기를 `--row`·`--cell` 로, 터미널 왼쪽 여백 `TERMINAL_PADDING` 을 `--pad` 로 그 cell 의 `.panes` 요소에 둔다. 여백은 `.xterm` 의 `padding-left` 이고, 스크롤바 폭은 xterm 옵션의 `SCROLLBAR_WIDTH` 다. 열 수를 세는 쪽은 pane 폭에서 이 둘을 빼고 글자 칸 폭으로 나눈다.

- 코드: `App.vue` 의 `gridVars` ↔ `TerminalView.vue` 의 CSS(`padding-left: var(--pad)`)·xterm 옵션(`scrollbar.width`) ↔ `columns.ts` 의 `fitCols`·`paneCells` ↔ `style.css` 의 `.row-bar`
- 바꾸면: 한쪽만 바꾸면 터미널의 마지막 열이 잘리거나 오른쪽에 빈 칸이 남는다.
- 테스트: `app/e2e/terminal-fit.spec.ts` › 「터미널 스크롤바는 열 수 계산이 빼는 SCROLLBAR_WIDTH 만큼의 폭으로 그린다」, 「터미널 영역이 720px 일 때 위아래로 나눈 두 pane 은 같은 열 수이고, 여백과 스크롤바를 뺀 폭에 들어가는 수다」

## pane 헤더는 터미널 한 행이다

pane 헤더의 높이는 `--row` 이고 터미널과 같은 글꼴·크기로 쓴다. 터미널의 행 수는 pane 높이를 글자 칸 높이로 나눈 수에서 헤더 한 행을 뺀 수다. pane 의 최소 크기(`PANE_MIN`)의 행도 헤더를 뺀 터미널 행이다.

- 코드: `style.css` 의 `.row-bar`·`PaneHeader.vue` ↔ `App.vue` 의 `terminalSize` ↔ `grid.ts` 의 `paneMin`, `shared/layout.ts` 의 `PANE_MIN`
- 바꾸면: 헤더 높이를 한 행이 아니게 바꾸면 터미널이 pane 아래로 넘치거나 빈 줄이 남는다.
- 테스트: `grid.test.ts` › 「터미널 20열과 여백·스크롤바가 들어가는 글자 칸 폭, 헤더를 더한 6행 높이다」, `terminal-fit.spec.ts` › 「창을 열면 터미널이 창의 높이를 줄 단위로 채운다」

## 붙을 때의 크기로 재생하고, 그 뒤에는 primary 만 크기를 바꾼다

`TerminalView` 는 처음 받은 열·행 수로 pty 에 붙는다. `maru-pty` 는 그 크기로 화면을 재생한다. 그 뒤 `TerminalView` 는 primary 일 때만 받은 열·행 수로 `term.resize` 를 부르고, `maru-pty` 는 primary 의 resize 만 pty 에 적용한다. observer 는 `attached`·`resync` 에 실린 크기와, 붙어 있는 동안 primary 가 크기를 바꾸면 `maru-pty` 가 다른 연결에 보내는 `size` 를 따른다.

- 코드: `TerminalView.vue` 의 `applySize` ↔ `renderer/src/pty/attach.ts`(`attached`·`resync`·`size`) ↔ `maru-pty` 의 `attach.rs`(`size`), `pty.rs` 의 `resize_if_primary`
- 바꾸면: observer 가 자기 크기로 resize 하면 primary 의 크기로 그린 출력이 observer 화면에서 어긋난다.
- 테스트: `app/src/renderer/src/pty/attach.test.ts` › 「자리를 내준 뒤 밀려 resync 를 받으면 그 크기를 따른다」, `core/crates/maru-pty/tests/process.rs` › `only_one_primary_sets_the_size`, `other_clients_learn_the_size_the_primary_sets`

## xterm 과 `maru-pty` 는 글자 폭을 같은 규칙으로 센다

renderer 의 xterm 과 `maru-pty` 의 VT 는 글자마다 차지하는 글자 칸 수를 같은 규칙으로 센다. 둘이 다르게 세면 재생한 화면에서 그 글자 뒤의 글자가 밀린다. 둘 다 grapheme cluster 를 한 글자로 센다. 피부색 수식자나 ZWJ 로 이은 emoji, VS16 이 붙은 글자는 폭이 2 다. xterm 은 `@xterm/addon-unicode-graphemes` 로, `maru-pty` 는 VT 를 만들 때 mode 2027 을 기본값으로 켜서 센다.

프로그램이 `CSI ? 2027 l` 로 mode 2027 을 끄면 `maru-pty` 만 꺼지므로 두 쪽이 다르게 센다. xterm 은 이 mode 를 처리하지 않는다. 이때 xterm 은 👍🏽·👨‍👩‍👧·❤️ 를 모두 2 로 세고, `maru-pty` 는 4·6·1 로 센다.

- 코드: `TerminalView.vue`(`UnicodeGraphemesAddon`) ↔ `core/crates/maru-pty/src/vt/mod.rs`(mode 2027)
- 바꾸면: 한쪽의 폭 규칙만 바꾸면 재시작해 다시 붙은 pane 의 커서가 xterm 이 센 열과 어긋난다.
- 테스트: `vt/mod.rs` › `emoji_sequences_take_the_cells_of_the_shared_samples`, `app/src/renderer/src/components/terminalWidth.test.ts` › 「xterm 은 %s 를 fixture 의 폭으로 센다」, `app/e2e/unicode.spec.ts` › 「emoji·한글을 찍은 뒤 커서를 Claude Code 가 세는 열에 둔다」. 셋 다 `core/crates/maru-pty/tests/widths.json` 을 읽는다. mode 2027 을 끈 뒤의 차이도 이 fixture 에 적혀 있다. e2e 는 두 쪽의 폭이 같은 줄만 찍는다. `vt/mod.rs` › `emoji_sequences_keep_their_cells_after_a_full_reset` 과 `unicode.spec.ts` › 「emoji 를 찍고 재시작하면 maru-pty 가 재생한 커서가 xterm 이 센 열과 같다」 는 fixture 를 읽지 않고 글자와 폭을 테스트 안에 둔다.

## 밀린 클라이언트는 RIS 와 재생으로 다시 맞춘다

observer 가 밀리면 `maru-pty` 는 그 사이의 출력을 버리고, `resync` 헤더 뒤에 RIS(`\x1bc`)와 재생을 보낸다. renderer 는 resync 를 받아도 xterm 을 따로 reset 하지 않고 이 RIS 에 기댄다. RIS 는 xterm 의 그리드와 모드를 기본값으로 돌리고, 버려진 출력의 마지막 프레임이 남긴 끝나지 않은 시퀀스나 UTF-8 글자도 끊는다.

- 코드: `attach.rs` 의 `resync`·`VT_RESET` ↔ `renderer/src/pty/attach.ts`(`resync`)
- 바꾸면: `maru-pty` 가 RIS 를 빼면 renderer 의 xterm 에 버려진 출력의 모드와 반쯤 받은 시퀀스가 남는다.
- 테스트: `process.rs` › `a_client_that_falls_behind_is_resynced`, `a_client_that_keeps_falling_behind_is_cut_off_after_five_resyncs`, `a_resync_in_the_middle_of_a_sequence_replays_its_start`, `attach.test.ts` › 「프레임이 %s 중간에서 끝난 뒤 resync 를 받으면 화면이 재생과 같다」, 「버려진 출력이 %s 를 켰어도 resync 뒤의 화면과 모드는 재생과 같다」(대체 화면·스크롤 영역·bracketed paste). `attach.test.ts` 는 `attach.rs` 의 `VT_RESET` 을 읽어 쓴다. 숨긴 커서는 xterm 의 RIS 가 되돌리지 않아 케이스에 넣지 않았다. renderer 가 reset 하지 않는 것은 지킬 규칙이 아니다. renderer 가 reset 해도 뒤따르는 RIS 가 같은 일을 하기 때문이다.
