use rusqlite::Connection;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

const A: (&str, &str) = ("p-aaaa0001", "s-a");
const B: (&str, &str) = ("p-bbbb0002", "s-b");
const C: (&str, &str) = ("p-cccc0003", "s-c");
const HUMAN_PTY: &str = "p-0000beef";

struct Rooms {
    dir: tempfile::TempDir,
}

impl Rooms {
    fn new() -> Self {
        let dir = tempfile::Builder::new()
            .prefix("mr")
            .tempdir_in("/tmp")
            .unwrap();
        Rooms { dir }
    }

    fn db(&self) -> PathBuf {
        self.dir.path().join("state").join("rooms.sqlite")
    }

    fn cmd(&self, who: Option<(&str, &str)>, args: &[&str]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_maru"));
        cmd.args(args)
            .env("MARU_ROOM_DB", self.db())
            .env_remove("MARU_SOCKET")
            .env_remove("MARU_PTY_ID")
            .env_remove("CLAUDE_CODE_SESSION_ID")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some((pty, session)) = who {
            cmd.env("MARU_PTY_ID", pty)
                .env("CLAUDE_CODE_SESSION_ID", session);
        }
        cmd
    }

    fn run(&self, who: Option<(&str, &str)>, args: &[&str]) -> Output {
        self.cmd(who, args).output().unwrap()
    }

    fn input(&self, who: Option<(&str, &str)>, args: &[&str], input: &str) -> Output {
        let mut child = self.cmd(who, args).stdin(Stdio::piped()).spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        child.wait_with_output().unwrap()
    }

    fn ok(&self, who: Option<(&str, &str)>, args: &[&str]) -> String {
        let out = self.run(who, args);
        assert!(out.status.success(), "{args:?}: {}", stderr(&out));
        stdout(&out)
    }

    fn post(&self, who: (&str, &str), seen: i64, text: &str) -> Output {
        self.run(
            Some(who),
            &["room", "post", "review", "--seen", &seen.to_string(), text],
        )
    }

    fn open_review(&self, members: &[((&str, &str), &str)]) {
        self.ok(None, &["room", "new", "review", "--topic", "설계 검토"]);
        for (who, name) in members {
            self.ok(Some(*who), &["room", "join", "review", "--as", name]);
        }
    }

    /// `maru room chat` 이 넣는 사람 참여자를 표에 바로 넣는다. chat 은 터미널이 있어야 뜬다.
    fn add_human(&self, room: i64) {
        self.sql(&format!(
            "INSERT INTO participants (room, name, kind, pty, quiet, joined_ms)
             VALUES ({room}, 'human', 'human', '{HUMAN_PTY}', 1, 0)"
        ));
    }

    /// 기록을 더한 명령처럼 알림 파일을 건드린다.
    fn ring(&self) {
        std::fs::write(self.db().with_file_name("rooms.sqlite-notify"), "\n").unwrap();
    }

    fn sql(&self, sql: &str) {
        Connection::open(self.db())
            .unwrap()
            .execute_batch(sql)
            .unwrap();
    }
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

fn refused(out: &Output, code: i32, message: &str) {
    assert_eq!(out.status.code(), Some(code), "{}", stderr(out));
    assert!(out.stdout.is_empty(), "{}", stdout(out));
    assert!(stderr(out).contains(message), "{}", stderr(out));
}

#[test]
fn posts_are_read_once_and_read_ends_with_the_next_seen() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    assert_eq!(stdout(&r.post(A, 0, "첫 글")), "#1\n");
    assert_eq!(stdout(&r.post(B, 1, "둘째 글")), "#2\n");

    let read = r.ok(Some(C), &["room", "read", "review"]);
    assert_eq!(
        read,
        "#1 A  첫 글\n#2 B  둘째 글\n마지막 #2 — 올릴 때 --seen 2\n"
    );
    assert_eq!(
        r.ok(Some(C), &["room", "read", "review"]),
        "새 글이 없다.\n마지막 #2 — 올릴 때 --seen 2\n"
    );
    assert!(
        r.ok(Some(C), &["room", "read", "review", "--all"])
            .starts_with("#1 A  첫 글\n")
    );
    // 자기 글은 읽은 것으로 친다.
    assert_eq!(
        r.ok(Some(A), &["room", "read", "review"]),
        "#2 B  둘째 글\n마지막 #2 — 올릴 때 --seen 2\n"
    );
}

