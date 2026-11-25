//! `maru room chat` — 사람이 pane 에서 방에 참여하는 화면. 위로 기록이 쌓이고 아래 입력줄에서 Enter 로 올린다.
//!
//! 새 기록은 다른 스레드가 방 파일을 지켜보다 rustyline 의 external printer 로 입력줄 위에 찍는다. 자기 글도
//! 그 스레드가 찍는다. 다음 글의 `--seen` 은 찍힌 마지막 번호와 이 화면이 마지막에 올린 번호 가운데 큰 것이다.

use super::{
    EXIT_CLOSED, EXIT_SEEN, Entry, HUMAN, Kind, Refusal, Room, State, Watch, append, connect,
    entries_after, find_room, last_seq, mark_read, member, no_room, now_ms, participants_text,
    refuse, this_pty,
};
use anyhow::{Result, bail};
use nix::sys::event::{EvFlags, EventFilter, FilterFlag, KEvent, Kqueue};
use rusqlite::{Connection, TransactionBehavior, params};
use rustyline::error::ReadlineError;
use rustyline::{DefaultEditor, ExternalPrinter};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

const PROMPT: &str = "나> ";
const BACKLOG: usize = 20;

pub fn run(path: &Path, arg: &str) -> Result<()> {
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        bail!("maru room chat 은 터미널에서 띄운다 — 스크립트에서는 maru room read·post 를 쓴다");
    }
    let pty = this_pty()?;
    let mut conn = connect(path, false)?.ok_or_else(|| no_room(arg))?;
    let joined = join_human(&mut conn, arg, &pty)?;
    let room = joined.id;

    let entries = entries_after(&conn, room, 0)?;
    let mut out = format!("\x1b[2m{}\x1b[0m\n\n", header(&conn, &joined)?);
    if entries.len() > BACKLOG {
        out.push_str(&format!(
            "\x1b[2m(앞의 기록 {}개는 maru room read {room} --all)\x1b[0m\n\n",
            entries.len() - BACKLOG
        ));
    }
    for e in &entries[entries.len().saturating_sub(BACKLOG)..] {
        out.push_str(&show(e));
    }
    print!("{out}");
    std::io::stdout().flush()?;
    let shown = Arc::new(AtomicI64::new(entries.last().map_or(0, |e| e.seq)));
    drop(conn);

    let mut rl = DefaultEditor::new()?;
    let printer = rl.create_external_printer()?;
    {
        let (path, shown) = (path.to_owned(), shown.clone());
        std::thread::spawn(move || follow(path, room, shown, printer));
    }

    let mut initial = String::new();
    let mut posted = 0;
    loop {
        let line = match rl.readline_with_initial(PROMPT, (&initial, "")) {
            Ok(line) => line,
            Err(ReadlineError::Eof | ReadlineError::Interrupted) => break,
            Err(e) => return Err(e.into()),
        };
        erase_echo(&line);
        initial.clear();
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        // 자기 글은 지켜보는 스레드가 찍기 전에도 본 것으로 친다. 곧바로 다음 줄을 올려도 거절되지 않게 하기 위해서다.
        let seen = shown.load(Ordering::SeqCst).max(posted);
        let e = match append(path, &room.to_string(), Kind::Post, seen, text) {
            Ok(seq) => {
                posted = seq;
                continue;
            }
            Err(e) => e,
        };
        match e.downcast_ref::<Refusal>() {
            Some(r) if r.code == EXIT_CLOSED => {
                println!("\x1b[2m{r}\x1b[0m");
                break;
            }
            // 그사이 올라온 글은 지켜보는 스레드가 찍는다. 쓴 글은 입력줄에 되돌린다.
            Some(r) if r.code == EXIT_SEEN => {
                println!("\x1b[2m새 글이 먼저 올라왔다 — 읽고 Enter 로 다시 올린다.\x1b[0m")
            }
            _ => println!("\x1b[31m{e:#}\x1b[0m"),
        }
        initial = text.to_owned();
    }
    Ok(())
}

/// 이 pane 을 사람 참여자로 넣는다. 사람은 방에 하나이므로, 다른 pane 에서 들어와 있었으면 이 pane 으로 옮긴다.
fn join_human(conn: &mut Connection, arg: &str, pty: &str) -> Result<Room> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let room = find_room(&tx, arg)?;
    if room.closed {
        return Err(refuse(
            EXIT_CLOSED,
            format!(
                "방 {} 은 닫혔다 — maru room read {} --all 로 읽는다.",
                room.name, room.id
            ),
        ));
    }
    if let Some(m) = member(&tx, room.id, pty)?
        && m.name != HUMAN
    {
        bail!(
            "이 pane 은 방 {} 에 {} 로 들어 있다 — 사람 화면은 다른 pane 에서 띄운다",
            room.name,
            m.name
        );
    }
    let last = last_seq(&tx, room.id)?;
    tx.execute(
        "INSERT INTO participants (room, name, kind, pty, session, quiet, notified_seq, read_seq, joined_ms)
         VALUES (?1, ?2, 'human', ?3, NULL, 1, ?4, ?4, ?5)
         ON CONFLICT (room, name) DO UPDATE SET pty = excluded.pty",
        params![room.id, HUMAN, pty, last, now_ms()],
    )?;
    tx.commit()?;
    Ok(room)
}

