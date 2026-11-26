use rusqlite::Connection;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

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

    fn cmd(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_maru"));
        cmd.arg("room")
            .args(args)
            .env("MARU_ROOM_DB", self.db())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }

    fn run(&self, args: &[&str]) -> Output {
        self.cmd(args).output().unwrap()
    }

    fn input(&self, args: &[&str], input: &str) -> Output {
        let mut child = self.cmd(args).stdin(Stdio::piped()).spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        child.wait_with_output().unwrap()
    }

    fn ok(&self, args: &[&str]) -> String {
        let out = self.run(args);
        assert!(out.status.success(), "{args:?}: {}", stderr(&out));
        assert!(out.stderr.is_empty(), "{args:?}: {}", stderr(&out));
        stdout(&out)
    }

    fn post(&self, name: &str, text: &str) -> Output {
        self.run(&["post", "review", "--as", name, text])
    }

    fn read(&self, name: &str) -> String {
        self.ok(&["read", "review", "--as", name])
    }

    fn open_review(&self, members: &[&str]) {
        assert_eq!(self.ok(&["new", "review", "--topic", "설계 검토"]), "1\n");
        for name in members {
            assert_eq!(self.ok(&["join", "review", "--as", name]), "");
        }
    }

    fn sql(&self, sql: &str) {
        Connection::open(self.db())
            .unwrap()
            .execute_batch(sql)
            .unwrap();
    }

    fn members(&self, room: i64) -> Vec<String> {
        let conn = Connection::open(self.db()).unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM participants WHERE room = ?1 ORDER BY rowid")
            .unwrap();
        stmt.query_map([room], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
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
    assert_eq!(stderr(out), format!("maru: {message}\n"));
}

#[test]
fn entries_are_read_once_and_read_all_shows_them_again() {
    let r = Rooms::new();
    r.open_review(&["A", "B", "C"]);
    assert_eq!(stdout(&r.post("A", "첫 글")), "1\n");
    assert_eq!(stdout(&r.post("B", "둘째 글")), "2\n");

    assert_eq!(r.read("C"), "1\tA\tpost\t첫 글\n2\tB\tpost\t둘째 글\n");
    assert_eq!(r.read("C"), "");
    assert_eq!(
        r.ok(&["read", "review", "--as", "C", "--all"]),
        "1\tA\tpost\t첫 글\n2\tB\tpost\t둘째 글\n"
    );
    // 자기 글은 읽은 것으로 친다.
    assert_eq!(r.read("A"), "2\tB\tpost\t둘째 글\n");
}

#[test]
fn a_member_who_joins_late_reads_the_entries_before_it() {
    let r = Rooms::new();
    r.open_review(&["A"]);
    r.post("A", "x");
    r.ok(&["join", "review", "--as", "B"]);
    assert_eq!(r.read("B"), "1\tA\tpost\tx\n");
}

#[test]
fn a_post_over_unread_entries_leaves_them_for_the_next_read() {
    let r = Rooms::new();
    r.open_review(&["A", "B"]);
    r.post("A", "하나");
    r.post("B", "둘");
    assert_eq!(r.read("B"), "1\tA\tpost\t하나\n2\tB\tpost\t둘\n");
    r.post("B", "셋");
    assert_eq!(r.read("B"), "");
}

#[test]
fn a_multiline_body_from_stdin_is_one_line_with_backslash_escapes() {
    let r = Rooms::new();
    r.open_review(&["A", "B"]);
    let text = "첫 줄에 \"따옴표\"\n\t둘째 줄에 'a\\nb' 와 $HOME\n";
    let out = r.input(&["post", "review", "--as", "A", "-"], text);
    assert_eq!(stdout(&out), "1\n", "{}", stderr(&out));
    let out = r.input(&["post", "review", "--as", "A"], "인자 없이\n");
    assert_eq!(stdout(&out), "2\n", "{}", stderr(&out));
    assert_eq!(
        r.read("B"),
        "1\tA\tpost\t첫 줄에 \"따옴표\"\\n\\t둘째 줄에 'a\\\\nb' 와 $HOME\n2\tA\tpost\t인자 없이\n"
    );
}

#[test]
fn control_characters_in_a_body_and_a_topic_are_spaces() {
    let r = Rooms::new();
    r.ok(&["new", "t", "--topic", "a\tb\nc\x1b[31md"]);
    r.ok(&["join", "t", "--as", "A"]);
    r.ok(&["post", "t", "--as", "A", "x\x1b]0;title\x07y"]);
    assert_eq!(
        r.ok(&["read", "t", "--as", "A", "--all"]),
        "1\tA\tpost\tx ]0;title y\n"
    );
    assert_eq!(
        r.ok(&["list"]),
        "ID\tNAME\tLAST\tMEMBERS\tTOPIC\n1\tt\t1\tA\ta b c [31md\n"
    );
}

#[test]
fn an_empty_post_is_refused() {
    let r = Rooms::new();
    r.open_review(&["A"]);
    refused(&r.post("A", " \n"), 1, "the text is empty");
    assert_eq!(r.ok(&["read", "review", "--as", "A", "--all"]), "");
}

#[test]
fn a_closed_room_refuses_writes_with_6_and_its_name_can_be_reused() {
    let r = Rooms::new();
    r.open_review(&["A", "B"]);
    r.post("A", "옛 방의 글");
    assert_eq!(r.ok(&["close", "review", "--as", "B"]), "");
    let closed = "room review is closed (id 1)";
    refused(&r.post("A", "늦음"), 6, closed);
    refused(&r.run(&["join", "review", "--as", "C"]), 6, closed);
    refused(&r.run(&["leave", "review", "--as", "A"]), 6, closed);
    refused(&r.run(&["close", "review", "--as", "A"]), 6, closed);
    assert_eq!(r.members(1), ["A", "B"]);
    assert_eq!(r.read("A"), "2\tB\tclose\t\n");
    assert_eq!(r.read("A"), "");

    assert_eq!(r.ok(&["list"]), "ID\tNAME\tLAST\tMEMBERS\tTOPIC\n");
    assert_eq!(
        r.ok(&["list", "--closed"]),
        "ID\tNAME\tLAST\tMEMBERS\tTOPIC\n1\treview\t2\tA, B\t설계 검토\n"
    );

    assert_eq!(r.ok(&["new", "review"]), "2\n");
    r.ok(&["join", "review", "--as", "A"]);
    assert_eq!(r.read("A"), "");
    assert_eq!(stdout(&r.post("A", "새 방의 글")), "1\n");
    assert_eq!(
        r.ok(&["read", "1", "--as", "A", "--all"]),
        "1\tA\tpost\t옛 방의 글\n2\tB\tclose\t\n"
    );
}

#[test]
fn a_room_name_reads_the_last_closed_room_once_none_is_open() {
    let r = Rooms::new();
    for id in ["1", "2"] {
        assert_eq!(r.ok(&["new", "review"]), format!("{id}\n"));
        r.ok(&["join", "review", "--as", "A"]);
        r.post("A", id);
        r.ok(&["close", "review", "--as", "A"]);
    }
    assert_eq!(
        r.ok(&["read", "review", "--as", "A", "--all"]),
        "1\tA\tpost\t2\n2\tA\tclose\t\n"
    );
}

#[test]
fn a_room_name_cannot_be_only_digits_or_taken_by_an_open_room() {
    let r = Rooms::new();
    let long = "a".repeat(33);
    for bad in ["42", "a b", "방", "", &long] {
        let out = r.run(&["new", bad]);
        assert_eq!(out.status.code(), Some(1), "{bad:?}: {}", stderr(&out));
    }
    assert!(!r.db().exists(), "거절된 new 가 방 파일을 만들었다");
    assert_eq!(r.ok(&["new", &"a".repeat(32)]), "1\n");
    r.ok(&["new", "review"]);
    refused(
        &r.run(&["new", "review"]),
        1,
        "an open room review already exists",
    );
}

#[test]
fn a_name_joins_a_room_once() {
    let r = Rooms::new();
    r.open_review(&["A"]);
    refused(
        &r.run(&["join", "review", "--as", "A"]),
        1,
        "A is already in room review",
    );
    r.ok(&["new", "other"]);
    r.ok(&["join", "other", "--as", "A"]);
}

#[test]
fn a_bad_member_name_is_refused() {
    let r = Rooms::new();
    r.open_review(&[]);
    let long = "가".repeat(33);
    for bad in ["a b", "a(b)", "", &long] {
        let out = r.run(&["join", "review", "--as", bad]);
        assert_eq!(out.status.code(), Some(1), "{bad:?}: {}", stderr(&out));
    }
    assert!(r.members(1).is_empty());
}

#[test]
fn leave_takes_out_any_member_and_is_an_entry() {
    let r = Rooms::new();
    r.open_review(&["A", "B", "C"]);
    r.post("A", "x");
    assert_eq!(r.ok(&["leave", "review", "--as", "A"]), "");
    assert_eq!(r.members(1), ["B", "C"]);
    assert_eq!(r.read("C"), "1\tA\tpost\tx\n2\tA\tleave\t\n");
    refused(&r.post("A", "y"), 1, "A is not in room review");
    refused(
        &r.run(&["leave", "review", "--as", "Z"]),
        1,
        "Z is not in room review",
    );
    r.ok(&["join", "review", "--as", "A"]);
    assert_eq!(r.members(1), ["B", "C", "A"]);
    assert_eq!(
        r.read("A"),
        "1\tA\tpost\tx\n2\tA\tleave\t\n",
        "다시 들어온 이름의 읽은 자리는 0 이다"
    );
}

#[test]
fn a_room_id_names_an_open_room_for_writes_too() {
    let r = Rooms::new();
    r.open_review(&["A"]);
    r.ok(&["join", "1", "--as", "B"]);
    assert_eq!(stdout(&r.run(&["post", "1", "--as", "B", "x"])), "1\n");
    assert_eq!(r.ok(&["read", "1", "--as", "A"]), "1\tB\tpost\tx\n");
    r.ok(&["leave", "1", "--as", "B"]);
    r.ok(&["close", "1", "--as", "A"]);
    assert_eq!(r.ok(&["list", "--closed"]).lines().count(), 2);
}

#[test]
fn a_name_not_in_the_room_cannot_post_read_or_close() {
    let r = Rooms::new();
    r.open_review(&["A"]);
    r.post("A", "x");
    let not_in = "Z is not in room review";
    refused(&r.post("Z", "y"), 1, not_in);
    refused(&r.run(&["read", "review", "--as", "Z"]), 1, not_in);
    refused(&r.run(&["read", "review", "--as", "Z", "--all"]), 1, not_in);
    refused(&r.run(&["close", "review", "--as", "Z"]), 1, not_in);
    assert_eq!(
        r.ok(&["list"]).lines().nth(1),
        Some("1\treview\t1\tA\t설계 검토")
    );
}

#[test]
fn a_missing_room_is_refused_without_making_the_file() {
    let r = Rooms::new();
    for args in [
        &["join", "review", "--as", "A"][..],
        &["post", "review", "--as", "A", "x"],
        &["read", "review", "--as", "A"],
        &["close", "review", "--as", "A"],
        &["leave", "review", "--as", "A"],
    ] {
        refused(&r.run(args), 1, "no room review");
    }
    assert!(!r.db().exists(), "방 파일이 생겼다");
    r.ok(&["new", "other"]);
    refused(&r.run(&["read", "7", "--as", "A"]), 1, "no room 7");
}

#[test]
fn every_command_that_names_a_member_needs_as() {
    let r = Rooms::new();
    r.open_review(&["A"]);
    for args in [
        &["join", "review"][..],
        &["leave", "review"],
        &["post", "review", "x"],
        &["read", "review"],
        &["close", "review"],
    ] {
        let out = r.run(args);
        assert_eq!(out.status.code(), Some(1), "{args:?}: {}", stderr(&out));
        assert!(stderr(&out).contains("--as <NAME>"), "{}", stderr(&out));
    }
}

#[test]
fn list_shows_rooms_with_their_last_entry_and_members() {
    let r = Rooms::new();
    assert_eq!(r.ok(&["list"]), "ID\tNAME\tLAST\tMEMBERS\tTOPIC\n");
    assert!(!r.db().exists(), "list 가 방 파일을 만들었다");
    r.open_review(&["B", "A"]);
    r.ok(&["new", "empty"]);
    r.post("A", "x");
    assert_eq!(
        r.ok(&["list"]),
        "ID\tNAME\tLAST\tMEMBERS\tTOPIC\n1\treview\t1\tB, A\t설계 검토\n2\tempty\t0\t\t\n"
    );
}

#[test]
fn posts_at_once_each_get_their_own_number() {
    let r = Rooms::new();
    r.open_review(&["A", "B", "C"]);
    let posts: Vec<_> = ["A", "B", "C"]
        .map(|name| {
            r.cmd(&["post", "review", "--as", name, "x"])
                .spawn()
                .unwrap()
        })
        .into();
    let mut seqs: Vec<_> = posts
        .into_iter()
        .map(|p| stdout(&p.wait_with_output().unwrap()))
        .collect();
    seqs.sort();
    assert_eq!(seqs, ["1\n", "2\n", "3\n"]);
}

#[test]
fn rooms_made_at_once_on_a_new_file_all_open() {
    for _ in 0..20 {
        let r = Rooms::new();
        let children: Vec<_> = (0..8)
            .map(|i| r.cmd(&["new", &format!("r{i}")]).spawn().unwrap())
            .collect();
        for child in children {
            let out = child.wait_with_output().unwrap();
            assert!(out.status.success(), "{}", stderr(&out));
        }
        assert_eq!(r.ok(&["list"]).lines().count(), 9);
    }
}

#[test]
fn the_room_file_is_only_for_this_user() {
    use std::os::unix::fs::PermissionsExt;
    let r = Rooms::new();
    r.ok(&["new", "review"]);
    let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&r.db()), 0o600);
    assert_eq!(mode(r.db().parent().unwrap()), 0o700);
}

#[test]
fn a_newer_schema_with_added_columns_is_used_as_is() {
    let r = Rooms::new();
    r.open_review(&["A"]);
    r.sql(
        "ALTER TABLE rooms ADD COLUMN owner TEXT;
         ALTER TABLE participants ADD COLUMN kind TEXT NOT NULL DEFAULT 'human';
         ALTER TABLE entries ADD COLUMN reply_to INTEGER;
         CREATE TABLE reactions (room INTEGER, seq INTEGER, name TEXT);
         PRAGMA user_version = 2;",
    );
    assert_eq!(r.ok(&["new", "other"]), "2\n");
    r.ok(&["join", "review", "--as", "B"]);
    assert_eq!(stdout(&r.post("A", "x")), "1\n");
    assert_eq!(r.read("B"), "1\tA\tpost\tx\n");
    r.ok(&["leave", "review", "--as", "B"]);
    r.ok(&["close", "review", "--as", "A"]);
    assert_eq!(
        r.ok(&["list"]),
        "ID\tNAME\tLAST\tMEMBERS\tTOPIC\n2\tother\t0\t\t\n"
    );
    let version: i64 = Connection::open(r.db())
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 2, "옛 빌드가 버전을 낮췄다");
}
