use rusqlite::Connection;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

const A: &str = "p-aaaa0001";
const B: &str = "p-bbbb0002";
const C: &str = "p-cccc0003";

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

    fn cmd(&self, who: Option<&str>, args: &[&str]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_maru"));
        cmd.args(args)
            .env("MARU_ROOM_DB", self.db())
            .env_remove("MARU_SOCKET")
            .env_remove("MARU_PTY_ID")
            .env_remove("CLAUDE_CODE_SESSION_ID")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(pty) = who {
            cmd.env("MARU_PTY_ID", pty);
        }
        cmd
    }

    fn run(&self, who: Option<&str>, args: &[&str]) -> Output {
        self.cmd(who, args).output().unwrap()
    }

    fn input(&self, who: Option<&str>, args: &[&str], input: &str) -> Output {
        let mut child = self.cmd(who, args).stdin(Stdio::piped()).spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        child.wait_with_output().unwrap()
    }

    fn ok(&self, who: Option<&str>, args: &[&str]) -> String {
        let out = self.run(who, args);
        assert!(out.status.success(), "{args:?}: {}", stderr(&out));
        stdout(&out)
    }

    /// 이 pane 에서 join 한 claude 로 올린다.
    fn post(&self, who: &str, text: &str) -> Output {
        self.run(Some(who), &["room", "post", "review", text])
    }

    /// 사람 `name` 으로 올린다. 사람은 pane 밖에서도 올린다.
    fn say(&self, name: &str, text: &str) -> Output {
        self.run(None, &["room", "post", "review", "--as", name, text])
    }

    fn open_review(&self, members: &[(&str, &str)]) {
        self.ok(None, &["room", "new", "review", "--topic", "설계 검토"]);
        for (who, name) in members {
            self.ok(Some(*who), &["room", "join", "review", "--as", name]);
        }
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

/// 거절 메시지가 `message` 하나뿐이다 — 까닭 뒤에 다음에 칠 명령이 붙지 않는다.
fn refused_exactly(out: &Output, code: i32, message: &str) {
    refused(out, code, message);
    assert_eq!(stderr(out), format!("maru: {message}\n"));
}

#[test]
fn posts_are_read_once_and_read_all_shows_them_again() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    assert_eq!(stdout(&r.post(A, "첫 글")), "#1\n");
    assert_eq!(stdout(&r.post(B, "둘째 글")), "#2\n");

    assert_eq!(
        r.ok(Some(C), &["room", "read", "review"]),
        "#1 A  첫 글\n#2 B  둘째 글\n"
    );
    assert_eq!(
        r.ok(Some(C), &["room", "read", "review"]),
        "새 글이 없다.\n"
    );
    assert!(
        r.ok(Some(C), &["room", "read", "review", "--all"])
            .starts_with("#1 A  첫 글\n")
    );
    // 자기 글은 읽은 것으로 친다.
    assert_eq!(
        r.ok(Some(A), &["room", "read", "review"]),
        "#2 B  둘째 글\n"
    );
}

#[test]
fn a_post_over_unread_entries_leaves_them_for_the_next_read() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, "하나");
    // B 는 #1 을 읽지 않고 올렸다.
    r.post(B, "둘");
    assert_eq!(
        r.ok(Some(B), &["room", "read", "review"]),
        "#1 A  하나\n#2 B  둘\n"
    );
    r.post(B, "셋");
    assert_eq!(
        r.ok(Some(B), &["room", "read", "review"]),
        "새 글이 없다.\n"
    );
}

#[test]
fn ais_stop_after_three_posts_until_a_person_posts() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, "1");
    r.post(B, "2");
    r.post(A, "3");
    // 사람 글이 아직 없으면 방이 열린 뒤의 AI 글을 센다.
    refused_exactly(
        &r.post(B, "4"),
        5,
        "사람 글 없이 이어진 AI 글 3개로 상한에 닿았다 — 사람이 올릴 때까지 AI 글은 거절된다.",
    );
    // 나감은 세지 않고 상한을 풀지도 않는다.
    r.ok(Some(C), &["room", "join", "review", "--as", "C"]);
    r.ok(Some(C), &["room", "leave", "review"]);
    refused(&r.post(B, "4"), 5, "AI 글 3개로 상한에 닿았다");
    // 사람은 상한을 보지 않고, 사람의 글이 상한을 푼다.
    assert_eq!(stdout(&r.say("가나", "사람 글")), "#5\n");
    assert_eq!(stdout(&r.post(B, "다시")), "#6\n");
    r.post(A, "8");
    r.post(B, "9");
    refused(&r.post(A, "10"), 5, "AI 글 3개로 상한에 닿았다");
    // claude 의 pane 에서 `--as` 로 올린 글도 사람의 글이다.
    let out = r.run(
        Some(A),
        &["room", "post", "review", "--as", "가나", "A 의 pane 에서"],
    );
    assert_eq!(stdout(&out), "#9\n", "{}", stderr(&out));
    assert_eq!(stdout(&r.post(A, "다시")), "#10\n");
}

