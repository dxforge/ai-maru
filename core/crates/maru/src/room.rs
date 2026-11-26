//! `maru room` — 이름 붙은 방에 참여자가 기록을 남기고 읽는다. 계약은 `docs/contracts/room.md` 에 있다.

use crate::Refusal;
use anyhow::{Context, Result, anyhow, bail};
use clap::Subcommand;
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 파일의 `PRAGMA user_version`. 올릴 때는 열·표를 더하기만 하고, 더하는 열은 DEFAULT 를 두거나 NULL 을 받게 한다(`docs/contracts/room.md` 의 「스키마는 더하기만 하고 버전은 `user_version` 이다」).
const SCHEMA_VERSION: i64 = 1;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const FILE: &str = "rooms.sqlite";
const MAX_MEMBER_NAME_CHARS: usize = 32;

const EXIT_CLOSED: u8 = 6;

#[derive(Subcommand)]
pub enum RoomCommand {
    /// Open a room and print its id. Fails if an open room already has this name.
    New {
        room: String,
        #[arg(long)]
        topic: Option<String>,
    },
    /// Join a room as NAME.
    Join {
        room: String,
        /// The member's name: 1–32 letters, digits and `_.+-`.
        #[arg(long = "as", value_name = "NAME")]
        name: String,
    },
    /// Take NAME out of a room. Any member's name is accepted.
    Leave {
        room: String,
        #[arg(long = "as", value_name = "NAME")]
        name: String,
    },
    /// Print the entries since NAME last read, or all of them with --all, one per line.
    ///
    /// ROOM is a room's name or its id from `maru room list`. A name with no open room reads the
    /// last closed room of that name, and an id reads a closed room too. Each line is the entry's number, author, kind (post, leave or close) and text, separated by
    /// tabs.
    Read {
        room: String,
        #[arg(long = "as", value_name = "NAME")]
        name: String,
        #[arg(long)]
        all: bool,
    },
    /// Post TEXT (or stdin, with `-` or no TEXT) as NAME and print the entry's number.
    Post {
        room: String,
        #[arg(long = "as", value_name = "NAME")]
        name: String,
        text: Option<String>,
    },
    /// List open rooms with their last entry number and members.
    List {
        /// List closed rooms instead.
        #[arg(long)]
        closed: bool,
    },
    /// Close a room as NAME. Its entries stay and `maru room read <id> --as NAME --all` reads them.
    Close {
        room: String,
        #[arg(long = "as", value_name = "NAME")]
        name: String,
    },
}

pub fn run(command: RoomCommand) -> Result<()> {
    let path = db_path()?;
    match command {
        RoomCommand::New { room, topic } => {
            let id = new(&path, &room, topic.as_deref().unwrap_or(""))?;
            crate::write_stdout(&format!("{id}\n"))
        }
        RoomCommand::Join { room, name } => join(&path, &room, &name),
        RoomCommand::Leave { room, name } => leave(&path, &room, &name),
        RoomCommand::Read { room, name, all } => {
            crate::write_stdout(&read(&path, &room, &name, all)?)
        }
        RoomCommand::Post { room, name, text } => {
            let text = match text.filter(|t| t != "-") {
                Some(t) => t,
                None => crate::read_stdin(
                    "give TEXT or pipe it into stdin, e.g. `maru room post review --as me - <<'EOF'`",
                )?,
            };
            let seq = post(&path, &room, &name, text.trim_end())?;
            crate::write_stdout(&format!("{seq}\n"))
        }
        RoomCommand::List { closed } => list(&path, closed),
        RoomCommand::Close { room, name } => close(&path, &room, &name),
    }
}

fn db_path() -> Result<PathBuf> {
    if let Some(path) = crate::env_var("MARU_ROOM_DB") {
        return Ok(path.into());
    }
    let home = crate::env_var("HOME").ok_or_else(|| anyhow!("HOME is not set"))?;
    Ok(Path::new(&home).join(".ai-maru").join(FILE))
}

fn open(path: &Path) -> Result<Option<Connection>> {
    if !path.exists() {
        return Ok(None);
    }
    let mut flags = OpenFlags::default();
    flags.remove(OpenFlags::SQLITE_OPEN_CREATE);
    prepare(Connection::open_with_flags(path, flags), path).map(Some)
}