#[test]
fn post_with_a_stale_seen_exits_4_and_names_what_came_first() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, 0, "하나");
    refused(&r.post(B, 0, "늦은 글"), 4, "#1 가 먼저 올라왔다");
    r.post(A, 1, "둘");
    refused(&r.post(B, 0, "늦은 글"), 4, "#1~#2 가 먼저 올라왔다");
    refused(&r.post(B, 9, "앞선 글"), 4, "마지막 번호 #2 보다 크다");
    assert!(
        !r.ok(Some(A), &["room", "read", "review", "--all"])
            .contains("늦은 글")
    );
}

#[test]
fn ais_stop_after_three_posts_until_the_person_posts() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.add_human(1);
    r.post(A, 0, "1");
    r.post(B, 1, "2");
    // pass 는 세지 않는다.
    assert_eq!(
        r.ok(Some(A), &["room", "pass", "review", "--seen", "2"]),
        "#3\n"
    );
    r.post(A, 3, "4");
    refused(&r.post(B, 4, "5"), 5, "AI 차례가 끝났다");
    // 상한에서도 넘길 수는 있다.
    assert_eq!(
        r.ok(Some(B), &["room", "pass", "review", "--seen", "4"]),
        "#5\n"
    );
    let human = (HUMAN_PTY, "");
    assert_eq!(stdout(&r.post(human, 5, "사람 글")), "#6\n");
    assert_eq!(stdout(&r.post(B, 6, "다시")), "#7\n");
}

#[test]
fn pass_is_read_as_a_line_of_its_own() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, 0, "B, 어떻게 보나요?");
    r.ok(Some(B), &["room", "pass", "review", "--seen", "1"]);
    assert_eq!(
        r.ok(Some(A), &["room", "read", "review"]),
        "#2 · B 가 넘겼다\n마지막 #2 — 올릴 때 --seen 2\n"
    );
}

#[test]
fn post_reads_multiline_text_with_quotes_from_stdin() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let text = "첫 줄에 \"따옴표\"\n둘째 줄에 '작은따옴표' 와 $HOME\n";
    let out = r.input(
        Some(A),
        &["room", "post", "review", "--seen", "0", "-"],
        text,
    );
    assert_eq!(stdout(&out), "#1\n", "{}", stderr(&out));
    assert_eq!(
        r.ok(Some(B), &["room", "read", "review"]),
        "#1 A  첫 줄에 \"따옴표\"\n    둘째 줄에 '작은따옴표' 와 $HOME\n마지막 #1 — 올릴 때 --seen 1\n"
    );
}

#[test]
fn a_closed_room_refuses_with_6_and_its_name_can_be_reused() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, 0, "옛 방의 글");
    assert!(r.ok(None, &["room", "close", "review"]).contains("id 1"));
    refused(&r.post(B, 2, "늦음"), 6, "닫혔다");
    refused(
        &r.run(Some(C), &["room", "join", "review", "--as", "C"]),
        6,
        "닫혔다",
    );
    refused(&r.run(None, &["room", "close", "review"]), 6, "이미 닫혔다");
    assert!(r.ok(None, &["room", "list"]).lines().count() == 1);
    assert!(
        r.ok(None, &["room", "list", "--closed"])
            .contains("1\treview\t#2")
    );

    r.ok(None, &["room", "new", "review"]);
    r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
    assert_eq!(
        r.ok(Some(A), &["room", "read", "review"]),
        "새 글이 없다.\n마지막 #0 — 올릴 때 --seen 0\n"
    );
    assert_eq!(
        r.ok(None, &["room", "read", "1", "--all"]),
        "#1 A  옛 방의 글\n#2 · 방이 닫혔다\n방이 닫혔다 (마지막 #2).\n"
    );
    assert_eq!(stdout(&r.post(A, 0, "새 방의 글")), "#1\n");
}

