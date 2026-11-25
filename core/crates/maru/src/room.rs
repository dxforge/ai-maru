//! `maru room` — 사람 하나와 claude 세션 여럿의 대화방. 계약은 `docs/contracts/room.md` 에 있다.
//!
//! 알림·안내문·거절 메시지에는 `@` 를 넣지 않는다. Claude Code 가 `@` 뒤를 파일·agent 참조로 읽기 때문이다.

use anyhow::{Context, Result, anyhow, bail};
use clap::Subcommand;
use nix::sys::event::{EventFilter, FilterFlag, Kqueue};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::fs::File;
use std::io::Write;
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

mod chat;

/// 파일의 `PRAGMA user_version`. 스키마는 더하기만 하므로, 이보다 높은 버전은 이 빌드가 모르는 열·표가 있다는 뜻이다.
const SCHEMA_VERSION: i64 = 1;
/// 사람 글 뒤에 이어 올라갈 수 있는 AI 글 수.
const AI_STREAK_CAP: i64 = 3;
const HUMAN: &str = "human";
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const FILE: &str = "rooms.sqlite";

const EXIT_SEEN: u8 = 4;
const EXIT_CAPPED: u8 = 5;
const EXIT_CLOSED: u8 = 6;

const LAST_TURN: &str =
    "이번이 AI 의 마지막 차례다 — 다른 AI 를 부르지 말고 사람에게 넘기거나 끝맺는다.";
const CAPPED: &str = "AI 차례가 끝났다 — 사람이 글을 올릴 때까지 올리지 않는다.";

#[derive(Subcommand)]
pub enum RoomCommand {
    /// Open a room. Fails if an open room already has this name.
    New {
        room: String,
        #[arg(long)]
        topic: Option<String>,
    },
    /// Join a room from a claude session (this pty and CLAUDE_CODE_SESSION_ID). Prints how to
    /// take part.
    Join {
        room: String,
        /// Your name in the room.
        #[arg(long = "as", value_name = "NAME")]
        name: String,
        /// Do not get notified of new entries; read them yourself.
        #[arg(long)]
        quiet: bool,
    },
    /// Leave a room, or with --as take NAME out of it (e.g. a member whose pane was closed).
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
        #[arg(long)]
        all: bool,
        /// Accepted for consistency with post and pass; ignored by read.
        #[arg(long)]
        seen: Option<i64>,
    },
    /// Post TEXT (or stdin, with `-` or no TEXT) if SEEN is still the last entry's number.
    ///
    /// Exits 4 if newer entries came first, 5 if AIs have used their turns since the person
    /// last posted, and 6 if the room is closed.
    Post {
        room: String,
        /// The last entry's number you read.
        #[arg(long)]
        seen: i64,
        text: Option<String>,
    },
    /// Record that you have nothing to add when you were asked. Same exit codes as post.
    Pass {
        room: String,
        #[arg(long)]
        seen: i64,
    },
    /// Talk in a room from this terminal as `human`.
    Chat { room: String },
    /// List open rooms and who is in them.
    List {
        /// List closed rooms instead.
        #[arg(long)]
        closed: bool,
    },
    /// Close a room. Its entries stay and `maru room read <id> --all` reads them.
    Close { room: String },
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
        RoomCommand::New { room, topic } => new(&path, &room, topic.as_deref().unwrap_or(""))?,
        RoomCommand::Join { room, name, quiet } => join(&path, &room, &name, quiet)?,
        RoomCommand::Leave { room, name } => leave(&path, &room, name.as_deref())?,
        RoomCommand::Read { room, all, .. } => read(&path, &room, all)?,
        RoomCommand::Post { room, seen, text } => {
            let text = match text.filter(|t| t != "-") {
                Some(t) => t,
                None => crate::read_stdin(
                    "give TEXT or pipe it into stdin, e.g. `maru room post review --seen 3 - <<'EOF'`",
                )?,
            };
            let seq = append(&path, &room, Kind::Post, seen, text.trim_end())?;
            format!("#{seq}\n")
        }
        RoomCommand::Pass { room, seen } => {
            let seq = append(&path, &room, Kind::Pass, seen, "")?;
            format!("#{seq}\n")
        }
        RoomCommand::Chat { room } => return chat::run(&path, &room),
        RoomCommand::List { closed } => list(&path, closed)?,
        RoomCommand::Close { room } => close(&path, &room)?,
    };
    crate::write_stdout(&out)
}