/// 방 파일을 열고, 없으면 만든다. `room new` 만 부른다. 다른 명령이 부르면 경로를 잘못 준 명령이 빈 방 파일을 남긴다.
fn create(path: &Path) -> Result<Connection> {
    if let Some(dir) = path.parent() {
        make_dir(dir).with_context(|| format!("cannot create {}", dir.display()))?;
    }
    // 방의 글은 이 사용자만 읽는다. sqlite 는 -wal·-shm 을 이 파일의 권한으로 만들므로, WAL 로 바꾸기 전에
    // 권한을 정한다.
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .open(path)
        .and_then(|_| std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)))
        .with_context(|| format!("cannot create {}", path.display()))?;
    prepare(Connection::open(path), path)
}

fn prepare(conn: rusqlite::Result<Connection>, path: &Path) -> Result<Connection> {
    let mut conn = conn.with_context(|| format!("cannot open {}", path.display()))?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    // 더 높은 버전은 새 빌드가 열·표를 더한 파일이다. 아는 열만 쓰고 읽으며 버전은 낮추지 않는다.
    if user_version(&conn)? < SCHEMA_VERSION {
        migrate(&mut conn)?;
    }
    Ok(conn)
}

/// 쓰는 명령의 확인과 저장은 이 트랜잭션 하나에서 한다(`docs/contracts/room.md` 의 「기록은 `BEGIN IMMEDIATE` 하나에서 확인하고 더한다」).
fn in_room<T>(
    path: &Path,
    arg: &str,
    writing: bool,
    f: impl FnOnce(&Connection, &Room) -> Result<T>,
) -> Result<T> {
    let mut conn = open(path)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    if writing && room.closed {
        return Err(Refusal {
            code: EXIT_CLOSED,
            message: format!("room {} is closed (id {})", room.name, room.id),
        }
        .into());
    }
    let out = f(&tx, &room)?;
    tx.commit()?;
    Ok(out)
}

fn make_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
}

fn user_version(conn: &Connection) -> Result<i64> {
    Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

fn migrate(conn: &mut Connection) -> Result<()> {
    // sqlite 는 트랜잭션 안에서 journal_mode 를 WAL 로 바꾸지 않으므로 트랜잭션 밖에서 바꾼다. WAL 은 파일에 남아 다음 연결도 따른다.
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // 다른 프로세스가 먼저 만들었을 수 있다.
    if user_version(&tx)? == 0 {
        tx.execute_batch(
            "CREATE TABLE rooms (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                topic TEXT NOT NULL DEFAULT '',
                created_ms INTEGER NOT NULL,
                closed_ms INTEGER
            );
            CREATE UNIQUE INDEX rooms_open_name ON rooms(name) WHERE closed_ms IS NULL;
            CREATE TABLE participants (
                room INTEGER NOT NULL,
                name TEXT NOT NULL,
                read_seq INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (room, name)
            );
            CREATE TABLE entries (
                room INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                author TEXT NOT NULL,
                kind TEXT NOT NULL,
                text TEXT NOT NULL DEFAULT '',
                at_ms INTEGER NOT NULL,
                PRIMARY KEY (room, seq)
            );
            PRAGMA user_version = 1;",
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn is_id(arg: &str) -> bool {
    !arg.is_empty() && arg.bytes().all(|b| b.is_ascii_digit())
}

fn is_member_name(name: &str) -> bool {
    let n = name.chars().count();
    (1..=MAX_MEMBER_NAME_CHARS).contains(&n)
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || "_.+-".contains(c))
}

struct Room {
    id: i64,
    name: String,
    topic: String,
    closed: bool,
}

const ROOM_COLS: &str = "SELECT id, name, topic, closed_ms FROM rooms";

fn room_row(r: &rusqlite::Row) -> rusqlite::Result<Room> {
    Ok(Room {
        id: r.get(0)?,
        name: r.get(1)?,
        topic: r.get(2)?,
        closed: r.get::<_, Option<i64>>(3)?.is_some(),
    })
}

/// 숫자면 방 id, 아니면 그 이름의 열린 방, 없으면 그 이름으로 마지막에 닫힌 방이다.
fn find_room(conn: &Connection, arg: &str) -> Result<Room> {
    let tail = if is_id(arg) {
        "WHERE id = ?1"
    } else {
        "WHERE name = ?1 ORDER BY closed_ms IS NOT NULL, id DESC LIMIT 1"
    };
    let found = conn
        .query_row(&format!("{ROOM_COLS} {tail}"), [arg], room_row)
        .optional()?;
    found.ok_or_else(|| no_room(arg))
}

fn no_room(arg: &str) -> anyhow::Error {
    anyhow!("no room {arg}")
}

fn last_seq(conn: &Connection, room: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM entries WHERE room = ?1",
        [room],
        |r| r.get(0),
    )?)
}