#[test]
fn a_room_name_cannot_be_only_digits_or_taken_by_an_open_room() {
    let r = Rooms::new();
    assert_eq!(r.run(None, &["room", "new", "42"]).status.code(), Some(1));
    r.ok(None, &["room", "new", "review"]);
    let out = r.run(None, &["room", "new", "review"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("이미 있다"), "{}", stderr(&out));
}

#[test]
fn a_pane_rejoins_only_under_its_name() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let out = r.run(Some(A), &["room", "join", "review", "--as", "Z"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr(&out).contains("이미 A 로 들어 있다"),
        "{}",
        stderr(&out)
    );
    let out = r.run(Some(B), &["room", "join", "review", "--as", "A"]);
    assert!(stderr(&out).contains("A 이 이미 있다"), "{}", stderr(&out));

    let new_session = (A.0, "s-a2");
    r.ok(
        Some(new_session),
        &["room", "join", "review", "--as", "A", "--quiet"],
    );
    assert!(r.ok(None, &["room", "list"]).contains("A(알림 안 받음)"));
    let session: String = Connection::open(r.db())
        .unwrap()
        .query_row(
            "SELECT session FROM participants WHERE name = 'A'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(session, "s-a2");
}

#[test]
fn join_needs_a_claude_session_and_prints_the_notice_without_at_signs() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "review", "--topic", "설계 검토"]);
    let mut cmd = r.cmd(Some(A), &["room", "join", "review", "--as", "A"]);
    let out = cmd.env_remove("CLAUDE_CODE_SESSION_ID").output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr(&out).contains("CLAUDE_CODE_SESSION_ID"),
        "{}",
        stderr(&out)
    );

    let notice = r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
    assert!(
        notice.starts_with("방 review 에 A 로 들어왔다.\n주제: 설계 검토\n"),
        "{notice}"
    );
    for part in [
        "maru room read review",
        "maru room post review --seen <번호> - <<'EOF'",
        "maru room pass review --seen <번호>",
        "exit 4",
        "exit 5",
        "exit 6",
        "이름 앞에 기호를 붙이지 않는다",
        "/clear",
    ] {
        assert!(notice.contains(part), "{part}: {notice}");
    }
    assert!(!notice.contains('@'), "{notice}");
    let quiet = r.ok(Some(B), &["room", "join", "review", "--as", "B", "--quiet"]);
    assert!(quiet.contains("너는 알림을 받지 않는다"), "{quiet}");
}

#[test]
fn list_shows_open_rooms_with_their_last_entry_and_members() {
    let r = Rooms::new();
    assert_eq!(
        r.ok(None, &["room", "list"]),
        "ID\tNAME\tLAST\tPARTICIPANTS\tTOPIC\n"
    );
    assert!(!r.db().exists(), "list 가 방 파일을 만들었다");
    r.open_review(&[(A, "A"), (B, "B")]);
    r.add_human(1);
    r.post(A, 0, "x");
    assert_eq!(
        r.ok(None, &["room", "list"]),
        "ID\tNAME\tLAST\tPARTICIPANTS\tTOPIC\n1\treview\t#1\thuman(사람), A, B\t설계 검토\n"
    );
}

#[test]
fn list_prints_control_characters_in_a_topic_as_spaces() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "t", "--topic", "a\tb\nc\x1b[31md"]);
    assert_eq!(
        r.ok(None, &["room", "list"]),
        "ID\tNAME\tLAST\tPARTICIPANTS\tTOPIC\n1\tt\t#0\t(아직 없음)\ta b c [31md\n"
    );
}

#[test]
fn posts_on_the_same_seen_at_once_let_only_one_in() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    let posts: Vec<_> = [A, B, C]
        .map(|who| {
            r.cmd(Some(who), &["room", "post", "review", "--seen", "0", "x"])
                .spawn()
                .unwrap()
        })
        .into();
    let mut codes: Vec<_> = posts
        .into_iter()
        .map(|p| p.wait_with_output().unwrap().status.code())
        .collect();
    codes.sort();
    assert_eq!(codes, [Some(0), Some(4), Some(4)]);
}

#[test]
fn pass_is_refused_like_a_post() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, 0, "하나");
    refused(
        &r.run(Some(B), &["room", "pass", "review", "--seen", "0"]),
        4,
        "#1 가 먼저 올라왔다",
    );
    r.ok(None, &["room", "close", "review"]);
    refused(
        &r.run(Some(B), &["room", "pass", "review", "--seen", "2"]),
        6,
        "닫혔다",
    );
}

#[test]
fn read_from_a_pane_not_in_the_room_moves_no_read_position() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(B, 0, "x");
    let all = "#1 B  x\n마지막 #1 — 올릴 때 --seen 1\n";
    assert_eq!(r.ok(Some(C), &["room", "read", "review"]), all);
    assert_eq!(r.ok(Some(C), &["room", "read", "review"]), all);
    assert_eq!(r.ok(Some(A), &["room", "read", "review"]), all);
}