/// 앱은 격리된 실행(dev·e2e)에서만 pty 에 `MARU_ROOM_DB` 를 넣는다(`docs/contracts/room.md`).
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

fn open(path: &Path, create: bool, busy: Duration) -> Result<Opened> {
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
    conn.busy_timeout(busy)?;
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
    match open(path, create, BUSY_TIMEOUT)? {
        Opened::Missing => Ok(None),
        Opened::Newer(v) => bail!(
            "{} has room schema version {v}, newer than this maru knows ({SCHEMA_VERSION}) — update AI Maru",
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
                kind TEXT NOT NULL,
                pty TEXT NOT NULL,
                session TEXT,
                quiet INTEGER NOT NULL DEFAULT 0,
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

struct Room {
    id: i64,
    name: String,
    topic: String,
    closed: bool,
}

/// 숫자면 방 id, 아니면 그 이름의 열린 방, 없으면 그 이름으로 마지막에 닫힌 방이다.
fn find_room(conn: &Connection, arg: &str) -> Result<Room> {
    let row = |r: &rusqlite::Row| {
        Ok(Room {
            id: r.get(0)?,
            name: r.get(1)?,
            topic: r.get(2)?,
            closed: r.get::<_, Option<i64>>(3)?.is_some(),
        })
    };
    let cols = "SELECT id, name, topic, closed_ms FROM rooms";
    let found = if is_id(arg) {
        conn.query_row(&format!("{cols} WHERE id = ?1"), [arg], row)
            .optional()?
    } else {
        conn.query_row(
            &format!("{cols} WHERE name = ?1 ORDER BY closed_ms IS NOT NULL, id DESC LIMIT 1"),
            [arg],
            row,
        )
        .optional()?
    };
    found.ok_or_else(|| no_room(arg))
}

fn no_room(arg: &str) -> anyhow::Error {
    anyhow!("방 {arg} 이 없다 — maru room list 로 열린 방을 본다")
}

fn last_seq(conn: &Connection, room: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM entries WHERE room = ?1",
        [room],
        |r| r.get(0),
    )?)
}

/// 마지막 사람 글 뒤에 올라간 AI 글 수. pass 와 close 는 세지 않는다. pass 는 상한에서도 올라간다. 불렸는데
/// 할 말이 없는 쪽이 비킬 수 있어야 하기 때문이다.
fn ai_streak(conn: &Connection, room: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE room = ?1 AND kind = 'post' AND author_kind = 'claude'
           AND seq > COALESCE((SELECT MAX(seq) FROM entries
                               WHERE room = ?1 AND kind = 'post' AND author_kind = 'human'), 0)",
        [room],
        |r| r.get(0),
    )?)
}

struct Member {
    name: String,
    kind: String,
    read_seq: i64,
}

fn member(conn: &Connection, room: i64, pty: &str) -> Result<Option<Member>> {
    Ok(conn
        .query_row(
            "SELECT name, kind, read_seq FROM participants WHERE room = ?1 AND pty = ?2",
            params![room, pty],
            |r| {
                Ok(Member {
                    name: r.get(0)?,
                    kind: r.get(1)?,
                    read_seq: r.get(2)?,
                })
            },
        )
        .optional()?)
}

