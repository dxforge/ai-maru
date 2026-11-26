# room

`maru room` 은 사람과 pane 에 떠 있는 claude 세션 여럿이 한 방의 글을 함께 보는 대화방이다. 방의 상태는 sqlite 파일 하나에 있고 앱(main)을 거치지 않는다. 글을 올리는 `maru` CLI 가 규칙을 지키고, 각 claude 의 `maru claude monitor` 가 파일을 지켜보다 그 세션에 알린다. 이 파일은 CLI·monitor 와, 다른 빌드의 같은 코드가 함께 지키는 약속을 적는다.

## 방 파일은 `MARU_ROOM_DB`, 없으면 `~/.ai-maru/rooms.sqlite` 다

모든 방이 파일 하나에 있다. `maru` 는 `MARU_ROOM_DB` 가 있으면 그 경로를, 없으면 `$HOME/.ai-maru/rooms.sqlite` 를 쓴다. 앱은 격리된 실행(dev 앱, `--user-data-dir` 로 띄운 앱, e2e)에서만 pty 에 `MARU_ROOM_DB`(userData 아래 `rooms.sqlite`)를 넣는다. 설치본이 띄운 pty 에는 넣지 않으므로, 변수 없이 뜬 pane 도 같은 기본 경로의 방을 쓴다.

방 파일을 만드는 것은 `room new` 뿐이다. 다른 명령과 monitor 는 파일이 없으면 만들지 않는다(monitor 는 디렉토리만 만든다).

- 코드: `room.rs` 의 `db_path`·`open` ↔ `pty.ts` 의 `shellEnv`(`ShellSetup.roomDb`)·`roomDbPath`
- 바꾸면: 설치본에도 `MARU_ROOM_DB` 를 넣으면, 변수가 생기기 전에 뜬 pane 과 새 pane 이 서로 다른 파일을 본다.
- 테스트: `pty.test.ts` › 「방 파일을 받으면 MARU_ROOM_DB 로 넣고, 받지 않으면 물려받은 값도 넘기지 않는다」, 「방 파일은 dev 실행과 --user-data-dir 로 띄운 설치본에서만 userData 아래로 정한다」, `tests/room.rs` › `list_shows_open_rooms_with_their_last_entry_and_members`, `monitor_started_before_any_room_notices_rooms_made_later`

## 스키마는 더하기만 하고 버전은 `user_version` 이다

파일의 `PRAGMA user_version` 이 스키마 버전이다. 재설치 뒤에도 오래 떠 있는 claude 의 옛 monitor 와 새 빌드의 CLI 가 같은 시각에 같은 파일을 만진다. 그래서 스키마는 열·표를 더하기만 하고, 방·글을 버리는 다시 짜기는 하지 않는다. 옛 빌드가 따를 수 없는 바꿈이 꼭 필요하면 파일 이름을 바꾼다. 이 빌드가 모르는 더 높은 버전을 보면 CLI 는 거절하고(exit 1), monitor 는 room 알림만 멈춘다.

- 코드: `room.rs` 의 `SCHEMA_VERSION`·`migrate`·`open`(`Opened::Newer`)·`Watch::state`
- 바꾸면: 열의 뜻을 바꾸거나 표를 다시 짜면, 떠 있는 옛 monitor 가 새 CLI 가 쓴 행을 잘못 읽는다.
- 테스트: `tests/room.rs` › `a_newer_schema_is_refused`, `monitor_stops_room_notices_on_a_newer_schema`

## 참여자는 pane 에 묶인 claude 와 이름만 있는 사람이다

claude 참여자는 `room join <방> --as <이름>` 으로 들어오고, 참여자 행(`kind = 'claude'`)에 그 pane 의 `MARU_PTY_ID` 와 `CLAUDE_CODE_SESSION_ID` 를 적는다. 사람 참여자는 `join` 하지 않고, `room post <방> --as <이름>` 으로 처음 올릴 때 `pty`·`session` 이 비어 있는 행(`kind = 'human'`)으로 더해진다. monitor 는 `kind = 'claude'` 인 행만 보므로 사람에게는 알림이 가지 않는다. `post`·`read`·`close` 의 `--as` 는 claude 참여자의 이름을 거절한다.

claude 참여는 `leave` 하기 전까지 그 pane 에 남는다. 같은 pane 에서 `/clear` 하거나 claude 를 새로 띄우면, 방에 들어간 적 없는 새 세션이 옛 이름으로 알림을 받고 `--as` 없이 올린 글도 옛 이름으로 적힌다. 막으려면 `/clear` 전에 `room leave <방>` 하거나, 누구든 `room leave <방> --as <이름>` 으로 내보낸다.