#[test]
fn leave_is_refused_from_a_pane_not_in_the_room() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let out = r.run(Some(C), &["room", "leave", "review"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("들어 있지 않다"), "{}", stderr(&out));
    r.ok(Some(A), &["room", "leave", "review"]);
    assert_eq!(members(&r), ["B"]);
}

#[test]
fn a_session_resumed_in_another_pane_takes_its_name_back_on_join() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    // 같은 claude 세션(s-a)을 다른 pane 에서 `--resume` 했다.
    let moved = ("p-aaaa0009", A.1);
    let out = r.post(moved, 0, "x");
    assert!(stderr(&out).contains("들어 있지 않다"), "{}", stderr(&out));
    r.ok(Some(moved), &["room", "join", "review", "--as", "A"]);
    let pty: String = Connection::open(r.db())
        .unwrap()
        .query_row("SELECT pty FROM participants WHERE name = 'A'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(pty, moved.0);
    assert!(r.post(moved, 0, "옮긴 pane 에서").status.success());
    assert_eq!(r.post(A, 1, "옛 pane 에서").status.code(), Some(1));
}

#[test]
fn join_under_a_name_held_by_another_session_points_to_leave_as() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let out = r.run(Some(B), &["room", "join", "review", "--as", "A"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr(&out).contains("maru room leave review --as A"),
        "{}",
        stderr(&out)
    );
}

#[test]
fn leave_as_removes_a_member_left_in_another_pane() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    // A 의 pane 은 닫혔다. 방에 들어 있지 않은 pane 에서도 내보낸다.
    let out = r.ok(Some(C), &["room", "leave", "review", "--as", "A"]);
    assert!(out.contains("A 을 내보냈다"), "{out}");
    assert_eq!(members(&r), ["B"]);
    r.ok(Some(C), &["room", "join", "review", "--as", "A"]);
    let out = r.run(Some(C), &["room", "leave", "review", "--as", "Z"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("Z 이 없다"), "{}", stderr(&out));
}

#[test]
fn a_newer_schema_is_refused() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    r.sql("PRAGMA user_version = 2");
    let out = r.post(A, 0, "x");
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr(&out).contains("schema version 2"),
        "{}",
        stderr(&out)
    );
}

#[test]
fn commands_outside_a_pane_say_so() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "review"]);
    let out = r.run(None, &["room", "post", "review", "--seen", "0", "x"]);
    assert!(stderr(&out).contains("MARU_PTY_ID"), "{}", stderr(&out));
    let out = r.run(Some(A), &["room", "post", "review", "--seen", "0", "x"]);
    assert!(stderr(&out).contains("들어 있지 않다"), "{}", stderr(&out));
    let out = r.run(None, &["room", "read", "nope"]);
    assert!(stderr(&out).contains("방 nope 이 없다"), "{}", stderr(&out));
}

// ---- monitor ----

/// `Monitor::start` 가 넘기는 소켓에서 구독을 받는 앱. 떨어뜨리면 구독 연결을 닫는다.
struct FakeApp {
    events: std::sync::mpsc::Sender<Value>,
}

impl FakeApp {
    fn listen(r: &Rooms) -> Self {
        let listener = UnixListener::bind(r.dir.path().join("app.sock")).unwrap();
        let (events, rx) = std::sync::mpsc::channel::<Value>();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(&stream).read_line(&mut line).unwrap();
            let req: Value = serde_json::from_str(&line).unwrap();
            let ok = serde_json::json!({"jsonrpc": "2.0", "id": req["id"], "result": null});
            writeln!(&stream, "{ok}").unwrap();
            for params in rx {
                let ev = serde_json::json!({"jsonrpc": "2.0", "method": "monitor.event", "params": params});
                writeln!(&stream, "{ev}").unwrap();
            }
        });
        FakeApp { events }
    }

    fn send(&self, params: &Value) {
        self.events.send(params.clone()).unwrap();
    }
}

struct Monitor {
    child: Child,
    lines: Receiver<String>,
}