#[test]
fn a_person_is_added_on_the_first_post_and_reads_from_its_own_place() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, "하나");
    // 올리기 전에는 참여자가 아니므로 읽은 자리를 남기지 않는다.
    let all = "#1 A  하나\n";
    assert_eq!(r.ok(None, &["room", "read", "review", "--as", "가나"]), all);
    assert_eq!(r.ok(None, &["room", "read", "review", "--as", "가나"]), all);
    assert_eq!(members(&r), ["A", "B"]);

    r.say("가나", "둘");
    r.say("민준", "셋");
    assert_eq!(
        r.ok(None, &["room", "list"]),
        "ID\tNAME\tLAST\tAI_LIMIT\tPARTICIPANTS\tTOPIC\n1\treview\t#3\t3\t가나(사람), 민준(사람), A, B\t설계 검토\n"
    );
    assert_eq!(
        r.ok(None, &["room", "read", "review", "--as", "가나"]),
        "#1 A  하나\n#2 가나(사람)  둘\n#3 민준(사람)  셋\n"
    );
    r.post(B, "넷");
    assert_eq!(
        r.ok(None, &["room", "read", "review", "--as", "가나"]),
        "#4 B  넷\n"
    );
    // 다른 사람의 읽은 자리는 따로다.
    assert_eq!(
        r.ok(None, &["room", "read", "review", "--as", "민준"]),
        "#1 A  하나\n#2 가나(사람)  둘\n#3 민준(사람)  셋\n#4 B  넷\n"
    );
}

#[test]
fn a_room_sets_its_own_ai_limit_and_0_is_none() {
    let r = Rooms::new();
    let out = r.ok(None, &["room", "new", "one", "--ai-limit", "1"]);
    assert!(
        out == "방 one 를 열었다 (id 1, 사람 글 없이 이어지는 AI 글 1개까지).\n\
                claude 세션은 maru room join one --as <이름> 으로 들어온다.\n\
                사람은 join 없이 maru room post one --as <이름> <글> 로 올린다.\n",
        "{out}"
    );
    let out = r.ok(None, &["room", "new", "free", "--ai-limit", "0"]);
    assert!(
        out.starts_with("방 free 를 열었다 (id 2, AI 연속 상한 없음).\n"),
        "{out}"
    );
    let list = r.ok(None, &["room", "list"]);
    assert!(list.contains("1\tone\t#0\t1\t"), "{list}");
    assert!(list.contains("2\tfree\t#0\t0\t"), "{list}");

    let notice = r.ok(Some(A), &["room", "join", "one", "--as", "A"]);
    assert!(notice.contains("AI 글은 1개까지"), "{notice}");
    r.ok(Some(B), &["room", "join", "one", "--as", "B"]);
    let m = Monitor::start(&r, B);
    r.run(Some(A), &["room", "post", "one", "1"]);
    assert!(m.next()["text"].as_str().unwrap().contains("상한에 닿았다"));
    refused(
        &r.run(Some(B), &["room", "post", "one", "2"]),
        5,
        "AI 글 1개로 상한에 닿았다",
    );

    // 상한이 없는 방은 상한도 exit 5 도 적지 않는다.
    let notice = r.ok(Some(A), &["room", "join", "free", "--as", "A"]);
    assert!(
        !notice.contains("개까지") && !notice.contains("exit 5"),
        "{notice}"
    );
    assert!(
        notice.ends_with("\n\n닫힌 방이면 post 가 exit 6 으로 거절한다.\n"),
        "{notice}"
    );
    r.ok(Some(B), &["room", "join", "free", "--as", "B"]);
    // B 의 monitor 는 A 의 글만 받는다. 다섯 번째 AI 글에도 상한 문장이 붙지 않는다.
    for i in 0..5 {
        let who = if i % 2 == 0 { A } else { B };
        let out = r.run(Some(who), &["room", "post", "free", "x"]);
        assert!(out.status.success(), "{}", stderr(&out));
        if who == A {
            let text = m.next()["text"].as_str().unwrap().to_owned();
            assert!(!text.contains("상한"), "{text}");
        }
    }
}