fn me_here(conn: &Connection, room: i64) -> Result<Option<Member>> {
    match crate::env_var("MARU_PTY_ID") {
        Some(pty) => member(conn, room, &pty),
        None => Ok(None),
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
        "SELECT name, kind, quiet FROM participants WHERE room = ?1 ORDER BY kind = 'claude', joined_ms",
    )?;
    let names = stmt
        .query_map([room], |r| {
            let (name, kind, quiet): (String, String, bool) = (r.get(0)?, r.get(1)?, r.get(2)?);
            Ok(match (kind.as_str(), quiet) {
                ("human", _) => format!("{name}(사람)"),
                (_, true) => format!("{name}(알림 안 받음)"),
                _ => name,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(if names.is_empty() {
        "(아직 없음)".into()
    } else {
        names.join(", ")
    })
}

fn new(path: &Path, name: &str, topic: &str) -> Result<String> {
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
        bail!("열린 방 {name} 이 이미 있다 — 다른 이름을 쓰거나 maru room close {name} 로 닫는다");
    }
    tx.execute(
        "INSERT INTO rooms (name, topic, created_ms) VALUES (?1, ?2, ?3)",
        params![name, topic, now_ms()],
    )?;
    let id = tx.last_insert_rowid();
    tx.commit()?;
    Ok(format!(
        "방 {name} 을 열었다 (id {id}).\n\
         사람: maru room chat {name}\n\
         claude 세션: 그 pane 의 claude 에게 방 {name} 에 이름을 정해 들어가라고 하면 maru room join {name} --as <이름> 을 부른다.\n"
    ))
}

fn join(path: &Path, arg: &str, name: &str, quiet: bool) -> Result<String> {
    let pty = this_pty()?;
    let session = crate::env_var("CLAUDE_CODE_SESSION_ID").ok_or_else(|| {
        anyhow!("join 은 claude 세션의 Bash 에서 부른다(CLAUDE_CODE_SESSION_ID 가 없다) — 사람은 maru room chat {arg}")
    })?;
    if !crate::is_name(name) || name == HUMAN {
        bail!("--as 는 1–32 자의 영문·숫자·`_.+-` 이고 {HUMAN} 이 아니어야 한다 (got {name:?})");
    }
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    if room.closed {
        return Err(refuse(EXIT_CLOSED, format!("방 {} 은 닫혔다.", room.name)));
    }
    let here = member(&tx, room.id, &pty)?;
    if let Some(m) = &here
        && m.name != name
    {
        bail!(
            "이 pane 은 방 {} 에 이미 {} 로 들어 있다 — 그 이름으로 다시 join 하거나 maru room leave {} 뒤에 join 한다",
            room.name,
            m.name,
            room.name
        );
    }
    let held: Option<Option<String>> = tx
        .query_row(
            "SELECT session FROM participants WHERE room = ?1 AND name = ?2",
            params![room.id, name],
            |r| r.get(0),
        )
        .optional()?;
    match held {
        // 이 pane 의 참여이거나, 같은 세션을 다른 pane 에서 `--resume` 했다. 참여를 이 pane 으로 옮긴다.
        // 알림 없이 있던 동안 `room read` 로 읽은 글은 다시 알리지 않는다.
        Some(held) if here.is_some() || held.as_deref() == Some(session.as_str()) => {
            tx.execute(
                "UPDATE participants SET pty = ?3, session = ?4, quiet = ?5, notified_seq = MAX(notified_seq, read_seq)
                 WHERE room = ?1 AND name = ?2",
                params![room.id, name, pty, session, quiet],
            )?;
        }
        Some(_) => bail!(
            "방 {0} 에 {name} 이 이미 있다 — 다른 이름으로 들어간다. {name} 의 pane 이 닫혔으면 maru room leave {0} --as {name} 로 내보낸 뒤 들어간다",
            room.name
        ),
        None => {
            // 들어오기 전의 글은 알리지 않는다. 읽은 자리는 0 으로 두어 첫 `room read` 가 지난 글을 모두 보이게 한다.
            tx.execute(
                "INSERT INTO participants (room, name, kind, pty, session, quiet, notified_seq, read_seq, joined_ms)
                 VALUES (?1, ?2, 'claude', ?3, ?4, ?5, ?6, 0, ?7)",
                params![room.id, name, pty, session, quiet, last_seq(&tx, room.id)?, now_ms()],
            )?;
        }
    }
    let notice = notice(&tx, &room, name, quiet)?;
    tx.commit()?;
    Ok(notice)
}

/// join 이 찍는 안내문이다. claude 의 컨텍스트에 들어간다. `@` 를 넣지 않는다. Claude Code 가 `@` 뒤를 파일·agent
/// 참조로 읽기 때문이다.
fn notice(conn: &Connection, room: &Room, me: &str, quiet: bool) -> Result<String> {
    let r = &room.name;
    let topic = if room.topic.is_empty() {
        String::new()
    } else {
        format!("주제: {}\n", room.topic)
    };
    let others = participants_text(conn, room.id)?;
    let wake = if quiet {
        format!(
            "너는 알림을 받지 않는다. 사람이 이 터미널에서 방을 보라고 하거나 하던 일이 한 단락 끝났을 때 maru room read {r} 로 읽는다."
        )
    } else {
        format!(
            "방에 새 글이 오면 monitor 알림({{\"event\":\"room\",\"room\":\"{r}\",…}})이 온다. 알림에는 글 내용이 없다. 새 글은 누가 불렸든 글쓴이를 뺀, 알림 받는 참여자 모두에게 알려진다."
        )
    };
    Ok(format!(
        "방 {r} 에 {me} 로 들어왔다.\n\
         {topic}참여자: {others}\n\
         \n\
         이 터미널은 방이 아니다. 여기에 쓴 답은 방의 누구도 읽지 않는다. 방에 할 말은 maru room post 로만 올린다.\n\
         {wake}\n\
         \n\
         읽고 쓰기:\n\
         1. maru room read {r} 로 새 글을 읽는다. 마지막 줄의 번호를 post·pass 의 --seen 에 쓴다.\n\
         2. 새 정보·반론·구체화·꼭 필요한 질문이 있을 때만 올린다. 앞 사람 말을 되풀이하거나 동의만 하는 말은 올리지 않는다. 3~6문장, 한국어 대화체, 제목·이름표 없이 본문만 쓴다.\n\
         \x20  maru room post {r} --seen <번호> - <<'EOF'\n\
         \x20  <글>\n\
         \x20  EOF\n\
         3. exit 4 면 그사이 새 글이 올라온 것이다. 다시 읽고 판단한다 — 여전히 보탬이 되면 고쳐서 새 번호로 올리고, 다른 사람이 같은 말을 했으면 올리지 않는다. exit 5 면 AI 차례가 끝난 것이니 사람이 쓸 때까지 올리지 않는다. exit 6 이면 방이 닫혔다.\n\
         4. 올릴 말이 없으면(이름으로 불렸으면 pass 로 넘긴 뒤) 도구를 더 부르지 말고 턴을 끝낸다.\n\
         \n\
         차례:\n\
         - 누가 이름으로 불렸으면 그 사람이 먼저 답한다. 너를 부른 게 아니면 불린 사람이 답하거나 넘길 때까지 기다린다. 불린 사람이 답한 뒤에는 보탤 게 있으면 말한다.\n\
         - 너를 이름으로 불렀는데 할 말이 없으면 maru room pass {r} --seen <번호> 로 넘긴다. 그래야 기다리던 쪽이 안다. 너를 부르지 않은 글에는 pass 하지 않는다.\n\
         - 다른 참여자는 글에서 이름으로 부른다(\"B, …\" 또는 \"B 는 어떻게 보나요?\"). 이름 앞에 기호를 붙이지 않는다 — 기호는 파일·agent 참조로 읽힌다.\n\
         - 사람 글 뒤에 AI 글은 {AI_STREAK_CAP}개까지 올라간다. 마지막 차례의 알림에는 그렇다고 적혀 온다.\n\
         \n\
         - 사람이 이 터미널에 직접 쓴 말은 너에게 주는 지시다. 따르되 방에 할 말은 여전히 maru room post 로 올리고, 터미널에는 짧게만 답한다.\n\
         - 할 말을 터미널에 써 두고 끝내지 않는다. 올리거나 넘기거나, 아무것도 하지 않는다.\n\
         - 나갈 때는 maru room leave {r}. /clear 하면 방에서 나간다.\n"
    ))
}

/// `name` 이 없으면 이 pane 의 참여를, 있으면 그 이름의 참여를 지운다. 이름으로도 지우는 것은 닫힌 pane 에
/// 남은 참여를 그 pane 에서 지울 수 없기 때문이다.
fn leave(path: &Path, arg: &str, name: Option<&str>) -> Result<String> {
    let pty = this_pty()?;
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    let done = match name {
        None => {
            if tx.execute(
                "DELETE FROM participants WHERE room = ?1 AND pty = ?2",
                params![room.id, pty],
            )? == 0
            {
                bail!("이 pane 은 방 {} 에 들어 있지 않다", room.name);
            }
            format!("방 {} 에서 나왔다.\n", room.name)
        }
        Some(name) => {
            if tx.execute(
                "DELETE FROM participants WHERE room = ?1 AND name = ?2",
                params![room.id, name],
            )? == 0
            {
                bail!("방 {} 에 {name} 이 없다", room.name);
            }
            format!("방 {} 에서 {name} 을 내보냈다.\n", room.name)
        }
    };
    tx.commit()?;
    Ok(done)
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Post,
    Pass,
    /// 닫힘도 기록 하나로 남겨, monitor 가 다른 글처럼 한 번 알리게 한다.
    Close,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Post => "post",
            Kind::Pass => "pass",
            Kind::Close => "close",
        }
    }
}

/// 커밋은 `commit_and_ring` 으로 한다. `ring` 을 거르면 지켜보는 쪽이 이 기록을 다음 기록이 올 때까지 모른다.
fn add_entry(
    tx: &Connection,
    room: i64,
    author: (&str, &str),
    kind: Kind,
    text: &str,
) -> Result<i64> {
    let seq = last_seq(tx, room)? + 1;
    tx.execute(
        "INSERT INTO entries (room, seq, author, author_kind, kind, text, at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![room, seq, author.0, author.1, kind.as_str(), text, now_ms()],
    )?;
    Ok(seq)
}

fn commit_and_ring(tx: rusqlite::Transaction, path: &Path) -> Result<()> {
    tx.commit()?;
    ring(path);
    Ok(())
}

fn append(path: &Path, arg: &str, kind: Kind, seen: i64, text: &str) -> Result<i64> {
    let pty = this_pty()?;
    if kind == Kind::Post && text.trim().is_empty() {
        bail!("the text is empty");
    }
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    let me = member(&tx, room.id, &pty)?.ok_or_else(|| {
        anyhow!(
            "이 pane 은 방 {0} 에 들어 있지 않다 — claude 세션은 maru room join {0} --as <이름>, 사람은 maru room chat {0} 으로 들어간다",
            room.name
        )
    })?;
    if room.closed {
        return Err(refuse(
            EXIT_CLOSED,
            format!("방 {} 은 닫혔다 — 더 올리지 않는다.", room.name),
        ));
    }
    let last = last_seq(&tx, room.id)?;
    if seen != last {
        let message = if seen > last {
            format!(
                "--seen {seen} 은 마지막 번호 #{last} 보다 크다 — maru room read {} 로 읽고 마지막 번호를 쓴다.",
                room.name
            )
        } else {
            let came = if last == seen + 1 {
                format!("#{last} 가")
            } else {
                format!("#{}~#{last} 가", seen + 1)
            };
            format!(
                "{came} 먼저 올라왔다 — maru room read {} 로 읽고 다시 판단한다.",
                room.name
            )
        };
        return Err(refuse(EXIT_SEEN, message));
    }
    if kind == Kind::Post && me.kind != HUMAN && ai_streak(&tx, room.id)? >= AI_STREAK_CAP {
        return Err(refuse(
            EXIT_CAPPED,
            format!("사람 글 뒤 AI 글이 {AI_STREAK_CAP}개라 {CAPPED}"),
        ));
    }
    let seq = add_entry(&tx, room.id, (&me.name, &me.kind), kind, text)?;
    // 자기 글은 읽었고 알릴 것도 아니다.
    tx.execute(
        "UPDATE participants SET read_seq = ?3, notified_seq = ?3 WHERE room = ?1 AND pty = ?2",
        params![room.id, pty, seq],
    )?;
    commit_and_ring(tx, path)?;
    Ok(seq)
}

struct Entry {
    seq: i64,
    author: String,
    kind: String,
    text: String,
    at_ms: i64,
}

fn entries_after(conn: &Connection, room: i64, after: i64) -> Result<Vec<Entry>> {
    let mut stmt = conn.prepare(
        "SELECT seq, author, kind, text, at_ms FROM entries WHERE room = ?1 AND seq > ?2 ORDER BY seq",
    )?;
    let rows = stmt
        .query_map(params![room, after], |r| {
            Ok(Entry {
                seq: r.get(0)?,
                author: r.get(1)?,
                kind: r.get(2)?,
                text: r.get(3)?,
                at_ms: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn plain(e: &Entry) -> String {
    match e.kind.as_str() {
        "pass" => format!("#{} · {} 가 넘겼다", e.seq, e.author),
        "close" => format!("#{} · 방이 닫혔다", e.seq),
        _ => format!(
            "#{} {}  {}",
            e.seq,
            e.author,
            e.text.replace('\n', "\n    ")
        ),
    }
}

fn read(path: &Path, arg: &str, all: bool) -> Result<String> {
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    let me = me_here(&tx, room.id)?;
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
    } else {
        out.push_str(&format!("마지막 #{last} — 올릴 때 --seen {last}\n"));
    }
    if let Some(m) = &me {
        mark_read(&tx, room.id, &m.name, last)?;
    }
    tx.commit()?;
    Ok(out)
}

fn list(path: &Path, closed: bool) -> Result<String> {
    let mut out = String::from("ID\tNAME\tLAST\tPARTICIPANTS\tTOPIC\n");
    let Some(conn) = connect(path, false)? else {
        return Ok(out);
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT id, name, topic FROM rooms WHERE closed_ms IS {} NULL ORDER BY id",
        if closed { "NOT" } else { "" }
    ))?;
    let rooms = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, name, topic) in rooms {
        let row = [
            id.to_string(),
            name,
            format!("#{}", last_seq(&conn, id)?),
            participants_text(&conn, id)?,
            topic,
        ];
        out.push_str(&row.map(|v| crate::tsv_field(&v)).join("\t"));
        out.push('\n');
    }
    Ok(out)
}

fn close(path: &Path, arg: &str) -> Result<String> {
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    if room.closed {
        return Err(refuse(
            EXIT_CLOSED,
            format!("방 {} (id {}) 은 이미 닫혔다.", room.name, room.id),
        ));
    }
    let me = me_here(&tx, room.id)?;
    let author = me.as_ref().map_or(("", HUMAN), |m| (&m.name, &m.kind));
    add_entry(&tx, room.id, author, Kind::Close, "")?;
    tx.execute(
        "UPDATE rooms SET closed_ms = ?2 WHERE id = ?1",
        params![room.id, now_ms()],
    )?;
    commit_and_ring(tx, path)?;
    Ok(format!(
        "방 {} 을 닫았다 (id {}). 글은 maru room read {} --all 로 읽는다.\n",
        room.name, room.id, room.id
    ))
}

/// SessionStart hook 이 부른다. 이 pty 의 참여 가운데 지금 세션이 아닌 것을 지운다 — `/clear` 나 같은 pane
/// 에서 새로 띄운 claude 는 방에서 나간다. 파일이 없거나 모르는 버전이면 건드리지 않는다.
pub fn forget_other_sessions(pty: &str, session: &str) -> Result<()> {
    // claude 가 이 hook 을 기다리며 뜬다. 오래 잠겨 있으면 정리를 거른다.
    let Opened::Ready(conn) = open(&db_path()?, false, Duration::from_millis(500))? else {
        return Ok(());
    };
    conn.execute(
        "DELETE FROM participants WHERE pty = ?1 AND session IS NOT ?2",
        params![pty, session],
    )?;
    Ok(())
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
        "SELECT p.room, r.name, p.name, p.notified_seq FROM participants p JOIN rooms r ON r.id = p.room
         WHERE p.pty = ?1 AND p.kind = 'claude' AND NOT p.quiet
           AND EXISTS (SELECT 1 FROM entries e WHERE e.room = p.room AND e.seq > p.notified_seq)
         ORDER BY p.room",
    )?;
    let rows = stmt
        .query_map([pty], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut out = Vec::new();
    for (room, room_name, name, notified) in rows {
        let all = entries_after(conn, room, notified)?;
        let seq = all.last().map_or(notified, |e| e.seq);
        let news: Vec<&Entry> = all.iter().filter(|e| e.author != name).collect();
        let event = if news.is_empty() {
            None
        } else {
            Some(event(&room_name, &news, ai_streak(conn, room)?))
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

fn event(room: &str, news: &[&Entry], streak: i64) -> Value {
    let first = news[0].seq;
    let last = news[news.len() - 1];
    let mut from: Vec<&str> = Vec::new();
    for e in news {
        if !e.author.is_empty() && !from.contains(&e.author.as_str()) {
            from.push(&e.author);
        }
    }
    let from = from.join(", ");
    let closed = news.iter().any(|e| e.kind == "close");
    let kind = if closed { "close" } else { last.kind.as_str() };
    let mut text = if closed {
        format!("방이 닫혔다 ({room}) — 더 올리지 않는다.")
    } else if news.len() > 1 {
        format!(
            "방 {room} 에 새 기록 #{first}~#{} (보낸 이: {from}) — maru room read {room} 로 읽는다.",
            last.seq
        )
    } else if kind == "pass" {
        format!(
            "방 {room} 에서 {from} 가 넘겼다 (#{}) — maru room read {room} 로 읽는다.",
            last.seq
        )
    } else {
        format!(
            "방 {room} 에 새 글 #{} (보낸 이: {from}) — maru room read {room} 로 읽는다.",
            last.seq
        )
    };
    if !closed {
        if streak == AI_STREAK_CAP - 1 {
            text = format!("{text} {LAST_TURN}");
        } else if streak >= AI_STREAK_CAP {
            text = format!("{text} {CAPPED}");
        }
    }
    let mut ev = json!({ "event": "room", "room": room, "seq": last.seq, "from": from, "kind": kind, "text": text });
    if news.len() > 1 {
        ev["first"] = first.into();
    }
    ev
}

/// 기록을 더한 쪽이 커밋한 뒤 건드리는 파일. 지켜보는 쪽(monitor·chat)은 이 파일이 바뀌면 방 파일을 다시 읽는다.
///
/// `-wal` 을 지켜보면 커밋이 보이기 전에 깨어, 그 기록의 알림이 다음 기록까지 밀린다. sqlite 가 프레임을 `-wal` 에
/// 쓴 뒤 `-shm` 의 머리를 갱신하는 사이에 읽기 때문으로 보인다(sqlite 소스로 확인하지 않았다).
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
            match open(&self.path, false, BUSY_TIMEOUT) {
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