impl Monitor {
    /// 듣는 앱이 없는 소켓 경로로 띄운다. 앱이 없어도 room 알림은 낸다.
    fn start(r: &Rooms, pty: &str) -> Self {
        let mut child = r
            .cmd(None, &["claude", "monitor"])
            .env("MARU_SOCKET", r.dir.path().join("app.sock"))
            .env("MARU_PTY_ID", pty)
            .spawn()
            .unwrap();
        let out = child.stdout.take().unwrap();
        let (tx, lines) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines() {
                if tx.send(line.unwrap()).is_err() {
                    break;
                }
            }
        });
        let m = Monitor { child, lines };
        // kqueue 에 붙을 때까지.
        std::thread::sleep(Duration::from_millis(300));
        m
    }

    fn next(&self) -> Value {
        let line = self
            .lines
            .recv_timeout(Duration::from_secs(10))
            .expect("monitor 가 알리지 않았다");
        serde_json::from_str(&line).unwrap()
    }

    fn quiet_for(&self, d: Duration) {
        match self.lines.recv_timeout(d) {
            Err(RecvTimeoutError::Timeout) => {}
            other => panic!("알림이 없어야 한다: {other:?}"),
        }
    }
}

impl Drop for Monitor {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn monitor_notifies_a_post_without_the_app() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let m = Monitor::start(&r, A.0);
    r.post(B, 0, "A, 어떻게 보나요?");
    assert_eq!(
        m.next(),
        serde_json::json!({
            "event": "room", "room": "review", "seq": 1, "from": "B", "kind": "post",
            "text": "방 review 에 새 글 #1 (보낸 이: B) — maru room read review 로 읽는다."
        })
    );
    // 자기 글은 알리지 않는다.
    r.post(A, 1, "답");
    m.quiet_for(Duration::from_millis(800));
    r.ok(Some(B), &["room", "pass", "review", "--seen", "2"]);
    let ev = m.next();
    assert_eq!(
        (ev["kind"].as_str(), ev["seq"].as_i64()),
        (Some("pass"), Some(3))
    );
    assert!(
        ev["text"].as_str().unwrap().contains("B 가 넘겼다 (#3)"),
        "{ev}"
    );
    assert!(!ev.to_string().contains('@'));
}

#[test]
fn monitor_batches_entries_posted_while_it_was_away() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    r.post(B, 0, "하나");
    r.post(C, 1, "둘");
    let m = Monitor::start(&r, A.0);
    let ev = m.next();
    assert_eq!(
        (
            ev["first"].as_i64(),
            ev["seq"].as_i64(),
            ev["from"].as_str()
        ),
        (Some(1), Some(2), Some("B, C"))
    );
    assert!(
        ev["text"]
            .as_str()
            .unwrap()
            .starts_with("방 review 에 새 기록 #1~#2"),
        "{ev}"
    );
    m.quiet_for(Duration::from_millis(800));
}

#[test]
fn monitor_skips_quiet_members_and_other_panes() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "review"]);
    r.ok(Some(A), &["room", "join", "review", "--as", "A", "--quiet"]);
    r.ok(Some(B), &["room", "join", "review", "--as", "B"]);
    let quiet = Monitor::start(&r, A.0);
    let stranger = Monitor::start(&r, C.0);
    r.post(B, 0, "x");
    quiet.quiet_for(Duration::from_millis(800));
    stranger.quiet_for(Duration::from_millis(100));
}

#[test]
fn monitor_says_when_it_is_the_last_ai_turn_and_when_turns_are_over() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    let m = Monitor::start(&r, A.0);
    r.post(B, 0, "1");
    assert!(!m.next()["text"].as_str().unwrap().contains("마지막 차례"));
    r.post(C, 1, "2");
    assert!(m.next()["text"].as_str().unwrap().ends_with(
        "이번이 AI 의 마지막 차례다 — 다른 AI 를 부르지 말고 사람에게 넘기거나 끝맺는다."
    ));
    r.post(B, 2, "3");
    assert!(
        m.next()["text"]
            .as_str()
            .unwrap()
            .contains("AI 차례가 끝났다")
    );
}

#[test]
fn monitor_stops_notices_after_leave() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let m = Monitor::start(&r, A.0);
    r.ok(Some(A), &["room", "leave", "review"]);
    r.post(B, 0, "x");
    m.quiet_for(Duration::from_millis(800));
}

#[test]
fn rejoining_with_notices_does_not_wake_for_entries_already_read() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "review"]);
    r.ok(Some(A), &["room", "join", "review", "--as", "A", "--quiet"]);
    r.ok(Some(B), &["room", "join", "review", "--as", "B"]);
    r.post(B, 0, "읽은 글");
    r.ok(Some(A), &["room", "read", "review"]);
    r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
    let m = Monitor::start(&r, A.0);
    m.quiet_for(Duration::from_millis(800));
    r.post(B, 1, "새 글");
    let ev = m.next();
    assert_eq!(
        (ev["seq"].as_i64(), ev.get("first")),
        (Some(2), None),
        "{ev}"
    );
}

