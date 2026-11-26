//! `maru room` — 사람과 claude 세션 여럿의 대화방. 계약은 `docs/contracts/room.md` 에 있다.
//!
//! 알림·안내문·거절 메시지에는 `@` 를 넣지 않는다. Claude Code 가 `@` 뒤를 파일·agent 참조로 읽기 때문이다.
//!
//! 안내문·알림·거절 메시지는 방의 사실(기록, 참여자, 주제, 상한)과 쓰는 명령만 적는다. claude 가 방을
//! 어떻게 쓸지(차례, 기다림, 분량, 말투)는 적지 않는다. 거절 메시지는 거절한 까닭만 적고, 다음에 칠 명령을
//! 권하지 않는다.

use anyhow::{Context, Result, anyhow, bail};
use clap::Subcommand;
use nix::sys::event::{EventFilter, FilterFlag, Kqueue};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OpenFlags, OptionalExtension, ToSql, TransactionBehavior, params};
use serde_json::{Value, json};
use std::fs::File;
use std::io::Write;
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 파일의 `PRAGMA user_version`. 스키마는 더하기만 하므로, 이보다 높은 버전은 이 빌드가 모르는 열·표가 있다는 뜻이다.
const SCHEMA_VERSION: i64 = 1;
const DEFAULT_AI_LIMIT: u32 = 3;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const FILE: &str = "rooms.sqlite";
const MAX_MEMBER_NAME_CHARS: usize = 32;

const EXIT_CAPPED: u8 = 5;
const EXIT_CLOSED: u8 = 6;

#[derive(Subcommand)]
pub enum RoomCommand {
    /// Open a room. Fails if an open room already has this name.
    New {
        room: String,
        #[arg(long)]
        topic: Option<String>,
        /// How many claude posts may follow the last person's post (or the room's start). Claude
        /// posts over it are refused (exit 5) until a person posts. 0 is no limit.
        #[arg(long, value_name = "N", default_value_t = DEFAULT_AI_LIMIT)]
        ai_limit: u32,
    },
    /// Join a room from a claude session (this pty and CLAUDE_CODE_SESSION_ID). Prints the
    /// room's members and commands. A person does not join, but posts with --as.
    Join {
        room: String,
        /// Your name in the room: 1–32 letters, digits and `_.+-`.
        #[arg(long = "as", value_name = "NAME")]
        name: String,
    },
    /// Leave a room, or with --as take NAME out of it (a person, or a member whose pane was
    /// closed).
    Leave {
        room: String,
        #[arg(long = "as", value_name = "NAME")]
        name: Option<String>,
    },
    /// Print the entries since your last read, or all of them with --all.
    ///
    /// ROOM is an open room's name, or a room id from `maru room list` (closed rooms too).
    Read {
        room: String,
        /// Read as the person NAME, from where NAME last read.
        #[arg(long = "as", value_name = "NAME")]
        name: Option<String>,
        #[arg(long)]
        all: bool,
    },
    /// Post TEXT (or stdin, with `-` or no TEXT) as the claude session that joined from this
    /// pane, or with --as NAME as a person.
    ///
    /// Exits 5 if claude posts since a person last posted have reached the room's AI limit, and 6
    /// if the room is closed.
    Post {
        room: String,
        /// Post as the person NAME. The first post adds NAME to the room.
        #[arg(long = "as", value_name = "NAME")]
        name: Option<String>,
        text: Option<String>,
    },
    /// List open rooms and who is in them.
    List {
        /// List closed rooms instead.
        #[arg(long)]
        closed: bool,
    },
    /// Close a room. Its entries stay and `maru room read <id> --all` reads them. Exits 6 if it is already closed.
    Close {
        room: String,
        /// Close as the person NAME.
        #[arg(long = "as", value_name = "NAME")]
        name: Option<String>,
    },
}