/// 참여자 `name` 이 읽은 자리. 참여자가 아니면 거절한다.
fn member(conn: &Connection, room: &Room, name: &str) -> Result<i64> {
    conn.query_row(
        "SELECT read_seq FROM participants WHERE room = ?1 AND name = ?2",
        params![room.id, name],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| not_in(room, name))
}

fn not_in(room: &Room, name: &str) -> anyhow::Error {
    anyhow!("{name} is not in room {}", room.name)
}

fn mark_read(conn: &Connection, room: i64, name: &str, seq: i64) -> Result<()> {
    conn.execute(
        "UPDATE participants SET read_seq = ?3 WHERE room = ?1 AND name = ?2",
        params![room, name, seq],
    )?;
    Ok(())
}

fn members(conn: &Connection, room: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM participants WHERE room = ?1 ORDER BY rowid")?;
    let names = stmt
        .query_map([room], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(names)
}

fn new(path: &Path, name: &str, topic: &str) -> Result<i64> {
    if !crate::is_name(name) || is_id(name) {
        bail!(
            "a room name must be 1 to {} letters, digits, `_`, `.`, `+` or `-`, not only digits (got {name:?})",
            crate::MAX_NAME_BYTES
        );
    }
    let mut conn = create(path)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let open: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM rooms WHERE name = ?1 AND closed_ms IS NULL)",
        [name],
        |r| r.get(0),
    )?;
    if open {
        bail!("an open room {name} already exists");
    }
    tx.execute(
        "INSERT INTO rooms (name, topic, created_ms) VALUES (?1, ?2, ?3)",
        params![name, topic, now_ms()],
    )?;
    let id = tx.last_insert_rowid();
    tx.commit()?;
    Ok(id)
}

fn join(path: &Path, arg: &str, name: &str) -> Result<()> {
    if !is_member_name(name) {
        bail!("--as is 1–{MAX_MEMBER_NAME_CHARS} letters, digits and `_.+-` (got {name:?})");
    }
    in_room(path, arg, true, |tx, room| {
        let added = tx.execute(
            "INSERT OR IGNORE INTO participants (room, name) VALUES (?1, ?2)",
            params![room.id, name],
        )?;
        if added == 0 {
            bail!("{name} is already in room {}", room.name);
        }
        Ok(())
    })
}

fn leave(path: &Path, arg: &str, name: &str) -> Result<()> {
    in_room(path, arg, true, |tx, room| {
        let removed = tx.execute(
            "DELETE FROM participants WHERE room = ?1 AND name = ?2",
            params![room.id, name],
        )?;
        if removed == 0 {
            return Err(not_in(room, name));
        }
        add_entry(tx, room.id, name, Kind::Leave, "")?;
        Ok(())
    })
}

#[derive(Clone, Copy)]
enum Kind {
    Post,
    /// 나감도 기록 하나로 남긴다. 남은 참여자가 누가 나갔는지 읽어야 하기 때문이다.
    Leave,
    Close,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Post => "post",
            Kind::Leave => "leave",
            Kind::Close => "close",
        }
    }
}

fn add_entry(tx: &Connection, room: i64, author: &str, kind: Kind, text: &str) -> Result<i64> {
    let seq = last_seq(tx, room)? + 1;
    tx.execute(
        "INSERT INTO entries (room, seq, author, kind, text, at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![room, seq, author, kind.as_str(), text, now_ms()],
    )?;
    Ok(seq)
}