#[test]
fn monitor_tells_once_that_the_room_closed() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let m = Monitor::start(&r, A.0);
    r.ok(None, &["room", "close", "review"]);
    let ev = m.next();
    assert_eq!(ev["kind"], "close");
    assert_eq!(ev["text"], "방이 닫혔다 (review) — 더 올리지 않는다.");
    m.quiet_for(Duration::from_millis(800));
}

#[test]
fn a_member_who_closes_the_room_is_not_told_by_its_own_monitor() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let closer = Monitor::start(&r, A.0);
    let other = Monitor::start(&r, B.0);
    r.ok(Some(A), &["room", "close", "review"]);
    assert_eq!(other.next()["kind"], "close");
    closer.quiet_for(Duration::from_millis(800));
}

#[test]
fn monitor_batches_a_post_and_the_close_after_it_as_the_close() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(B, 0, "마지막 말");
    r.ok(None, &["room", "close", "review"]);
    let m = Monitor::start(&r, A.0);
    let ev = m.next();
    assert_eq!(
        ev,
        serde_json::json!({
            "event": "room", "room": "review", "first": 1, "seq": 2, "from": "B", "kind": "close",
            "text": "방이 닫혔다 (review) — 더 올리지 않는다."
        })
    );
}

#[test]
fn monitor_started_before_any_room_notices_rooms_made_later() {
    let r = Rooms::new();
    let m = Monitor::start(&r, A.0);
    assert!(!r.db().exists(), "monitor 가 방 파일을 만들었다");
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(B, 0, "x");
    assert_eq!(m.next()["seq"], 1);
}

#[test]
fn monitor_stops_room_notices_on_a_newer_schema() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let app = FakeApp::listen(&r);
    let m = Monitor::start(&r, A.0);
    r.sql("PRAGMA user_version = 2");
    r.sql("INSERT INTO entries (room, seq, author, author_kind, kind, text, at_ms) VALUES (1, 1, 'B', 'claude', 'post', 'x', 0)");
    r.ring();
    m.quiet_for(Duration::from_millis(800));
    // room 알림만 멈추고 앱 알림은 계속 쓴다.
    let inbox = serde_json::json!({"event": "inbox", "from": "p-0000000a", "body": "x"});
    app.send(&inbox);
    assert_eq!(m.next(), inbox);
}

#[test]
fn monitor_writes_room_and_app_notices_and_keeps_room_ones_after_the_app_goes() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let app = FakeApp::listen(&r);
    let m = Monitor::start(&r, A.0);
    let inbox = serde_json::json!({"event": "inbox", "from": "p-0000000a", "body": "x"});
    app.send(&inbox);
    assert_eq!(m.next(), inbox);
    r.post(B, 0, "하나");
    assert_eq!(m.next()["seq"], 1);
    drop(app);
    std::fs::remove_file(r.dir.path().join("app.sock")).unwrap();
    r.post(B, 1, "둘");
    assert_eq!(m.next()["seq"], 2);
}

#[test]
fn monitor_does_not_spin_on_its_own_connection() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let m = Monitor::start(&r, A.0);
    r.post(B, 0, "x");
    m.next();
    let start = cpu_ms(m.child.id());
    std::thread::sleep(Duration::from_secs(1));
    assert!(
        cpu_ms(m.child.id()) - start < 200,
        "monitor 가 쉬지 않고 돈다"
    );
}