/// 규칙에 걸려 거절한 요청이다. `main.rs` 의 `main` 이 `code` 를 exit code 로 쓴다.
#[derive(Debug)]
pub struct Refusal {
    pub code: u8,
    pub message: String,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Refusal {}

fn refuse(code: u8, message: String) -> anyhow::Error {
    Refusal { code, message }.into()
}

pub fn run(command: RoomCommand) -> Result<()> {
    let path = db_path()?;
    let out = match command {
        RoomCommand::New {
            room,
            topic,
            ai_limit,
        } => new(&path, &room, topic.as_deref().unwrap_or(""), ai_limit)?,
        RoomCommand::Join { room, name } => join(&path, &room, &name)?,
        RoomCommand::Leave { room, name } => leave(&path, &room, name.as_deref())?,
        RoomCommand::Read { room, name, all } => read(&path, &room, name.as_deref(), all)?,
        RoomCommand::Post { room, name, text } => {
            let text = match text.filter(|t| t != "-") {
                Some(t) => t,
                None => crate::read_stdin(
                    "give TEXT or pipe it into stdin, e.g. `maru room post review - <<'EOF'`",
                )?,
            };
            let seq = post(&path, &room, name.as_deref(), text.trim_end())?;
            format!("#{seq}\n")
        }
        RoomCommand::List { closed } => list(&path, closed)?,
        RoomCommand::Close { room, name } => close(&path, &room, name.as_deref())?,
    };
    crate::write_stdout(&out)
}

/// 앱은 설치본을 기본 userData 로 띄운 실행이 아닐 때만 pty 에 `MARU_ROOM_DB` 를 넣는다(`docs/contracts/room.md`).
fn db_path() -> Result<PathBuf> {
    if let Some(path) = crate::env_var("MARU_ROOM_DB") {
        return Ok(path.into());
    }
    let home = crate::env_var("HOME").ok_or_else(|| anyhow!("HOME is not set"))?;
    Ok(Path::new(&home).join(".ai-maru").join(FILE))
}

enum Opened {
    Missing,
    Newer(i64),
    Ready(Connection),
}

fn open(path: &Path, create: bool) -> Result<Opened> {
    if !create && !path.exists() {
        return Ok(Opened::Missing);
    }
    let mut flags = OpenFlags::default();
    if create {
        if let Some(dir) = path.parent() {
            make_dir(dir).with_context(|| format!("cannot create {}", dir.display()))?;
        }
    } else {
        flags.remove(OpenFlags::SQLITE_OPEN_CREATE);
    }
    let mut conn = Connection::open_with_flags(path, flags)
        .with_context(|| format!("cannot open {}", path.display()))?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    let version = user_version(&conn)?;
    if version > SCHEMA_VERSION {
        return Ok(Opened::Newer(version));
    }
    if version < SCHEMA_VERSION {
        migrate(&mut conn, path)?;
    }
    Ok(Opened::Ready(conn))
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

fn connect(path: &Path, create: bool) -> Result<Option<Connection>> {
    match open(path, create)? {
        Opened::Missing => Ok(None),
        Opened::Newer(v) => bail!(
            "{} has room schema version {v}, newer than this maru knows ({SCHEMA_VERSION}) ",
            path.display()
        ),
        Opened::Ready(conn) => Ok(Some(conn)),
    }
}

fn migrate(conn: &mut Connection, path: &Path) -> Result<()> {
    // journal_mode 는 트랜잭션 밖에서 바꾼다. WAL 은 파일에 남는다.
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // 다른 프로세스가 먼저 만들었을 수 있다.
    if user_version(&tx)? == 0 {
        // 사람 참여자는 pty·session 이 없다.
        tx.execute_batch(
            "CREATE TABLE rooms (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                topic TEXT NOT NULL DEFAULT '',
                ai_limit INTEGER NOT NULL,
                created_ms INTEGER NOT NULL,
                closed_ms INTEGER
            );
            CREATE UNIQUE INDEX rooms_open_name ON rooms(name) WHERE closed_ms IS NULL;
            CREATE TABLE participants (
                room INTEGER NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                pty TEXT,
                session TEXT,
                notified_seq INTEGER NOT NULL DEFAULT 0,
                read_seq INTEGER NOT NULL DEFAULT 0,
                joined_ms INTEGER NOT NULL,
                PRIMARY KEY (room, name)
            );
            CREATE INDEX participants_pty ON participants(pty);
            CREATE TABLE entries (
                room INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                author TEXT NOT NULL,
                author_kind TEXT NOT NULL,
                kind TEXT NOT NULL,
                text TEXT NOT NULL DEFAULT '',
                at_ms INTEGER NOT NULL,
                PRIMARY KEY (room, seq)
            );
            PRAGMA user_version = 1;",
        )?;
        // 방의 글은 이 사용자만 읽는다. -wal·-shm 은 sqlite 가 이 파일의 권한을 따라 만든다.
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    tx.commit()?;
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn this_pty() -> Result<String> {
    crate::env_var("MARU_PTY_ID")
        .ok_or_else(|| anyhow!("not inside an AI Maru terminal (MARU_PTY_ID is not set)"))
}

/// 숫자만이면 방 id 다. 그래서 방 이름은 숫자만으로 지을 수 없다.
fn is_id(arg: &str) -> bool {
    !arg.is_empty() && arg.bytes().all(|b| b.is_ascii_digit())
}

/// 참여자 이름은 한글 같은 글자도 받는다. 공백·괄호는 받지 않는다. `read` 가 `#번호 이름  글` 로 찍고, 사람은
/// `이름(사람)` 으로 보이기 때문이다.
fn is_member_name(name: &str) -> bool {
    let n = name.chars().count();
    (1..=MAX_MEMBER_NAME_CHARS).contains(&n)
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || "_.+-".contains(c))
}

/// `word` 를 소리 내어 읽은 끝소리. 조사를 고르는 데 쓴다.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Coda {
    Open,
    /// ㄹ 받침. `으로/로` 는 ㄹ 받침 뒤에 `로` 를 쓴다.
    Rieul,
    Closed,
}

/// 한글은 종성으로, 숫자는 한자어로 읽은 소리(일·이·삼…, 0 으로 끝나면 영·십·백·천·만)로 가린다. 영문자는 l·m·n
/// 으로 끝나면(엘·엠·엔, 단어면 -l·-m·-n) 받침으로, r 한 글자(알)도 받침으로 친다. 그 밖은 받침 없음으로 친다.
fn coda(word: &str) -> Coda {
    let Some(last) = word.chars().last() else {
        return Coda::Open;
    };
    if ('가'..='힣').contains(&last) {
        return match (last as u32 - '가' as u32) % 28 {
            0 => Coda::Open,
            8 => Coda::Rieul,
            _ => Coda::Closed,
        };
    }
    match last.to_ascii_lowercase() {
        '1' | '7' | '8' | 'l' => Coda::Rieul,
        'r' if word.chars().count() == 1 => Coda::Rieul,
        '0' | '3' | '6' | 'm' | 'n' => Coda::Closed,
        _ => Coda::Open,
    }
}

/// 이름 뒤에 붙이는 조사. 받침 뒤의 꼴로 부른다.
#[derive(Clone, Copy)]
enum Josa {
    I,
    Eul,
    Eun,
    Euro,
}

fn particle(word: &str, j: Josa) -> &'static str {
    let c = coda(word);
    let (closed, open) = match j {
        Josa::I => ("이", "가"),
        Josa::Eul => ("을", "를"),
        Josa::Eun => ("은", "는"),
        Josa::Euro if c == Coda::Rieul => return "로",
        Josa::Euro => ("으로", "로"),
    };
    if c == Coda::Open { open } else { closed }
}