fn post(path: &Path, arg: &str, name: &str, text: &str) -> Result<i64> {
    if text.trim().is_empty() {
        bail!("the text is empty");
    }
    in_room(path, arg, true, |tx, room| {
        let read = member(tx, room, name)?;
        let seq = add_entry(tx, room.id, name, Kind::Post, text)?;
        // 자기 글은 읽은 것으로 친다. 읽지 않은 기록이 남았으면 읽은 자리를 그대로 두어 다음 `read` 가 그
        // 기록들을 보이게 한다.
        if read == seq - 1 {
            mark_read(tx, room.id, name, seq)?;
        }
        Ok(seq)
    })
}

/// 본문의 모양은 `docs/contracts/room.md` 의 「출력은 데이터다」를 따른다.
fn escaped(text: &str) -> String {
    crate::tsv_field(
        &text
            .replace("\r\n", "\n")
            .replace('\\', "\\\\")
            .replace('\n', "\\n")
            .replace('\t', "\\t"),
    )
}

fn read(path: &Path, arg: &str, name: &str, all: bool) -> Result<String> {
    in_room(path, arg, false, |tx, room| {
        let read = member(tx, room, name)?;
        let mut stmt = tx.prepare(
            "SELECT seq, author, kind, text FROM entries WHERE room = ?1 AND seq > ?2 ORDER BY seq",
        )?;
        let mut rows = stmt.query(params![room.id, if all { 0 } else { read }])?;
        let mut out = String::new();
        let mut last = read;
        while let Some(r) = rows.next()? {
            let (seq, author, kind, text): (i64, String, String, String) =
                (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?);
            out.push_str(&format!("{seq}\t{author}\t{kind}\t{}\n", escaped(&text)));
            last = last.max(seq);
        }
        if last > read {
            mark_read(tx, room.id, name, last)?;
        }
        Ok(out)
    })
}

fn list(path: &Path, closed: bool) -> Result<()> {
    let header = "ID\tNAME\tLAST\tMEMBERS\tTOPIC";
    let Some(conn) = open(path)? else {
        return crate::print_tsv::<5>(header, Vec::new());
    };
    let mut stmt = conn.prepare(&format!(
        "{ROOM_COLS} WHERE closed_ms IS {} NULL ORDER BY id",
        if closed { "NOT" } else { "" }
    ))?;
    let rooms = stmt
        .query_map([], room_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut rows = Vec::new();
    for room in rooms {
        let row = [
            room.id.to_string(),
            room.name,
            last_seq(&conn, room.id)?.to_string(),
            members(&conn, room.id)?.join(", "),
            room.topic,
        ];
        rows.push(row.map(|v| crate::tsv_field(&v)));
    }
    crate::print_tsv(header, rows)
}

fn close(path: &Path, arg: &str, name: &str) -> Result<()> {
    in_room(path, arg, true, |tx, room| {
        member(tx, room, name)?;
        add_entry(tx, room.id, name, Kind::Close, "")?;
        tx.execute(
            "UPDATE rooms SET closed_ms = ?2 WHERE id = ?1",
            params![room.id, now_ms()],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::{create, escaped, is_member_name};

    #[test]
    fn member_names_take_letters_of_any_script_but_no_spaces_or_symbols() {
        assert!(is_member_name("가나"));
        assert!(is_member_name("reviewer-2"));
        assert!(is_member_name(&"가".repeat(32)));
        assert!(!is_member_name(&"가".repeat(33)));
        for bad in ["", "a b", "a(b)", "a@b", "a,b", "a\tb", "a\u{1b}b"] {
            assert!(!is_member_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_body_is_one_line_with_backslash_escapes_and_no_control_characters() {
        assert_eq!(escaped("a\nb\tc\\n"), "a\\nb\\tc\\\\n");
        assert_eq!(escaped("x\r\ny"), "x\\ny");
        assert_eq!(escaped("hi\x1b]0;t\x07 there"), "hi ]0;t  there");
        assert_eq!(escaped("a\u{9b}2Jb"), "a 2Jb");
    }

    #[test]
    fn the_wal_files_are_only_for_this_user_from_the_first_new() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rooms.sqlite");
        let conn = create(&path).unwrap();
        for suffix in ["", "-wal", "-shm"] {
            let file = format!("{}{suffix}", path.display());
            let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "{file}");
        }
        drop(conn);
    }
}