fn cpu_ms(pid: u32) -> u64 {
    let out = Command::new("ps")
        .args(["-o", "time=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    // `M:SS.cc`
    let t = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    let (m, s) = t.split_once(':').unwrap();
    (m.parse::<f64>().unwrap() * 60_000.0 + s.parse::<f64>().unwrap() * 1000.0) as u64
}

// ---- SessionStart hook ----

fn hook(r: &Rooms, pty: &str, session: &str) -> Output {
    let mut child = r
        .cmd(None, &["claude", "hook"])
        .env("MARU_SOCKET", r.dir.path().join("app.sock"))
        .env("MARU_PTY_ID", pty)
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let payload = format!(
        r#"{{"hook_event_name":"SessionStart","session_id":"{session}","source":"clear"}}"#
    );
    child
        .stdin
        .take()
        .unwrap()
        .write_all(payload.as_bytes())
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while child.try_wait().unwrap().is_none() {
        assert!(Instant::now() < deadline, "hook 이 끝나지 않았다");
        std::thread::sleep(Duration::from_millis(10));
    }
    child.wait_with_output().unwrap()
}

fn members(r: &Rooms) -> Vec<String> {
    let conn = Connection::open(r.db()).unwrap();
    let mut stmt = conn
        .prepare("SELECT name FROM participants ORDER BY name")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn session_start_with_a_new_session_leaves_the_rooms_of_this_pane() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.ok(None, &["room", "new", "other"]);
    r.ok(Some(A), &["room", "join", "other", "--as", "A"]);
    r.add_human(1);
    // resume·compact 는 같은 id 다.
    let out = hook(&r, A.0, A.1);
    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(members(&r), ["A", "A", "B", "human"]);
    // startup·clear 는 새 id 다. 다른 pane 의 참여는 남는다.
    hook(&r, A.0, "s-a-new");
    assert_eq!(members(&r), ["B", "human"]);
    hook(&r, HUMAN_PTY, "s-h");
    assert_eq!(members(&r), ["B"]);
}

#[test]
fn session_start_without_a_room_file_does_not_make_one() {
    let r = Rooms::new();
    let out = hook(&r, A.0, A.1);
    assert!(out.status.success(), "{}", stderr(&out));
    assert!(stdout(&out).contains("maru room join <room> --as <name>"));
    assert!(!r.db().exists());
}

// ---- chat ----

struct Screen {
    child: Child,
    master: std::fs::File,
    seen: std::sync::Arc<std::sync::Mutex<Vec<u8>>>,
}

impl Screen {
    fn chat(r: &Rooms) -> Self {
        Self::chat_in(r, HUMAN_PTY)
    }

    fn chat_in(r: &Rooms, pty_id: &str) -> Self {
        use nix::pty::{Winsize, openpty};
        let size = Winsize {
            ws_row: 30,
            ws_col: 100,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let pty = openpty(Some(&size), None).unwrap();
        let mut cmd = r.cmd(None, &["room", "chat", "review"]);
        cmd.env("MARU_PTY_ID", pty_id)
            .env("TERM", "xterm-256color")
            .stdin(Stdio::from(pty.slave.try_clone().unwrap()))
            .stdout(Stdio::from(pty.slave.try_clone().unwrap()))
            .stderr(Stdio::from(pty.slave));
        let child = cmd.spawn().unwrap();
        let master = std::fs::File::from(pty.master);
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut reader = master.try_clone().unwrap();
        let sink = seen.clone();
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                sink.lock().unwrap().extend_from_slice(&buf[..n]);
            }
        });
        Screen {
            child,
            master,
            seen,
        }
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.seen.lock().unwrap()).into_owned()
    }

    fn wait_for(&self, what: &str) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !self.text().contains(what) {
            assert!(
                Instant::now() < deadline,
                "{what:?} 가 화면에 없다: {:?}",
                self.text()
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// 지금까지 찍힌 것을 비운다. 다음 `wait_for` 는 그 뒤에 찍힌 것만 본다.
    fn clear(&self) {
        self.seen.lock().unwrap().clear();
    }

    fn type_text(&mut self, text: &str) {
        self.master.write_all(text.as_bytes()).unwrap();
    }
}

impl Drop for Screen {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn chat_shows_entries_as_they_come_and_posts_lines_as_human() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, 0, "먼저 온 글");
    let mut s = Screen::chat(&r);
    s.wait_for("먼저 온 글");
    s.wait_for("나> ");

    r.post(B, 1, "새로 온 글");
    s.wait_for("새로 온 글");

    s.type_text("A, 어떻게 보나요?\r");
    s.wait_for("#3");
    assert_eq!(
        r.ok(Some(C), &["room", "read", "review", "--all"]),
        "#1 A  먼저 온 글\n#2 B  새로 온 글\n#3 human  A, 어떻게 보나요?\n마지막 #3 — 올릴 때 --seen 3\n"
    );

    s.type_text("\x04");
    let deadline = Instant::now() + Duration::from_secs(10);
    while s.child.try_wait().unwrap().is_none() {
        assert!(Instant::now() < deadline, "Ctrl-D 로 끝나지 않았다");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(s.child.wait().unwrap().success());
}

#[test]
fn chat_puts_the_line_back_when_an_entry_came_first() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let mut s = Screen::chat(&r);
    s.wait_for("나> ");
    // 화면이 모르는 글을 알림 없이 넣는다.
    r.sql("INSERT INTO entries (room, seq, author, author_kind, kind, text, at_ms) VALUES (1, 1, 'A', 'claude', 'post', '몰래 온 글', 0)");
    s.clear();
    s.type_text("늦은 생각\r");
    s.wait_for("새 글이 먼저 올라왔다");
    s.wait_for("늦은 생각");
    // 알림이 오면 그 글을 찍고, Enter 로 다시 올린다.
    r.ring();
    s.wait_for("몰래 온 글");
    s.type_text("\r");
    s.wait_for("#2");
    assert!(
        r.ok(Some(A), &["room", "read", "review"])
            .contains("#2 human  늦은 생각"),
    );
}