fn josa(word: &str, j: Josa) -> String {
    format!("{word} {}", particle(word, j))
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum MemberKind {
    Human,
    Claude,
}

impl MemberKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "human" => Some(MemberKind::Human),
            "claude" => Some(MemberKind::Claude),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            MemberKind::Human => "human",
            MemberKind::Claude => "claude",
        }
    }
}

impl ToSql for MemberKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}

impl FromSql for MemberKind {
    fn column_result(v: ValueRef<'_>) -> FromSqlResult<Self> {
        MemberKind::parse(v.as_str()?).ok_or(FromSqlError::InvalidType)
    }
}

fn shown(name: &str, kind: MemberKind) -> String {
    match kind {
        MemberKind::Human => format!("{name}(사람)"),
        MemberKind::Claude => name.to_owned(),
    }
}

/// `shown` 에 조사를 붙인다. 조사는 괄호 밖의 이름을 따른다("가나(사람) 가").
fn shown_josa(name: &str, kind: MemberKind, j: Josa) -> String {
    format!("{} {}", shown(name, kind), particle(name, j))
}

struct Room {
    id: i64,
    name: String,
    topic: String,
    /// 0 이면 상한이 없다.
    ai_limit: i64,
    closed: bool,
}

const ROOM_COLS: &str = "SELECT id, name, topic, ai_limit, closed_ms FROM rooms";

fn room_row(r: &rusqlite::Row) -> rusqlite::Result<Room> {
    Ok(Room {
        id: r.get(0)?,
        name: r.get(1)?,
        topic: r.get(2)?,
        ai_limit: r.get(3)?,
        closed: r.get::<_, Option<i64>>(4)?.is_some(),
    })
}

/// 숫자면 방 id, 아니면 그 이름의 열린 방, 없으면 그 이름으로 마지막에 닫힌 방이다.
fn find_room(conn: &Connection, arg: &str) -> Result<Room> {
    let found = if is_id(arg) {
        conn.query_row(&format!("{ROOM_COLS} WHERE id = ?1"), [arg], room_row)
            .optional()?
    } else {
        conn.query_row(
            &format!("{ROOM_COLS} WHERE name = ?1 ORDER BY closed_ms IS NOT NULL, id DESC LIMIT 1"),
            [arg],
            room_row,
        )
        .optional()?
    };
    found.ok_or_else(|| no_room(arg))
}

fn no_room(arg: &str) -> anyhow::Error {
    anyhow!("방 {} 없다", josa(arg, Josa::I))
}

fn last_seq(conn: &Connection, room: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM entries WHERE room = ?1",
        [room],
        |r| r.get(0),
    )?)
}

fn ai_streak(conn: &Connection, room: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE room = ?1 AND kind = 'post' AND author_kind = 'claude'
           AND seq > COALESCE((SELECT MAX(seq) FROM entries
                               WHERE room = ?1 AND kind = 'post' AND author_kind = 'human'), 0)",
        [room],
        |r| r.get(0),
    )?)
}

/// 사람 글 없이 이어진 AI 글이 상한까지 얼마나 왔는지.
#[derive(Clone, Copy, PartialEq)]
enum Turn {
    Open,
    Last,
    Over,
}

impl Turn {
    fn note(self, ai_limit: i64) -> Option<String> {
        match self {
            Turn::Open => None,
            Turn::Last => Some(format!(
                "사람 글 없이 이어진 AI 글 {}개 — 상한 {ai_limit}개까지 하나 남았다.",
                ai_limit - 1
            )),
            Turn::Over => Some(capped(ai_limit)),
        }
    }
}

fn capped(ai_limit: i64) -> String {
    format!(
        "사람 글 없이 이어진 AI 글 {ai_limit}개로 상한에 닿았다 — 사람이 올릴 때까지 AI 글은 거절된다."
    )
}

fn turn(conn: &Connection, room: i64, ai_limit: i64) -> Result<Turn> {
    if ai_limit == 0 {
        return Ok(Turn::Open);
    }
    let streak = ai_streak(conn, room)?;
    Ok(if streak >= ai_limit {
        Turn::Over
    } else if streak == ai_limit - 1 {
        Turn::Last
    } else {
        Turn::Open
    })
}

struct Member {
    name: String,
    kind: MemberKind,
    read_seq: i64,
}

const MEMBER_COLS: &str = "SELECT name, kind, read_seq FROM participants";

fn member_row(r: &rusqlite::Row) -> rusqlite::Result<Member> {
    Ok(Member {
        name: r.get(0)?,
        kind: r.get(1)?,
        read_seq: r.get(2)?,
    })
}

/// 이 pty 의 claude 참여자. 사람 참여자는 pty 가 없으므로 여기서 찾지 않는다.
fn member(conn: &Connection, room: i64, pty: &str) -> Result<Option<Member>> {
    Ok(conn
        .query_row(
            &format!("{MEMBER_COLS} WHERE room = ?1 AND pty = ?2"),
            params![room, pty],
            member_row,
        )
        .optional()?)
}

fn member_named(conn: &Connection, room: i64, name: &str) -> Result<Option<Member>> {
    Ok(conn
        .query_row(
            &format!("{MEMBER_COLS} WHERE room = ?1 AND name = ?2"),
            params![room, name],
            member_row,
        )
        .optional()?)
}

fn me_here(conn: &Connection, room: i64) -> Result<Option<Member>> {
    match crate::env_var("MARU_PTY_ID") {
        Some(pty) => member(conn, room, &pty),
        None => Ok(None),
    }
}

fn check_member_name(name: &str) -> Result<()> {
    if !is_member_name(name) {
        bail!("--as 는 1–{MAX_MEMBER_NAME_CHARS} 자의 글자·숫자·`_.+-` 다 (got {name:?})");
    }
    Ok(())
}