fn header(conn: &Connection, room: &Room) -> Result<String> {
    let topic = if room.topic.is_empty() {
        String::new()
    } else {
        format!(" · 주제: {}", printable(&room.topic))
    };
    Ok(format!(
        "방: {}{topic} · 참여: {} · 이름으로 부르면 그 사람이 먼저 답한다 · Ctrl-D 로 화면을 닫는다",
        room.name,
        printable(&participants_text(conn, room.id)?)
    ))
}

fn follow(path: PathBuf, room: i64, shown: Arc<AtomicI64>, mut printer: impl ExternalPrinter) {
    let Ok(kq) = Kqueue::new() else { return };
    let mut watch = Watch::new(&kq, path);
    let idle = KEvent::new(
        0,
        EventFilter::EVFILT_USER,
        EvFlags::empty(),
        FilterFlag::empty(),
        0,
        0,
    );
    let mut events = [idle; 4];
    loop {
        if let State::Ready(conn) = watch.state(&kq)
            && let Ok(fresh) = entries_after(conn, room, shown.load(Ordering::SeqCst))
            && let Some(last) = fresh.last()
        {
            // 번호는 찍은 뒤에 올린다. 입력 쪽이 찍히지 않은 글의 번호를 `--seen` 으로 쓰지 않게 하기 위해서다.
            // `print` 는 입력줄이 받아 갈 때까지 막힐 수 있으므로, 입력 쪽이 기다리는 잠금을 쥐고 부르지 않는다.
            if printer.print(fresh.iter().map(show).collect()).is_err() {
                return;
            }
            shown.store(last.seq, Ordering::SeqCst);
            let _ = mark_read(conn, room, HUMAN, last.seq);
        }
        if kq.kevent(&[], &mut events, None).is_err() {
            return;
        }
    }
}

const COLORS: [&str; 5] = ["36", "35", "33", "34", "91"];

fn color(author: &str) -> &'static str {
    if author == HUMAN {
        return "32";
    }
    let h = author
        .bytes()
        .fold(0usize, |h, b| h.wrapping_mul(31).wrapping_add(b as usize));
    COLORS[h % COLORS.len()]
}

fn show(e: &Entry) -> String {
    let time = clock(e.at_ms);
    match e.kind.as_str() {
        "pass" => format!(
            "\x1b[2m· {} 가 넘겼다 #{} {time}\x1b[0m\n\n",
            e.author, e.seq
        ),
        "close" => format!(
            "\x1b[2m· 방이 닫혔다 #{} {time} — Ctrl-D 로 화면을 닫는다\x1b[0m\n\n",
            e.seq
        ),
        _ => format!(
            "\x1b[1;{}m{}\x1b[0m \x1b[2m#{} {time}\x1b[0m\n{}\n\n",
            color(&e.author),
            e.author,
            e.seq,
            printable(&e.text)
        ),
    }
}

/// 글의 제어 문자를 공백으로 찍는다. 글 안의 ESC 가 사람의 터미널에서 색·OSC 로 실행되지 않게 하기 위해서다.
fn printable(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .collect()
}

fn clock(at_ms: i64) -> String {
    use nix::libc;
    let t = (at_ms / 1000) as libc::time_t;
    // SAFETY: `localtime_r` 는 넘긴 두 포인터만 읽고 쓴다.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    if unsafe { libc::localtime_r(&t, &mut tm) }.is_null() {
        return String::new();
    }
    format!("{:02}:{:02}:{:02}", tm.tm_hour, tm.tm_min, tm.tm_sec)
}

/// Enter 뒤 터미널에 남은 입력줄을 지운다. 올린 글은 지켜보는 스레드가 이름과 함께 다시 찍는다.
fn erase_echo(line: &str) {
    let rows = echo_rows(line, columns().max(1));
    print!("\x1b[{rows}A\r\x1b[J");
    let _ = std::io::stdout().flush();
}

/// 프롬프트와 입력이 터미널에서 차지한 줄 수. 붙여 넣은 줄바꿈과, 넓은 글자가 줄 끝에 들어가지 않아 넘어간 줄을 센다.
fn echo_rows(line: &str, cols: usize) -> usize {
    let mut rows = 1;
    let mut col = PROMPT.width();
    for c in line.chars() {
        if c == '\n' {
            rows += 1;
            col = 0;
            continue;
        }
        let w = c.width().unwrap_or(0);
        if col + w > cols {
            rows += 1;
            col = 0;
        }
        col += w;
    }
    rows
}

fn columns() -> usize {
    use nix::libc;
    // SAFETY: TIOCGWINSZ 는 넘긴 `winsize` 만 채운다.
    let mut ws: libc::winsize = unsafe { std::mem::zeroed() };
    if unsafe { libc::ioctl(libc::STDOUT_FILENO, libc::TIOCGWINSZ, &mut ws) } == 0 && ws.ws_col > 0
    {
        ws.ws_col as usize
    } else {
        80
    }
}

#[cfg(test)]
mod tests {
    use super::echo_rows;

    #[test]
    fn echo_rows_counts_pasted_newlines_and_wide_chars_pushed_to_the_next_row() {
        // 프롬프트 `나> ` 는 4칸이다.
        assert_eq!(echo_rows("", 10), 1);
        assert_eq!(echo_rows("abcdef", 10), 1);
        assert_eq!(echo_rows("abcdefg", 10), 2);
        assert_eq!(echo_rows("첫 줄\n둘째 줄", 80), 2);
        // 9칸까지 찬 줄에 넓은 글자는 들어가지 않고 다음 줄로 넘어간다.
        assert_eq!(echo_rows("abcde가", 10), 2);
        assert_eq!(echo_rows("abcd가", 10), 1);
    }
}
