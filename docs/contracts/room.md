# room

`maru room` 은 이름 붙은 방에 참여자가 기록을 남기고 읽는 명령이다. 방의 상태는 sqlite 파일 하나에 있고 앱(main)을 거치지 않는다. 규칙은 `maru` CLI 가 지킨다. 이 파일은 같은 방 파일을 쓰는 여러 빌드의 `maru` 가 함께 지키는 약속과, `maru room` 을 부르는 쪽이 기대는 출력·exit code 를 적는다.

## 방 파일은 `MARU_ROOM_DB`, 없으면 `~/.ai-maru/rooms.sqlite` 다

모든 방이 파일 하나에 있다. `maru` 는 `MARU_ROOM_DB` 가 있으면 그 경로를, 없으면 `$HOME/.ai-maru/rooms.sqlite` 를 쓴다. 테스트는 `MARU_ROOM_DB` 로 방 파일을 따로 둔다.

- 코드: `room.rs` 의 `db_path`

## 스키마는 더하기만 하고 버전은 `user_version` 이다

파일의 `PRAGMA user_version` 이 스키마 버전이다. 방 파일은 앱을 다시 설치해도 남고, 기본 경로가 빌드마다 같으므로 개발 빌드와 설치한 앱처럼 서로 다른 빌드의 `maru` 가 같은 파일을 함께 쓴다. 그래서 스키마는 열·표를 더하기만 하고, 방·기록을 버리는 다시 짜기는 하지 않는다. 옛 빌드가 따를 수 없는 바꿈이 꼭 필요하면 파일 이름을 바꾼다. 이 빌드가 모르는 더 높은 버전을 보면 모든 명령이 거절한다(exit 1).

- 코드: `room.rs` 의 `SCHEMA_VERSION`·`migrate`·`prepare`
- 바꾸면: 버전을 올리지 않고 열의 뜻을 바꾸면 옛 빌드가 새 빌드가 쓴 행을 잘못 읽는다. 버전을 올리며 표를 다시 짜면 옮기지 못한 방·기록을 잃는다.
- 테스트: `tests/room.rs` › `a_newer_schema_is_refused`

## 참여자는 이름과 읽은 자리뿐이다

참여자는 `room join <방> --as <이름>` 으로 들어온다. 참여자 행에는 이름과 읽은 자리만 있다. 사람인지 AI 인지는 적지 않는다.

`--as` 는 `new`·`list` 를 뺀 모든 명령에 꼭 붙인다. 토큰은 없으므로 누구든 어떤 이름으로든 명령을 낸다. `post`·`read`·`leave`·`close` 는 방에 들어 있는 이름만 받는다. `leave --as <이름>` 은 그 이름을 누가 내든 방에서 뺀다.

읽은 자리는 0 에서 시작해, 늦게 들어온 참여자의 첫 `read` 도 그 전의 기록을 보인다. `read` 는 읽은 자리 뒤의 기록을 찍고 읽은 자리를 마지막 기록으로 올린다. `--all` 은 처음부터 찍는다. 자기 글은 읽은 것으로 치되, 읽지 않은 기록이 남아 있으면 읽은 자리를 그대로 둔다.

- 코드: `room.rs` 의 `join`·`leave`·`member`·`read`·`post`·`mark_read`
- 바꾸면: `post` 가 읽지 않은 기록이 있을 때도 읽은 자리를 올리면, 그 기록을 다음 `read` 가 보이지 않는다.
- 테스트: `tests/room.rs` › `entries_are_read_once_and_read_all_shows_them_again`, `a_member_who_joins_late_reads_the_entries_before_it`, `a_post_over_unread_entries_leaves_them_for_the_next_read`, `leave_takes_out_any_member_and_is_an_entry`, `a_name_not_in_the_room_cannot_post_read_or_close`, `every_command_that_names_a_member_needs_as`

## 기록은 `BEGIN IMMEDIATE` 하나에서 확인하고 더한다