/// `--as` 의 사람. 아직 올린 적이 없으면 `None` 이다. claude 참여자의 이름이면 거절한다 — 그 이름으로 올리면
/// 글쓴이를 가를 수 없기 때문이다.
fn person(conn: &Connection, room: &Room, name: &str) -> Result<Option<Member>> {
    check_member_name(name)?;
    match member_named(conn, room.id, name)? {
        Some(m) if m.kind != MemberKind::Human => bail!(
            "방 {} 의 {} claude 참여자다",
            room.name,
            josa(name, Josa::Eun)
        ),
        found => Ok(found),
    }
}

fn speaker(conn: &Connection, room: &Room, as_name: Option<&str>) -> Result<Option<Member>> {
    match as_name {
        Some(name) => person(conn, room, name),
        None => me_here(conn, room.id),
    }
}

fn new_person(name: &str) -> Member {
    Member {
        name: name.to_owned(),
        kind: MemberKind::Human,
        read_seq: 0,
    }
}

fn mark_read(conn: &Connection, room: i64, name: &str, seq: i64) -> Result<()> {
    conn.execute(
        "UPDATE participants SET read_seq = MAX(read_seq, ?3) WHERE room = ?1 AND name = ?2",
        params![room, name, seq],
    )?;
    Ok(())
}