#[test]
fn chat_posts_lines_typed_before_its_own_entry_shows() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let mut s = Screen::chat(&r);
    s.wait_for("나> ");
    // 줄마다 자기 글이 찍히기 전에 다음 줄의 Enter 가 온다.
    let lines: Vec<String> = (1..=6).map(|n| format!("줄{n}")).collect();
    for l in &lines {
        s.type_text(&format!("{l}\r"));
        std::thread::sleep(Duration::from_millis(2));
    }
    let want: String = lines
        .iter()
        .enumerate()
        .map(|(i, l)| format!("#{} human  {l}\n", i + 1))
        .collect();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let all = r.ok(None, &["room", "read", "review", "--all"]);
        if all.starts_with(&want) {
            break;
        }
        assert!(Instant::now() < deadline, "{all}\n화면: {:?}", s.text());
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!s.text().contains("새 글이 먼저"), "{:?}", s.text());
}

#[test]
fn chat_prints_control_characters_in_entries_as_spaces() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    r.post(A, 0, "\x1b]7501;x\x07빨강\x1b[31m끝\n둘째 줄");
    let s = Screen::chat(&r);
    s.wait_for(" ]7501;x 빨강 [31m끝");
    s.wait_for("둘째 줄");
    let text = s.text();
    assert!(
        !text.contains("\x1b]7501") && !text.contains("\x1b[31m"),
        "{text:?}"
    );
}

#[test]
fn chat_moves_the_person_to_this_pane() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    r.add_human(1);
    let s = Screen::chat_in(&r, "p-0000cafe");
    s.wait_for("나> ");
    let pty: String = Connection::open(r.db())
        .unwrap()
        .query_row(
            "SELECT pty FROM participants WHERE name = 'human'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pty, "p-0000cafe");
}

#[test]
fn chat_is_refused_in_a_pane_that_joined_as_claude() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let mut s = Screen::chat_in(&r, A.0);
    s.wait_for("이 pane 은 방 review 에 A 로 들어 있다");
    assert_eq!(s.child.wait().unwrap().code(), Some(1));
}

#[test]
fn chat_into_a_closed_room_exits_6() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    r.ok(None, &["room", "close", "review"]);
    let mut s = Screen::chat(&r);
    s.wait_for("닫혔다");
    let deadline = Instant::now() + Duration::from_secs(10);
    let status = loop {
        if let Some(status) = s.child.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "닫힌 방에서 chat 이 끝나지 않았다"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(status.code(), Some(6));
}

#[test]
fn chat_outside_a_terminal_says_so() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let mut cmd = r.cmd(None, &["room", "chat", "review"]);
    let out = cmd.env("MARU_PTY_ID", HUMAN_PTY).output().unwrap();
    assert_eq!(out.status.code(), Some(1), "{}", stderr(&out));
    assert!(
        stderr(&out).contains("터미널에서 띄운다"),
        "{}",
        stderr(&out)
    );
}

#[test]
fn session_start_leaves_a_newer_room_file_alone() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    r.sql("PRAGMA user_version = 2");
    let out = hook(&r, A.0, "s-a-new");
    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(members(&r), ["A"]);
}

#[test]
fn monitor_writes_nothing_at_start_when_nothing_is_new() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, 0, "자기 글");
    let m = Monitor::start(&r, A.0);
    m.quiet_for(Duration::from_millis(800));
}