#[test]
fn a_person_s_post_and_leave_are_told_with_the_ai_limit() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "one", "--ai-limit", "1"]);
    r.ok(Some(A), &["room", "join", "one", "--as", "A"]);
    r.ok(Some(B), &["room", "join", "one", "--as", "B"]);
    let m = Monitor::start(&r, B);
    r.ok(None, &["room", "post", "one", "--as", "민준", "시작"]);
    let text = m.next()["text"].as_str().unwrap().to_owned();
    assert!(
        text.ends_with("사람 글 없이 이어진 AI 글 0개 — 상한 1개까지 하나 남았다."),
        "{text}"
    );
    r.ok(Some(A), &["room", "post", "one", "1"]);
    let text = m.next()["text"].as_str().unwrap().to_owned();
    assert!(text.contains("상한에 닿았다"), "{text}");
    r.ok(None, &["room", "leave", "one", "--as", "민준"]);
    let ev = m.next();
    assert_eq!(ev["kind"], "leave");
    let text = ev["text"].as_str().unwrap();
    assert!(
        text.contains("나갔다") && text.contains("상한에 닿았다"),
        "{text}"
    );
    refused(
        &r.run(Some(B), &["room", "post", "one", "2"]),
        5,
        "AI 글 1개로 상한에 닿았다",
    );
}

#[test]
fn read_and_the_topic_show_control_characters_as_spaces() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "review", "--topic", "x\x1b[2Jy"]);
    let notice = r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
    assert!(notice.contains("주제: x [2Jy\n"), "{notice}");
    r.post(A, "hi\x1b]0;title\x07 there\n다음 줄");
    assert_eq!(
        r.ok(None, &["room", "read", "review", "--as", "가나"]),
        "#1 A  hi ]0;title  there\n    다음 줄\n"
    );
}

#[test]
fn ai_limit_takes_only_a_count() {
    let r = Rooms::new();
    for bad in ["-1", "x"] {
        let out = r.run(None, &["room", "new", "one", "--ai-limit", bad]);
        assert_eq!(out.status.code(), Some(1), "{}", stderr(&out));
    }
    assert!(!r.db().exists());
}

#[test]
fn as_with_a_claude_members_name_is_refused() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    for args in [
        &["room", "post", "review", "--as", "A", "x"][..],
        &["room", "read", "review", "--as", "A"],
        &["room", "close", "review", "--as", "A"],
    ] {
        let out = r.run(None, args);
        refused_exactly(&out, 1, "방 review 의 A 는 claude 참여자다");
    }
    // 사람의 이름으로 join 하지도 못한다.
    r.say("가나", "x");
    let out = r.run(Some(B), &["room", "join", "review", "--as", "가나"]);
    refused(&out, 1, "가나(사람) 가 이미 있다");
    let out = r.say("a b", "x");
    refused(&out, 1, "--as 는");
}

#[test]
fn post_reads_multiline_text_with_quotes_from_stdin() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let text = "첫 줄에 \"따옴표\"\n둘째 줄에 '작은따옴표' 와 $HOME\n";
    let out = r.input(Some(A), &["room", "post", "review", "-"], text);
    assert_eq!(stdout(&out), "#1\n", "{}", stderr(&out));
    assert_eq!(
        r.ok(Some(B), &["room", "read", "review"]),
        "#1 A  첫 줄에 \"따옴표\"\n    둘째 줄에 '작은따옴표' 와 $HOME\n"
    );
}

