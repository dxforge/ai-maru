# room

`maru room` 은 사람 하나와 pane 에 떠 있는 claude 세션 여럿이 한 방의 글을 함께 보는 대화방이다. 방의 상태는 sqlite 파일 하나에 있고 앱(main)을 거치지 않는다. 글을 올리는 `maru` CLI 가 규칙을 지키고, 각 claude 의 `maru claude monitor` 가 파일을 지켜보다 그 세션에 알린다. 이 파일은 CLI·monitor·hook 과, 다른 빌드의 같은 코드가 함께 지키는 약속을 적는다.

## 방 파일은 `MARU_ROOM_DB`, 없으면 `~/.ai-maru/rooms.sqlite` 다

모든 방이 파일 하나에 있다. `maru` 는 `MARU_ROOM_DB` 가 있으면 그 경로를, 없으면 `$HOME/.ai-maru/rooms.sqlite` 를 쓴다. 앱은 격리된 실행(dev 앱, `--user-data-dir` 로 띄운 앱, e2e)에서만 pty 에 `MARU_ROOM_DB`(userData 아래 `rooms.sqlite`)를 넣는다. 설치본이 띄운 pty 에는 넣지 않으므로, 변수 없이 뜬 pane 도 같은 기본 경로의 방을 쓴다.

방 파일을 만드는 것은 `room new` 뿐이다. 다른 명령과 monitor·hook 은 파일이 없으면 만들지 않는다(monitor 는 디렉토리만 만든다).

- 코드: `room.rs` 의 `db_path`·`open` ↔ `pty.ts` 의 `shellEnv`(`ShellSetup.roomDb`)·`roomDbPath`
- 바꾸면: 설치본에도 `MARU_ROOM_DB` 를 넣으면, 변수가 생기기 전에 뜬 pane 과 새 pane 이 서로 다른 파일을 본다.
- 테스트: `pty.test.ts` › 「방 파일을 받으면 MARU_ROOM_DB 로 넣고, 받지 않으면 물려받은 값도 넘기지 않는다」, 「방 파일은 dev 실행과 --user-data-dir 로 띄운 설치본에서만 userData 아래로 정한다」, `tests/room.rs` › `list_shows_open_rooms_with_their_last_entry_and_members`, `monitor_started_before_any_room_notices_rooms_made_later`, `session_start_without_a_room_file_does_not_make_one`

## 스키마는 더하기만 하고 버전은 `user_version` 이다

파일의 `PRAGMA user_version` 이 스키마 버전이다. 재설치 뒤에도 오래 떠 있는 claude 의 옛 monitor 와 새 빌드의 CLI 가 같은 시각에 같은 파일을 만진다. 그래서 스키마는 열·표를 더하기만 하고, 방·글을 버리는 다시 짜기는 하지 않는다. 옛 빌드가 따를 수 없는 바꿈이 꼭 필요하면 파일 이름을 바꾼다. 이 빌드가 모르는 더 높은 버전을 보면 CLI 는 거절하고(exit 1), monitor 는 room 알림만 멈추고, SessionStart hook 은 파일을 건드리지 않는다.

- 코드: `room.rs` 의 `SCHEMA_VERSION`·`migrate`·`open`(`Opened::Newer`)·`Watch::state`
- 바꾸면: 열의 뜻을 바꾸거나 표를 다시 짜면, 떠 있는 옛 monitor 가 새 CLI 가 쓴 행을 잘못 읽는다.
- 테스트: `tests/room.rs` › `a_newer_schema_is_refused`, `monitor_stops_room_notices_on_a_newer_schema`, `session_start_leaves_a_newer_room_file_alone`

## 기록은 `BEGIN IMMEDIATE` 하나에서 확인하고 더한다

`room post`·`pass` 는 `BEGIN IMMEDIATE` 트랜잭션 하나에서 "참여자인지 → 닫힌 방인지 → `--seen` 이 마지막 번호인지 → AI 연속 상한" 을 보고 기록을 더한다. `room close` 도 트랜잭션 하나에서 닫힘 기록을 더한다. 글쓴이의 읽은 자리와 알린 자리는 그 기록의 번호로 올린다. 거절은 exit code 로 알리고, stderr 에 다음 할 일을 적는다.

| exit | 뜻 |
| --- | --- |
| 4 | `--seen` 이 마지막 번호가 아니다. 그사이 올라온 번호(`#14` 나 `#14~#16`)를 적는다 |
| 5 | 마지막 사람 글 뒤에 AI 글이 이미 3개다. 사람이 글을 올리면 다시 된다 |
| 6 | 닫힌 방이다. `join` 도 같다 |