fn participants_text(conn: &Connection, room: i64) -> Result<String> {
    let mut stmt = conn.prepare(
        "SELECT name, kind FROM participants WHERE room = ?1 ORDER BY kind = 'claude', joined_ms",
    )?;
    let names = stmt
        .query_map([room], |r| Ok(shown(&r.get::<_, String>(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(if names.is_empty() {
        "(없음)".into()
    } else {
        names.join(", ")
    })
}

fn new(path: &Path, name: &str, topic: &str, ai_limit: u32) -> Result<String> {
    if !crate::is_name(name) || is_id(name) {
        bail!("a room name is 1–32 letters, digits and `_.+-`, not only digits (got {name:?})");
    }
    let mut conn = connect(path, true)?.expect("created");
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let open: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM rooms WHERE name = ?1 AND closed_ms IS NULL)",
        [name],
        |r| r.get(0),
    )?;
    if open {
        bail!("열린 방 {} 이미 있다", josa(name, Josa::I));
    }
    tx.execute(
        "INSERT INTO rooms (name, topic, ai_limit, created_ms) VALUES (?1, ?2, ?3, ?4)",
        params![name, topic, ai_limit, now_ms()],
    )?;
    let id = tx.last_insert_rowid();
    tx.commit()?;
    Ok(format!(
        "방 {} 열었다 (id {id}, {limit}).\n\
         claude 세션은 maru room join {name} --as <이름> 으로 들어온다.\n\
         사람은 join 없이 maru room post {name} --as <이름> <글> 로 올린다.\n",
        josa(name, Josa::Eul),
        limit = match ai_limit {
            0 => "AI 연속 상한 없음".to_owned(),
            n => format!("사람 글 없이 이어지는 AI 글 {n}개까지"),
        }
    ))
}

fn join(path: &Path, arg: &str, name: &str) -> Result<String> {
    check_member_name(name)?;
    let pty = this_pty()?;
    let session = crate::env_var("CLAUDE_CODE_SESSION_ID").ok_or_else(|| {
        anyhow!("join 은 claude 세션의 Bash 에서만 된다 — CLAUDE_CODE_SESSION_ID 가 없다")
    })?;
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    if room.closed {
        return Err(refuse(
            EXIT_CLOSED,
            format!("방 {} 닫혔다.", josa(&room.name, Josa::Eun)),
        ));
    }
    let here = member(&tx, room.id, &pty)?;
    if let Some(m) = &here
        && m.name != name
    {
        bail!(
            "이 pane 은 방 {} 에 이미 {} 들어 있다",
            room.name,
            josa(&m.name, Josa::Euro)
        );
    }
    let held: Option<(MemberKind, Option<String>)> = tx
        .query_row(
            "SELECT kind, session FROM participants WHERE room = ?1 AND name = ?2",
            params![room.id, name],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match held {
        // 이 pane 의 참여이거나, 같은 세션을 다른 pane 에서 `--resume` 했다. 참여를 이 pane 으로 옮긴다.
        // monitor 가 없던 동안 `room read` 로 읽은 글은 다시 알리지 않는다.
        Some((MemberKind::Claude, held)) if here.is_some() || held.as_deref() == Some(&session) => {
            tx.execute(
                "UPDATE participants SET pty = ?3, session = ?4, notified_seq = MAX(notified_seq, read_seq)
                 WHERE room = ?1 AND name = ?2",
                params![room.id, name, pty, session],
            )?;
        }
        Some((kind, _)) => bail!(
            "방 {} 에 {} 이미 있다",
            room.name,
            shown_josa(name, kind, Josa::I)
        ),
        None => {
            // 들어오기 전의 글은 알리지 않는다. 읽은 자리는 0 으로 두어 첫 `room read` 가 지난 글을 모두 보이게 한다.
            tx.execute(
                "INSERT INTO participants (room, name, kind, pty, session, notified_seq, read_seq, joined_ms)
                 VALUES (?1, ?2, 'claude', ?3, ?4, ?5, 0, ?6)",
                params![room.id, name, pty, session, last_seq(&tx, room.id)?, now_ms()],
            )?;
        }
    }
    let notice = notice(&tx, &room, name)?;
    tx.commit()?;
    Ok(notice)
}

fn notice(conn: &Connection, room: &Room, me: &str) -> Result<String> {
    let r = &room.name;
    let topic = if room.topic.is_empty() {
        String::new()
    } else {
        format!("주제: {}\n", printable(&room.topic))
    };
    let others = participants_text(conn, room.id)?;
    let limit = match room.ai_limit {
        0 => String::new(),
        n => format!(
            "사람 글 없이 이어지는 AI 글은 {n}개까지 올라간다. 넘는 글은 post 가 exit 5 로 거절한다. 상한까지 하나 남았을 때와 상한에 닿았을 때는 알림에 그렇다고 적힌다.\n"
        ),
    };
    Ok(format!(
        "방 {r} 에 {} 들어왔다.\n\
         {topic}참여자: {others}\n\
         \n\
         새 기록(글·나감·닫힘)은 글쓴이를 뺀 claude 참여자 모두에게 monitor 알림({{\"event\":\"room\",\"room\":\"{r}\",…}})으로 간다. 알림에는 글 내용이 없다.\n\
         \n\
         명령:\n\
         - maru room read {r} — 지난번 읽은 뒤의 기록을 찍는다. --all 이면 모두 찍는다.\n\
         - maru room post {r} <글> — 글을 올린다. <글> 이 없거나 - 면 stdin 에서 읽는다.\n\
         - maru room leave {r} — 방에서 나간다.\n\
         \n\
         {limit}닫힌 방이면 post 가 exit 6 으로 거절한다.\n",
        josa(me, Josa::Euro)
    ))
}

/// `name` 이 없으면 이 pane 의 참여를, 있으면 그 이름의 참여를 지운다. 이름으로도 지우는 것은 사람 참여자와, 닫힌
/// pane 에 남은 참여를 지우기 위해서다. 열린 방이면 나감을 기록으로 남겨 남은 참여자에게 알린다.
fn leave(path: &Path, arg: &str, name: Option<&str>) -> Result<String> {
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    let gone = match name {
        None => {
            let pty = this_pty()?;
            member(&tx, room.id, &pty)?
                .ok_or_else(|| anyhow!("이 pane 은 방 {} 에 들어 있지 않다", room.name))?
        }
        Some(name) => member_named(&tx, room.id, name)?
            .ok_or_else(|| anyhow!("방 {} 에 {} 없다", room.name, josa(name, Josa::I)))?,
    };
    tx.execute(
        "DELETE FROM participants WHERE room = ?1 AND name = ?2",
        params![room.id, gone.name],
    )?;
    if !room.closed {
        add_entry(&tx, room.id, Some((&gone.name, gone.kind)), Kind::Leave, "")?;
    }
    let out = match name {
        None => format!("방 {} 에서 나왔다.\n", room.name),
        Some(_) => format!(
            "방 {} 에서 {} 내보냈다.\n",
            room.name,
            shown_josa(&gone.name, gone.kind, Josa::Eul)
        ),
    };
    if room.closed {
        tx.commit()?;
    } else {
        commit_and_ring(tx, path)?;
    }
    Ok(out)
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Post,
    /// 나감도 기록 하나로 남긴다. 부른 참여자가 나간 것을 기다리던 쪽이 알아야 하기 때문이다.
    Leave,
    /// 닫힘도 기록 하나로 남겨, monitor 가 다른 글처럼 한 번 알리게 한다.
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

impl ToSql for Kind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}

impl FromSql for Kind {
    fn column_result(v: ValueRef<'_>) -> FromSqlResult<Self> {
        match v.as_str()? {
            "post" => Ok(Kind::Post),
            "leave" => Ok(Kind::Leave),
            "close" => Ok(Kind::Close),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

/// `author` 가 없으면(닫은 쪽을 모르는 닫힘) 글쓴이를 비워 둔다. 커밋은 `commit_and_ring` 으로 한다. `ring` 을
/// 거르면 지켜보는 쪽이 이 기록을 다음 기록이 올 때까지 모른다.
fn add_entry(
    tx: &Connection,
    room: i64,
    author: Option<(&str, MemberKind)>,
    kind: Kind,
    text: &str,
) -> Result<i64> {
    let seq = last_seq(tx, room)? + 1;
    let (name, author_kind) = author.map_or(("", ""), |(name, kind)| (name, kind.as_str()));
    tx.execute(
        "INSERT INTO entries (room, seq, author, author_kind, kind, text, at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![room, seq, name, author_kind, kind, text, now_ms()],
    )?;
    Ok(seq)
}

fn commit_and_ring(tx: rusqlite::Transaction, path: &Path) -> Result<()> {
    tx.commit()?;
    ring(path);
    Ok(())
}

fn post(path: &Path, arg: &str, as_name: Option<&str>, text: &str) -> Result<i64> {
    enum Who<'a> {
        Person(&'a str),
        Pane(String),
    }
    let who = match as_name {
        Some(name) => Who::Person(name),
        None => Who::Pane(this_pty()?),
    };
    if text.trim().is_empty() {
        bail!("the text is empty");
    }
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    // 사람은 처음 올릴 때 참여자로 적힌다. 아래에서 거절하면 커밋하지 않으므로 적힌 것도 사라진다.
    let me = match who {
        Who::Person(name) => match person(&tx, &room, name)? {
            Some(m) => m,
            None => {
                let m = new_person(name);
                tx.execute(
                    "INSERT INTO participants (room, name, kind, joined_ms) VALUES (?1, ?2, ?3, ?4)",
                    params![room.id, m.name, m.kind, now_ms()],
                )?;
                m
            }
        },
        Who::Pane(pty) => member(&tx, room.id, &pty)?
            .ok_or_else(|| anyhow!("이 pane 은 방 {} 에 들어 있지 않다", room.name))?,
    };
    if room.closed {
        return Err(refuse(
            EXIT_CLOSED,
            format!("방 {} 닫혔다.", josa(&room.name, Josa::Eun)),
        ));
    }
    if me.kind == MemberKind::Claude && turn(&tx, room.id, room.ai_limit)? == Turn::Over {
        return Err(refuse(EXIT_CAPPED, capped(room.ai_limit)));
    }
    let seq = add_entry(&tx, room.id, Some((&me.name, me.kind)), Kind::Post, text)?;
    // 자기 글은 알릴 것이 아니다. 읽지 않은 글이 남았으면 읽은 자리를 그대로 두어 다음 `read` 가 그 글들을 보이게
    // 한다.
    tx.execute(
        "UPDATE participants SET notified_seq = ?3,
            read_seq = CASE WHEN read_seq >= ?3 - 1 THEN ?3 ELSE read_seq END
         WHERE room = ?1 AND name = ?2",
        params![room.id, me.name, seq],
    )?;
    commit_and_ring(tx, path)?;
    Ok(seq)
}

struct Entry {
    seq: i64,
    author: String,
    /// 닫은 쪽을 모르는 닫힘 기록은 글쓴이가 비어 `None` 이다.
    author_kind: Option<MemberKind>,
    kind: Kind,
    text: String,
}

impl Entry {
    fn who(&self) -> String {
        match self.author_kind {
            Some(kind) => shown(&self.author, kind),
            None => self.author.clone(),
        }
    }

    fn who_josa(&self, j: Josa) -> String {
        format!("{} {}", self.who(), particle(&self.author, j))
    }
}

fn entries_after(conn: &Connection, room: i64, after: i64) -> Result<Vec<Entry>> {
    let mut stmt = conn.prepare(
        "SELECT seq, author, author_kind, kind, text FROM entries WHERE room = ?1 AND seq > ?2 ORDER BY seq",
    )?;
    let rows = stmt
        .query_map(params![room, after], |r| {
            Ok(Entry {
                seq: r.get(0)?,
                author: r.get(1)?,
                author_kind: MemberKind::parse(&r.get::<_, String>(2)?),
                kind: r.get(3)?,
                text: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn plain(e: &Entry) -> String {
    match e.kind {
        Kind::Leave => format!("#{} · {} 나갔다", e.seq, e.who_josa(Josa::I)),
        Kind::Close if e.author.is_empty() => format!("#{} · 방이 닫혔다", e.seq),
        Kind::Close => format!("#{} · {} 방을 닫았다", e.seq, e.who_josa(Josa::I)),
        Kind::Post => format!(
            "#{} {}  {}",
            e.seq,
            e.who(),
            printable(&e.text).replace('\n', "\n    ")
        ),
    }
}

/// 글을 터미널에 찍기 전에 줄바꿈 밖의 제어 문자를 공백으로 바꾼다. 다른 참여자가 올린 ESC·OSC 가 읽는
/// 쪽 터미널에서 실행되지 않게 하기 위해서다.
fn printable(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .collect()
}

fn read(path: &Path, arg: &str, as_name: Option<&str>, all: bool) -> Result<String> {
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    let me = speaker(&tx, &room, as_name)?;
    let from = match &me {
        Some(m) if !all => m.read_seq,
        _ => 0,
    };
    let entries = entries_after(&tx, room.id, from)?;
    let last = last_seq(&tx, room.id)?;
    let mut out = String::new();
    if entries.is_empty() {
        out.push_str("새 글이 없다.\n");
    }
    for e in &entries {
        out.push_str(&plain(e));
        out.push('\n');
    }
    if room.closed {
        out.push_str(&format!("방이 닫혔다 (마지막 #{last}).\n"));
    }
    if let Some(m) = &me {
        mark_read(&tx, room.id, &m.name, last)?;
    }
    tx.commit()?;
    Ok(out)
}

fn list(path: &Path, closed: bool) -> Result<String> {
    let mut out = String::from("ID\tNAME\tLAST\tAI_LIMIT\tPARTICIPANTS\tTOPIC\n");
    let Some(conn) = connect(path, false)? else {
        return Ok(out);
    };
    let mut stmt = conn.prepare(&format!(
        "{ROOM_COLS} WHERE closed_ms IS {} NULL ORDER BY id",
        if closed { "NOT" } else { "" }
    ))?;
    let rooms = stmt
        .query_map([], room_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for room in rooms {
        let row = [
            room.id.to_string(),
            room.name,
            format!("#{}", last_seq(&conn, room.id)?),
            room.ai_limit.to_string(),
            participants_text(&conn, room.id)?,
            room.topic,
        ];
        out.push_str(&row.map(|v| crate::tsv_field(&v)).join("\t"));
        out.push('\n');
    }
    Ok(out)
}

fn close(path: &Path, arg: &str, as_name: Option<&str>) -> Result<String> {
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    if room.closed {
        return Err(refuse(
            EXIT_CLOSED,
            format!(
                "방 {} 이미 닫혔다 (id {}).",
                josa(&room.name, Josa::Eun),
                room.id
            ),
        ));
    }
    let closer = speaker(&tx, &room, as_name)?.or_else(|| as_name.map(new_person));
    let author = closer.as_ref().map(|m| (m.name.as_str(), m.kind));
    add_entry(&tx, room.id, author, Kind::Close, "")?;
    tx.execute(
        "UPDATE rooms SET closed_ms = ?2 WHERE id = ?1",
        params![room.id, now_ms()],
    )?;
    commit_and_ring(tx, path)?;
    Ok(format!(
        "방 {} 닫았다 (id {}). 글은 maru room read {} --all 로 읽는다.\n",
        josa(&room.name, Josa::Eul),
        room.id,
        room.id
    ))
}

/// 한 참여자에게 알릴 것. 줄을 쓴 뒤 `mark` 로 알린 자리를 올린다.
struct Pending {
    room: i64,
    name: String,
    seq: i64,
    event: Option<Value>,
}

fn pending(conn: &Connection, pty: &str) -> Result<Vec<Pending>> {
    let mut stmt = conn.prepare(
        "SELECT p.room, r.name, r.ai_limit, p.name, p.notified_seq FROM participants p JOIN rooms r ON r.id = p.room
         WHERE p.pty = ?1 AND p.kind = 'claude'
           AND EXISTS (SELECT 1 FROM entries e WHERE e.room = p.room AND e.seq > p.notified_seq)
         ORDER BY p.room",
    )?;
    let rows = stmt
        .query_map([pty], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut out = Vec::new();
    for (room, room_name, ai_limit, name, notified) in rows {
        let all = entries_after(conn, room, notified)?;
        let seq = all.last().map_or(notified, |e| e.seq);
        let news: Vec<&Entry> = all.iter().filter(|e| e.author != name).collect();
        let event = if news.is_empty() {
            None
        } else {
            let note = turn(conn, room, ai_limit)?.note(ai_limit);
            Some(event(&room_name, &news, note))
        };
        out.push(Pending {
            room,
            name,
            seq,
            event,
        });
    }
    Ok(out)
}

fn mark(conn: &Connection, p: &Pending) -> Result<()> {
    conn.execute(
        "UPDATE participants SET notified_seq = MAX(notified_seq, ?3) WHERE room = ?1 AND name = ?2",
        params![p.room, p.name, p.seq],
    )?;
    Ok(())
}

fn event(room: &str, news: &[&Entry], note: Option<String>) -> Value {
    let first = news[0].seq;
    let last = news[news.len() - 1];
    let mut authors: Vec<&Entry> = Vec::new();
    for e in news {
        if !e.author.is_empty() && !authors.iter().any(|a| a.author == e.author) {
            authors.push(e);
        }
    }
    let from = authors
        .iter()
        .map(|e| e.author.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let shown_from = authors
        .iter()
        .map(|e| e.who())
        .collect::<Vec<_>>()
        .join(", ");
    let close = news.iter().find(|e| e.kind == Kind::Close);
    let kind = if close.is_some() {
        Kind::Close
    } else {
        last.kind
    };
    let read = format!("maru room read {room} 로 읽는다.");
    let mut text = if let Some(c) = close {
        if c.author.is_empty() {
            format!("방이 닫혔다 ({room}).")
        } else {
            format!("방이 닫혔다 ({room}, 닫은 이: {}).", c.who())
        }
    } else if news.len() > 1 {
        format!(
            "방 {room} 에 새 기록 #{first}~#{} (보낸 이: {shown_from}) — {read}",
            last.seq
        )
    } else if kind == Kind::Leave {
        format!(
            "방 {room} 에서 {} 나갔다 (#{}) — {read}",
            last.who_josa(Josa::I),
            last.seq
        )
    } else {
        format!(
            "방 {room} 에 새 글 #{} (보낸 이: {shown_from}) — {read}",
            last.seq
        )
    };
    if close.is_none()
        && let Some(note) = note
    {
        text = format!("{text} {note}");
    }
    let mut ev = json!({ "event": "room", "room": room, "seq": last.seq, "from": from, "kind": kind.as_str(), "text": text });
    if news.len() > 1 {
        ev["first"] = first.into();
    }
    ev
}

/// 기록을 더한 쪽이 커밋한 뒤 건드리는 파일. 지켜보는 쪽(monitor)은 이 파일이 바뀌면 방 파일을 다시 읽는다.
///
/// `-wal` 을 지켜보면 커밋이 보이기 전에 깨어, 그 기록의 알림이 다음 기록까지 밀린다. sqlite 가 프레임을 `-wal` 에
/// 쓴 뒤 `-shm` 의 헤더를 갱신하기 전에 읽기 때문으로 보인다(sqlite 소스로 확인하지 않았다).
fn bell_path(db: &Path) -> PathBuf {
    let mut p = db.as_os_str().to_owned();
    p.push("-notify");
    p.into()
}

/// 커밋 뒤에 부른다. 실패해도 기록은 이미 남았으므로 경고만 한다.
fn ring(db: &Path) {
    use std::os::unix::fs::{FileExt, OpenOptionsExt};
    let r = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(bell_path(db))
        .and_then(|f| f.write_at(b"\n", 0));
    if let Err(e) = r {
        let _ = writeln!(
            std::io::stderr(),
            "maru: the entry is saved, but others may not be notified until the next one: {e}"
        );
    }
}

/// 디렉토리와 알림 파일(`bell_path`)을 kqueue 로 지켜보며, 방 파일의 연결 하나를 붙들고 있다.
///
/// 방 파일과 알림 파일이 생기는 것은 디렉토리로 안다. 연결을 붙들고 있어야 `-wal` 이 지워지지 않는다 — 마지막
/// 연결이 닫히면 sqlite 가 `-wal` 을 지우고 다음에 열 때 다시 만들어, 디렉토리 이벤트가 끝없이 이어진다. 방 파일
/// 자체는 sqlite 밖에서 열지 않는다. 같은 프로세스에서 그 파일의 다른 fd 를 닫으면 sqlite 가 건 POSIX 잠금이
/// 풀리기 때문이다.
struct Watch {
    path: PathBuf,
    dir: Option<File>,
    bell: Option<(File, u64)>,
    conn: Option<(Connection, u64)>,
}

enum State<'a> {
    /// 파일이 아직 없거나 지금 열 수 없다. 다음 변화에 다시 본다.
    Waiting,
    Newer,
    Ready(&'a Connection),
}

fn watch_vnode(kq: &Kqueue, f: &File, flags: FilterFlag) -> bool {
    crate::watch(kq, f.as_raw_fd() as usize, EventFilter::EVFILT_VNODE, flags).is_ok()
}

fn ino(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path).map(|m| m.ino()).ok()
}

impl Watch {
    fn new(kq: &Kqueue, path: PathBuf) -> Self {
        // 디렉토리가 없으면 만들어 둔다. 방이 나중에 생겨도 알아채야 하기 때문이다.
        let dir = path.parent().and_then(|d| {
            make_dir(d).ok()?;
            File::open(d)
                .ok()
                .filter(|f| watch_vnode(kq, f, FilterFlag::NOTE_WRITE))
        });
        Watch {
            path,
            dir,
            bell: None,
            conn: None,
        }
    }

    fn owns(&self, ident: usize) -> bool {
        let dir = self.dir.as_ref();
        let bell = self.bell.as_ref().map(|b| &b.0);
        [dir, bell]
            .iter()
            .any(|f| f.is_some_and(|f| f.as_raw_fd() as usize == ident))
    }

    fn state(&mut self, kq: &Kqueue) -> State<'_> {
        let bell = bell_path(&self.path);
        if let Some(bell_ino) = ino(&bell)
            && self.bell.as_ref().map(|b| b.1) != Some(bell_ino)
        {
            self.bell = File::open(&bell)
                .ok()
                .filter(|f| watch_vnode(kq, f, FilterFlag::NOTE_WRITE))
                .map(|f| (f, bell_ino));
        }
        let Some(db_ino) = ino(&self.path) else {
            self.conn = None;
            return State::Waiting;
        };
        if self.conn.as_ref().map(|c| c.1) != Some(db_ino) {
            self.conn = None;
            match open(&self.path, false) {
                Ok(Opened::Ready(conn)) => self.conn = Some((conn, db_ino)),
                Ok(Opened::Newer(_)) => return State::Newer,
                _ => return State::Waiting,
            }
        }
        let Some((conn, _)) = &self.conn else {
            return State::Waiting;
        };
        // 다른 maru 가 스키마를 올렸을 수 있다.
        match user_version(conn) {
            Ok(v) if v > SCHEMA_VERSION => State::Newer,
            Ok(_) => State::Ready(conn),
            Err(_) => State::Waiting,
        }
    }
}

/// `maru claude monitor` 의 room 쪽. 이 pty 의 참여자에게 갈 알림 줄을 stdout 에 쓴다.
pub struct Monitor {
    watch: Watch,
    pty: String,
    stopped: bool,
}

pub struct StdoutClosed;

impl Monitor {
    pub fn start(kq: &Kqueue, pty: &str) -> Option<Self> {
        Some(Monitor {
            watch: Watch::new(kq, db_path().ok()?),
            pty: pty.to_owned(),
            stopped: false,
        })
    }

    pub fn owns(&self, ident: usize) -> bool {
        self.watch.owns(ident)
    }

    /// 알릴 것을 쓰고 알린 자리를 올린다. 모르는 스키마 버전이면 room 알림을 멈춘다.
    pub fn changed(&mut self, kq: &Kqueue) -> Result<(), StdoutClosed> {
        if self.stopped {
            return Ok(());
        }
        let conn = match self.watch.state(kq) {
            State::Ready(conn) => conn,
            State::Newer => {
                self.stopped = true;
                return Ok(());
            }
            State::Waiting => return Ok(()),
        };
        // 잠깐 잠겨 읽지 못했으면 다음 변화에 다시 본다.
        let Ok(pending) = pending(conn, &self.pty) else {
            return Ok(());
        };
        let mut out = std::io::stdout().lock();
        for p in pending {
            if let Some(ev) = &p.event {
                writeln!(out, "{ev}")
                    .and_then(|()| out.flush())
                    .map_err(|_| StdoutClosed)?;
            }
            let _ = mark(conn, &p);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{Coda, Josa, MemberKind, coda, is_member_name, josa, shown_josa};

    #[test]
    fn coda_reads_hangul_digits_and_latin_letters() {
        for (word, want) in [
            ("가나", Coda::Open),
            ("민준", Coda::Closed),
            ("하늘", Coda::Rieul),
            ("#1", Coda::Rieul),
            ("#2", Coda::Open),
            ("#3", Coda::Closed),
            ("#4", Coda::Open),
            ("#5", Coda::Open),
            ("#6", Coda::Closed),
            ("#7", Coda::Rieul),
            ("#8", Coda::Rieul),
            ("#9", Coda::Open),
            ("#10", Coda::Closed),
            ("#1~#20", Coda::Closed),
            ("A", Coda::Open),
            ("B", Coda::Open),
            ("L", Coda::Rieul),
            ("M", Coda::Closed),
            ("N", Coda::Closed),
            ("R", Coda::Rieul),
            ("reviewer", Coda::Open),
            ("design", Coda::Closed),
            ("", Coda::Open),
        ] {
            assert_eq!(coda(word), want, "{word}");
        }
    }

    #[test]
    fn josa_picks_the_particle_by_the_last_sound() {
        assert_eq!(josa("#8", Josa::I), "#8 이");
        assert_eq!(josa("#9", Josa::I), "#9 가");
        assert_eq!(josa("B", Josa::I), "B 가");
        assert_eq!(josa("review", Josa::Eul), "review 를");
        assert_eq!(josa("design", Josa::Eun), "design 은");
        assert_eq!(josa("민준", Josa::Euro), "민준 으로");
        assert_eq!(josa("하늘", Josa::Euro), "하늘 로");
        assert_eq!(josa("가나", Josa::Euro), "가나 로");
        assert_eq!(
            shown_josa("민준", MemberKind::Human, Josa::I),
            "민준(사람) 이"
        );
        assert_eq!(shown_josa("B", MemberKind::Claude, Josa::I), "B 가");
    }

    #[test]
    fn member_names_take_letters_of_any_script_but_no_spaces_or_brackets() {
        assert!(is_member_name("가나"));
        assert!(is_member_name("reviewer-2"));
        assert!(is_member_name(&"가".repeat(32)));
        assert!(!is_member_name(&"가".repeat(33)));
        for bad in ["", "a b", "a(b)", "a@b", "a\tb", "a\u{1b}b"] {
            assert!(!is_member_name(bad), "{bad:?}");
        }
    }
}