#[test]
fn a_closed_room_refuses_with_6_and_its_name_can_be_reused() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, "옛 방의 글");
    assert!(r.ok(None, &["room", "close", "review"]).contains("id 1"));
    refused_exactly(&r.post(B, "늦음"), 6, "방 review 는 닫혔다.");
    refused(&r.say("가나", "늦음"), 6, "닫혔다");
    // 거절된 첫 글은 사람을 참여자로 남기지 않는다.
    assert_eq!(members(&r), ["A", "B"]);
    refused(
        &r.run(Some(C), &["room", "join", "review", "--as", "C"]),
        6,
        "닫혔다",
    );
    refused_exactly(
        &r.run(None, &["room", "close", "review"]),
        6,
        "방 review 는 이미 닫혔다 (id 1).",
    );
    assert!(r.ok(None, &["room", "list"]).lines().count() == 1);
    assert!(
        r.ok(None, &["room", "list", "--closed"])
            .contains("1\treview\t#2")
    );

    r.ok(None, &["room", "new", "review"]);
    r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
    assert_eq!(
        r.ok(Some(A), &["room", "read", "review"]),
        "새 글이 없다.\n"
    );
    assert_eq!(
        r.ok(None, &["room", "read", "1", "--all"]),
        "#1 A  옛 방의 글\n#2 · 방이 닫혔다\n방이 닫혔다 (마지막 #2).\n"
    );
    assert_eq!(stdout(&r.post(A, "새 방의 글")), "#1\n");
}

#[test]
fn the_close_entry_names_who_closed_the_room() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    r.ok(Some(A), &["room", "close", "review"]);
    r.ok(None, &["room", "new", "review"]);
    // 사람은 올린 적이 없어도 `--as` 로 닫는다.
    r.ok(None, &["room", "close", "review", "--as", "가나"]);
    assert_eq!(
        r.ok(None, &["room", "read", "1", "--all"]),
        "#1 · A 가 방을 닫았다\n방이 닫혔다 (마지막 #1).\n"
    );
    assert_eq!(
        r.ok(None, &["room", "read", "2", "--all"]),
        "#1 · 가나(사람) 가 방을 닫았다\n방이 닫혔다 (마지막 #1).\n"
    );
}

#[test]
fn a_room_name_cannot_be_only_digits_or_taken_by_an_open_room() {
    let r = Rooms::new();
    assert_eq!(r.run(None, &["room", "new", "42"]).status.code(), Some(1));
    r.ok(None, &["room", "new", "review"]);
    let out = r.run(None, &["room", "new", "review"]);
    refused_exactly(&out, 1, "열린 방 review 가 이미 있다");
}

#[test]
fn a_pane_rejoins_only_under_its_name() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let out = r.run(Some(A), &["room", "join", "review", "--as", "Z"]);
    refused_exactly(&out, 1, "이 pane 은 방 review 에 이미 A 로 들어 있다");
    let out = r.run(Some(B), &["room", "join", "review", "--as", "A"]);
    refused_exactly(&out, 1, "방 review 에 A 가 이미 있다");
    r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
}

#[test]
fn join_prints_the_notice_without_at_signs() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "review", "--topic", "설계 검토"]);
    let notice = r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
    assert!(
        notice.starts_with("방 review 에 A 로 들어왔다.\n주제: 설계 검토\n"),
        "{notice}"
    );
    for part in [
        "참여자: A\n",
        "{\"event\":\"room\",\"room\":\"review\",…}",
        "- maru room read review — ",
        "- maru room post review <글> — ",
        "- maru room leave review — ",
        "사람 글 없이 이어지는 AI 글은 3개까지 올라간다. 넘는 글은 post 가 exit 5 로 거절한다.",
        "exit 6",
    ] {
        assert!(notice.contains(part), "{part}: {notice}");
    }
    // room.rs 모듈 doc 의 "사실과 명령만" 을 지킨다.
    for gone in [
        "@",
        "--seen",
        "pass",
        "이 터미널",
        "/clear",
        "기다린다",
        "턴을",
        "차례",
    ] {
        assert!(!notice.contains(gone), "{gone}: {notice}");
    }
    // 참여자 이름은 한글도 받는다. 조사는 이름의 끝소리를 따른다.
    let notice = r.ok(Some(B), &["room", "join", "review", "--as", "민준"]);
    assert!(
        notice.starts_with("방 review 에 민준 으로 들어왔다.\n"),
        "{notice}"
    );
}

#[test]
fn list_shows_open_rooms_with_their_last_entry_and_members() {
    let r = Rooms::new();
    assert_eq!(
        r.ok(None, &["room", "list"]),
        "ID\tNAME\tLAST\tAI_LIMIT\tPARTICIPANTS\tTOPIC\n"
    );
    assert!(!r.db().exists(), "list 가 방 파일을 만들었다");
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, "x");
    assert_eq!(
        r.ok(None, &["room", "list"]),
        "ID\tNAME\tLAST\tAI_LIMIT\tPARTICIPANTS\tTOPIC\n1\treview\t#1\t3\tA, B\t설계 검토\n"
    );
}