- 코드: `room.rs` 의 `append`·`ai_streak`·`Refusal` ↔ `main.rs` 의 `main`(Refusal 을 exit code 로)
- 바꾸면: 확인과 저장을 다른 트랜잭션으로 나누면 같은 글을 본 둘이 함께 올라간다.
- 테스트: `tests/room.rs` › `post_with_a_stale_seen_exits_4_and_names_what_came_first`, `posts_on_the_same_seen_at_once_let_only_one_in`, `pass_is_refused_like_a_post`, `ais_stop_after_three_posts_until_the_person_posts`, `a_closed_room_refuses_with_6_and_its_name_can_be_reused`

## 기록을 더한 쪽은 커밋한 뒤 `-notify` 파일을 건드린다

monitor 와 `room chat` 은 방 파일 옆의 `rooms.sqlite-notify` 를 kqueue 로 지켜보고, 바뀌면 방 파일을 다시 읽는다. 방 파일이나 `-notify` 가 아직 없으면 디렉토리를 지켜보다 생긴 뒤에 붙는다.

- 코드: `room.rs` 의 `ring`·`bell_path`·`Watch`
- 바꾸면: 기록을 더하는 새 명령이 `ring` 을 부르지 않으면, 그 기록은 다음 기록이 올 때까지 알려지지 않는다.
- 테스트: `tests/room.rs` › `monitor_notifies_a_post_without_the_app`, `chat_shows_entries_as_they_come_and_posts_lines_as_human`

## monitor 는 자기 pty 의 참여자에게만 `room` 이벤트를 쓴다

monitor 는 자기 `MARU_PTY_ID` 가 알림 받는(`--quiet` 이 아닌) claude 참여자인 방마다, 알린 자리 뒤에 남이 더한 기록을 찾아 한 줄을 쓰고 알린 자리를 올린다. 앱 소켓과 상관없이 돈다. session id 는 보지 않는다. `/clear` 하면 Bash 쪽 `CLAUDE_CODE_SESSION_ID` 는 새 id 가 되지만 monitor 는 다시 뜨지 않기 때문이다.

- 코드: `room.rs` 의 `pending`·`event`·`mark`·`Monitor` ↔ `main.rs` 의 `claude_monitor`(모듈 doc 의 알림 모양)
- 바꾸면: 알린 자리를 쓰기 전에 올리면, 줄을 쓰지 못하고 끝난 monitor 의 알림을 다음 monitor 가 내지 않는다.
- 테스트: `tests/room.rs` › `monitor_notifies_a_post_without_the_app`, `monitor_batches_entries_posted_while_it_was_away`, `monitor_skips_quiet_members_and_other_panes`, `monitor_says_when_it_is_the_last_ai_turn_and_when_turns_are_over`, `monitor_tells_once_that_the_room_closed`, `monitor_writes_room_and_app_notices_and_keeps_room_ones_after_the_app_goes`, `monitor_stops_notices_after_leave`, `rejoining_with_notices_does_not_wake_for_entries_already_read`

## SessionStart hook 은 이 pty 의 지난 세션 참여를 지운다

`maru claude hook` 은 SessionStart 마다 이 pty 의 참여자 가운데 session id 가 지금 것과 다른 행을 지운다. 그래서 `/clear` 하거나 같은 pane 에서 claude 를 새로 띄우면 방에서 나가고, `--resume`·압축처럼 id 가 그대로인 시작은 남는다. 같은 세션을 다른 pane 에서 `--resume` 하면, 같은 이름의 `join` 이 참여를 그 pane 으로 옮긴다. 닫힌 pane 에 남은 참여는 `room leave <방> --as <이름>` 으로 지운다. claude 가 이 hook 을 기다리며 뜨므로 정리는 쓰기 한 번이고, 500ms 넘게 잠겨 있으면 거르고 hook 은 성공으로 끝난다.

- 코드: `room.rs` 의 `forget_other_sessions` ↔ `main.rs` 의 `claude_hook`, `room.rs` 의 `join`(`CLAUDE_CODE_SESSION_ID` 를 적는다)
- 바꾸면: hook 이 지우지 않으면, `/clear` 로 새로 시작한 대화에 지난 대화의 방 알림이 온다.
- 테스트: `tests/room.rs` › `session_start_with_a_new_session_leaves_the_rooms_of_this_pane`, `a_session_resumed_in_another_pane_takes_its_name_back_on_join`, `leave_as_removes_a_member_left_in_another_pane`