- 코드: `room.rs` 의 `join`·`person`·`member`·`post`·`shown`
- 바꾸면: 사람 행에 pty 를 적으면, `member` 가 kind 를 보지 않고 pty 로만 참여자를 찾으므로, 사람이 claude 의 pane 에서 올린 뒤에는 그 pane 의 claude 가 `--as` 없이 올린 글이 사람 글로 적힐 수 있다.
- 테스트: `tests/room.rs` › `a_person_is_added_on_the_first_post_and_reads_from_its_own_place`, `as_with_a_claude_members_name_is_refused`, `ais_stop_after_three_posts_until_a_person_posts`, `session_start_leaves_rooms_alone`

## 기록은 `BEGIN IMMEDIATE` 하나에서 확인하고 더한다

`room post` 는 `BEGIN IMMEDIATE` 트랜잭션 하나에서 "참여자인지 → 닫힌 방인지 → AI 연속 상한" 을 보고 글을 더한다. `room leave` 는 나감 기록을, `room close` 는 닫은 쪽을 적은 닫힘 기록을 같은 방식으로 더한다. 글을 더한 트랜잭션에서 글쓴이의 알린 자리를 그 글의 번호로 올린다. 거절은 아래 exit code 로 알린다.

AI 연속 상한은 마지막 사람 글 뒤의 claude 글 수다(사람 글이 없으면 방이 열린 뒤의 claude 글 수). 나감·닫힘 기록은 세지 않는다. 상한은 방을 열 때 `room new <방> --ai-limit N` 으로 정하고(기본 3, 0 은 상한 없음) `rooms.ai_limit` 에 둔다.

| exit | 뜻 |
| --- | --- |
| 5 | 마지막 사람 글 뒤에 claude 글이 이미 상한만큼 있다. 사람이 글을 올리면 다시 된다 |
| 6 | 닫힌 방이다. `join`·`close` 도 같다 |

- 코드: `room.rs` 의 `post`·`leave`·`close`·`add_entry`·`ai_streak`·`Refusal` ↔ `main.rs` 의 `main`(Refusal 을 exit code 로)
- 바꾸면: 확인과 저장을 다른 트랜잭션으로 나누면, 상한에 닿은 방에 claude 둘이 함께 올린다.
- 테스트: `tests/room.rs` › `posts_at_once_each_get_their_own_number`, `ais_stop_after_three_posts_until_a_person_posts`, `a_room_sets_its_own_ai_limit_and_0_is_none`, `a_post_over_unread_entries_leaves_them_for_the_next_read`, `leaving_is_an_entry_of_the_room`, `the_close_entry_names_who_closed_the_room`, `a_closed_room_refuses_with_6_and_its_name_can_be_reused`

## 기록을 더한 쪽은 커밋한 뒤 `-notify` 파일을 건드린다

monitor 는 방 파일 경로 뒤에 `-notify` 를 붙인 파일(기본은 `rooms.sqlite-notify`)을 kqueue 로 지켜보고, 바뀌면 방 파일을 다시 읽는다. 방 파일이나 `-notify` 가 아직 없으면 디렉토리를 지켜보다 생긴 뒤에 붙는다.

- 코드: `room.rs` 의 `ring`·`bell_path`·`Watch`
- 바꾸면: 기록을 더하는 새 명령이 `ring` 을 부르지 않으면, 그 기록은 다음 기록이 올 때까지 알려지지 않는다.
- 테스트: `tests/room.rs` › `monitor_notifies_a_post_without_the_app`, `monitor_notifies_who_left`

## monitor 는 자기 pty 의 참여자에게만 `room` 이벤트를 쓴다

monitor 는 자기 `MARU_PTY_ID` 가 claude 참여자인 방마다, 알린 자리 뒤에 남이 더한 기록을 찾아 한 줄을 쓰고 알린 자리를 올린다. 앱 소켓과 상관없이 돈다. session id 는 보지 않는다. `/clear` 하면 Bash 쪽 `CLAUDE_CODE_SESSION_ID` 는 새 id 가 되지만 monitor 는 다시 뜨지 않기 때문이다.

- 코드: `room.rs` 의 `pending`·`event`·`mark`·`Monitor` ↔ `main.rs` 의 `claude_monitor`(모듈 doc 의 알림 모양)
- 바꾸면: 알린 자리를 쓰기 전에 올리면, 줄을 쓰지 못하고 끝난 monitor 의 알림을 다음 monitor 가 내지 않는다.
- 테스트: `tests/room.rs` › `monitor_notifies_a_post_without_the_app`, `monitor_batches_entries_posted_while_it_was_away`, `monitor_skips_other_panes`, `monitor_says_when_one_ai_post_is_left_and_when_the_limit_is_reached`, `monitor_tells_once_that_the_room_closed_and_who_closed_it`, `monitor_writes_room_and_app_notices_and_keeps_room_ones_after_the_app_goes`, `monitor_stops_notices_after_leave`, `rejoining_does_not_wake_for_entries_already_read`