#[test]
fn list_prints_control_characters_in_a_topic_as_spaces() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "t", "--topic", "a\tb\nc\x1b[31md"]);
    assert_eq!(
        r.ok(None, &["room", "list"]),
        "ID\tNAME\tLAST\tAI_LIMIT\tPARTICIPANTS\tTOPIC\n1\tt\t#0\t3\t(없음)\ta b c [31md\n"
    );
}

#[test]
fn posts_at_once_each_get_their_own_number() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    let posts: Vec<_> = [A, B, C]
        .map(|who| {
            r.cmd(Some(who), &["room", "post", "review", "x"])
                .spawn()
                .unwrap()
        })
        .into();
    let mut seqs: Vec<_> = posts
        .into_iter()
        .map(|p| stdout(&p.wait_with_output().unwrap()))
        .collect();
    seqs.sort();
    assert_eq!(seqs, ["#1\n", "#2\n", "#3\n"]);
}

#[test]
fn read_from_a_pane_not_in_the_room_moves_no_read_position() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(B, "x");
    let all = "#1 B  x\n";
    assert_eq!(r.ok(Some(C), &["room", "read", "review"]), all);
    assert_eq!(r.ok(Some(C), &["room", "read", "review"]), all);
    assert_eq!(r.ok(Some(A), &["room", "read", "review"]), all);
}

#[test]
fn leave_is_refused_from_a_pane_not_in_the_room() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let out = r.run(Some(C), &["room", "leave", "review"]);
    refused(&out, 1, "들어 있지 않다");
    r.ok(Some(A), &["room", "leave", "review"]);
    assert_eq!(members(&r), ["B"]);
}

#[test]
fn leaving_is_an_entry_of_the_room() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    r.say("가나", "x");
    assert_eq!(
        r.ok(Some(A), &["room", "leave", "review"]),
        "방 review 에서 나왔다.\n"
    );
    let out = r.ok(Some(B), &["room", "leave", "review", "--as", "가나"]);
    assert_eq!(out, "방 review 에서 가나(사람) 를 내보냈다.\n");
    assert_eq!(
        r.ok(Some(C), &["room", "read", "review"]),
        "#1 가나(사람)  x\n#2 · A 가 나갔다\n#3 · 가나(사람) 가 나갔다\n"
    );
    // 닫힌 방에서 나가는 것은 기록하지 않는다.
    r.ok(None, &["room", "close", "review"]);
    r.ok(Some(C), &["room", "leave", "review"]);
    assert!(
        r.ok(None, &["room", "read", "1", "--all"])
            .ends_with("#4 · 방이 닫혔다\n방이 닫혔다 (마지막 #4).\n")
    );
}

#[test]
fn another_pane_takes_a_name_only_after_leave_as() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let moved = "p-aaaa0009";
    refused(&r.post(moved, "x"), 1, "들어 있지 않다");
    refused_exactly(
        &r.run(Some(moved), &["room", "join", "review", "--as", "A"]),
        1,
        "방 review 에 A 가 이미 있다",
    );
    r.ok(Some(moved), &["room", "leave", "review", "--as", "A"]);
    r.ok(Some(moved), &["room", "join", "review", "--as", "A"]);
    assert!(r.post(moved, "옮긴 pane 에서").status.success());
    assert_eq!(r.post(A, "옛 pane 에서").status.code(), Some(1));
}

#[test]
fn leave_as_removes_a_member_left_in_another_pane() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    // A 의 pane 은 닫혔다. 방에 들어 있지 않은 pane 에서도 내보낸다.
    let out = r.ok(Some(C), &["room", "leave", "review", "--as", "A"]);
    assert!(out.contains("A 를 내보냈다"), "{out}");
    assert_eq!(members(&r), ["B"]);
    r.ok(Some(C), &["room", "join", "review", "--as", "A"]);
    let out = r.run(Some(C), &["room", "leave", "review", "--as", "Z"]);
    refused(&out, 1, "Z 가 없다");
}

#[test]
fn a_newer_schema_is_refused() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    r.sql("PRAGMA user_version = 2");
    let out = r.post(A, "x");
    refused(&out, 1, "schema version 2");
}