기록은 번호·글쓴이·종류(`post`·`leave`·`close`)·본문·시각(`at_ms`)이다. 번호는 방마다 1 부터 늘어난다. `post` 는 글을, `leave` 는 나간 이름을 글쓴이로 한 나감 기록을, `close` 는 닫은 이름을 글쓴이로 한 닫힘 기록을 더한다. 쓰는 명령(`join`·`leave`·`post`·`close`)은 `BEGIN IMMEDIATE` 트랜잭션 하나에서 닫힌 방인지, 그다음 참여자인지를 보고 쓴다.

닫힌 방은 쓰기(`join`·`leave`·`post`·`close`)를 exit 6 으로 거절한다. 닫힌 방의 기록은 남고, 방 id 로 `read <id> --as <이름> --all` 하면 읽는다. 닫힌 방의 이름으로는 새 방을 연다. `<방>` 에 이름을 주면 그 이름의 열린 방을, 열린 방이 없으면 그 이름으로 마지막에 닫힌 방을 가리킨다. 숫자만인 인자는 방 id 로 읽으므로, 방 이름은 숫자만으로 짓지 못한다.

| exit | 뜻 |
| --- | --- |
| 1 | 그 밖의 거절(방이 없다, 참여자가 아니다, 이름이 맞지 않다 등)과 오류 |
| 6 | 닫힌 방에 쓰려 했다 |

- 코드: `room.rs` 의 `in_room`·`add_entry`·`post`·`leave`·`close` ↔ `main.rs` 의 `Refusal`·`main`(Refusal 을 exit code 로)
- 바꾸면: 확인과 저장을 다른 트랜잭션으로 나누면, 동시에 올린 두 글이 같은 번호를 골라 하나가 기본 키 충돌로 실패하고, 닫힌 방에도 글이 들어간다.
- 테스트: `tests/room.rs` › `posts_at_once_each_get_their_own_number`, `a_closed_room_refuses_writes_with_6_and_its_name_can_be_reused`, `a_room_name_reads_the_last_closed_room_once_none_is_open`, `a_room_name_cannot_be_only_digits_or_taken_by_an_open_room`

## 출력은 데이터다

명령은 안내 문장을 찍지 않는다. `new` 는 방 id 를, `post` 는 기록 번호를 한 줄로 찍고, `join`·`leave`·`close` 는 아무것도 찍지 않는다. 거절은 exit code 와 stderr 의 까닭 한 줄(`maru: <까닭>`, 영어)이다.

`read` 는 기록 하나를 한 줄로, 번호·글쓴이·종류·본문을 탭으로 나눠 찍는다. 머리줄은 없고 새 기록이 없으면 아무것도 찍지 않는다. 본문의 `\` 는 `\\`, 줄바꿈은 `\n`, 탭은 `\t` 로 적어 여러 줄 글도 한 줄에 든다. 그 밖의 제어 문자는 공백으로 바꾼다. 다른 참여자가 올린 ESC·OSC 가 읽는 쪽 터미널에서 실행되지 않게 하기 위해서다.

`list` 는 `ID`·`NAME`·`LAST`(마지막 기록 번호)·`MEMBERS`(들어온 순서, `, ` 로 잇는다)·`TOPIC` 의 탭 표다. `--closed` 는 닫힌 방을 찍는다. 칸의 제어 문자는 공백으로 바꾼다.

- 코드: `room.rs` 의 `run`·`read`·`escaped`·`list` ↔ `main.rs` 의 `print_tsv`·`tsv_field`
- 바꾸면: 본문을 이스케이프하지 않고 찍으면, 여러 줄 글이 다음 기록처럼 읽히고 남이 올린 제어 문자가 읽는 쪽 터미널을 바꾼다.
- 테스트: `tests/room.rs` › `a_multiline_body_from_stdin_is_one_line_with_backslash_escapes`, `control_characters_in_a_body_and_a_topic_are_spaces`, `an_empty_post_is_refused`, `list_shows_rooms_with_their_last_entry_and_members`; `room.rs` › `a_body_is_one_line_with_backslash_escapes_and_no_control_characters`