#[test]
fn commands_outside_a_pane_say_so() {
    let r = Rooms::new();
    r.ok(None, &["room", "new", "review"]);
    let out = r.run(None, &["room", "post", "review", "x"]);
    refused(&out, 1, "MARU_PTY_ID");
    let out = r.post(A, "x");
    refused(&out, 1, "들어 있지 않다");
    // room.rs 모듈 doc 의 "거절한 까닭만" 을 지킨다.
    assert!(!stderr(&out).contains("maru room"), "{}", stderr(&out));
    let out = r.run(None, &["room", "read", "nope"]);
    refused_exactly(&out, 1, "방 nope 가 없다");
}

// ---- monitor ----

/// `Monitor::start` 가 넘기는 소켓에서 구독을 받는 앱. drop 하면 구독 연결을 닫는다.
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
    let m = Monitor::start(&r, A);
    r.post(B, "A, 어떻게 보나요?");
    assert_eq!(
        m.next(),
        serde_json::json!({
            "event": "room", "room": "review", "seq": 1, "from": "B", "kind": "post",
            "text": "방 review 에 새 글 #1 (보낸 이: B) — maru room read review 로 읽는다."
        })
    );
    // 자기 글은 알리지 않는다.
    r.post(A, "답");
    m.quiet_for(Duration::from_millis(800));
    r.post(B, "x");
    assert!(!m.next().to_string().contains('@'));
}

#[test]
fn monitor_notifies_a_persons_post_with_the_person_mark() {
    let r = Rooms::new();
    r.open_review(&[(A, "A")]);
    let m = Monitor::start(&r, A);
    r.say("가나", "A, 봐 줘");
    assert_eq!(
        m.next(),
        serde_json::json!({
            "event": "room", "room": "review", "seq": 1, "from": "가나", "kind": "post",
            "text": "방 review 에 새 글 #1 (보낸 이: 가나(사람)) — maru room read review 로 읽는다."
        })
    );
}

#[test]
fn monitor_notifies_who_left() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let m = Monitor::start(&r, A);
    r.ok(Some(B), &["room", "leave", "review"]);
    assert_eq!(
        m.next(),
        serde_json::json!({
            "event": "room", "room": "review", "seq": 1, "from": "B", "kind": "leave",
            "text": "방 review 에서 B 가 나갔다 (#1) — maru room read review 로 읽는다."
        })
    );
}

#[test]
fn monitor_batches_entries_posted_while_it_was_away() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    r.post(B, "하나");
    r.say("가나", "둘");
    let m = Monitor::start(&r, A);
    let ev = m.next();
    assert_eq!(
        (
            ev["first"].as_i64(),
            ev["seq"].as_i64(),
            ev["from"].as_str()
        ),
        (Some(1), Some(2), Some("B, 가나"))
    );
    assert!(
        ev["text"]
            .as_str()
            .unwrap()
            .starts_with("방 review 에 새 기록 #1~#2 (보낸 이: B, 가나(사람))"),
        "{ev}"
    );
    m.quiet_for(Duration::from_millis(800));
}

#[test]
fn monitor_skips_other_panes() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let stranger = Monitor::start(&r, C);
    r.post(B, "x");
    stranger.quiet_for(Duration::from_millis(800));
}

#[test]
fn monitor_says_when_one_ai_post_is_left_and_when_the_limit_is_reached() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B"), (C, "C")]);
    let m = Monitor::start(&r, A);
    r.post(B, "1");
    assert_eq!(
        m.next()["text"],
        "방 review 에 새 글 #1 (보낸 이: B) — maru room read review 로 읽는다."
    );
    r.post(C, "2");
    assert_eq!(
        m.next()["text"],
        "방 review 에 새 글 #2 (보낸 이: C) — maru room read review 로 읽는다. 사람 글 없이 이어진 AI 글 2개 — 상한 3개까지 하나 남았다."
    );
    r.post(B, "3");
    assert_eq!(
        m.next()["text"],
        "방 review 에 새 글 #3 (보낸 이: B) — maru room read review 로 읽는다. 사람 글 없이 이어진 AI 글 3개로 상한에 닿았다 — 사람이 올릴 때까지 AI 글은 거절된다."
    );
    r.say("가나", "계속");
    let text = m.next()["text"].as_str().unwrap().to_owned();
    assert!(!text.contains("상한"), "{text}");
}

#[test]
fn monitor_stops_notices_after_leave() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let m = Monitor::start(&r, A);
    r.ok(Some(A), &["room", "leave", "review"]);
    r.post(B, "x");
    m.quiet_for(Duration::from_millis(800));
}

#[test]
fn rejoining_does_not_wake_for_entries_already_read() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(B, "읽은 글");
    r.ok(Some(A), &["room", "read", "review"]);
    r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
    let m = Monitor::start(&r, A);
    m.quiet_for(Duration::from_millis(800));
    r.post(B, "새 글");
    let ev = m.next();
    assert_eq!(
        (ev["seq"].as_i64(), ev.get("first")),
        (Some(2), None),
        "{ev}"
    );
}

#[test]
fn monitor_tells_once_that_the_room_closed_and_who_closed_it() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let m = Monitor::start(&r, A);
    r.ok(None, &["room", "close", "review"]);
    let ev = m.next();
    assert_eq!(ev["kind"], "close");
    assert_eq!(ev["text"], "방이 닫혔다 (review).");
    m.quiet_for(Duration::from_millis(800));

    r.ok(None, &["room", "new", "review"]);
    r.ok(Some(A), &["room", "join", "review", "--as", "A"]);
    r.ok(Some(B), &["room", "join", "review", "--as", "B"]);
    r.ok(Some(B), &["room", "close", "review"]);
    assert_eq!(
        m.next(),
        serde_json::json!({
            "event": "room", "room": "review", "seq": 1, "from": "B", "kind": "close",
            "text": "방이 닫혔다 (review, 닫은 이: B)."
        })
    );
}

#[test]
fn a_member_who_closes_the_room_is_not_told_by_its_own_monitor() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let closer = Monitor::start(&r, A);
    let other = Monitor::start(&r, B);
    r.ok(Some(A), &["room", "close", "review"]);
    assert_eq!(other.next()["kind"], "close");
    closer.quiet_for(Duration::from_millis(800));
}

#[test]
fn monitor_batches_a_post_and_the_close_after_it_as_the_close() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(B, "마지막 말");
    r.ok(None, &["room", "close", "review", "--as", "가나"]);
    let m = Monitor::start(&r, A);
    let ev = m.next();
    assert_eq!(
        ev,
        serde_json::json!({
            "event": "room", "room": "review", "first": 1, "seq": 2, "from": "B, 가나", "kind": "close",
            "text": "방이 닫혔다 (review, 닫은 이: 가나(사람))."
        })
    );
}

#[test]
fn monitor_started_before_any_room_notices_rooms_made_later() {
    let r = Rooms::new();
    let m = Monitor::start(&r, A);
    assert!(!r.db().exists(), "monitor 가 방 파일을 만들었다");
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(B, "x");
    assert_eq!(m.next()["seq"], 1);
}

#[test]
fn monitor_stops_room_notices_on_a_newer_schema() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let app = FakeApp::listen(&r);
    let m = Monitor::start(&r, A);
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
    let m = Monitor::start(&r, A);
    let inbox = serde_json::json!({"event": "inbox", "from": "p-0000000a", "body": "x"});
    app.send(&inbox);
    assert_eq!(m.next(), inbox);
    r.post(B, "하나");
    assert_eq!(m.next()["seq"], 1);
    drop(app);
    std::fs::remove_file(r.dir.path().join("app.sock")).unwrap();
    r.post(B, "둘");
    assert_eq!(m.next()["seq"], 2);
}

#[test]
fn monitor_does_not_spin_on_its_own_connection() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    let m = Monitor::start(&r, A);
    r.post(B, "x");
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

#[test]
fn monitor_writes_nothing_at_start_when_nothing_is_new() {
    let r = Rooms::new();
    r.open_review(&[(A, "A"), (B, "B")]);
    r.post(A, "자기 글");
    let m = Monitor::start(&r, A);
    m.quiet_for(Duration::from_millis(800));
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
fn session_start_leaves_rooms_alone() {
    let r = Rooms::new();
    let out = hook(&r, A, "s-a");
    assert!(out.status.success(), "{}", stderr(&out));
    assert!(!stdout(&out).contains("room"), "{}", stdout(&out));
    assert!(!r.db().exists());

    r.open_review(&[(A, "A"), (B, "B")]);
    r.say("가나", "x");
    let out = hook(&r, A, "s-a-new");
    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(members(&r), ["A", "B", "가나"]);
    assert_eq!(
        r.ok(None, &["room", "read", "review", "--all"]),
        "#1 가나(사람)  x\n"
    );
}
