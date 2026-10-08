//! 앱이 띄운 터미널 안에서 앱에 요청을 보내는 CLI.
//!
//! 앱은 세션을 띄울 때 셸에 다음을 넣는다. 둘 중 하나라도 없으면 앱 터미널 밖이다.
//!
//! - `MARU_SOCKET` — 앱이 듣는 유닉스 도메인 소켓 경로
//! - `MARU_SESSION_ID` — 그 터미널의 세션 id
//!
//! 앱의 zsh 함수와 claude plugin 이 쓰는 값도 넣는다.
//!
//! - `MARU_CLI` — 이 빌드의 `maru` 절대경로. PATH 에서 찾으면 이름이 같은 다른 CLI 가 불릴 수 있다.
//! - `MARU_CLAUDE_PLUGIN` — claude 에 `--plugin-dir` 로 싣는 앱 plugin 디렉토리
//!
//! # 프로토콜
//!
//! 줄 단위 JSON-RPC 2.0 이다. 연결 하나에 요청 한 줄(`\n` 까지, 줄바꿈 없이 EOF 면 거기까지)을
//! 보내고 응답 한 줄을 받으면 앱이 연결을 닫는다. 요청 한 줄은 16 MiB 까지다. `id` 가 없는
//! 요청(notification)은 실행만 하고 답 없이 닫는다. batch 는 받지 않는다. 10초 동안 오가는 것이
//! 없으면 앱이 연결을 끊는다. `monitor.subscribe` 만 다르다(아래).
//!
//! 모든 요청의 `params` 는 객체이고 `protocol_version`·`session`(세션 id)을 싣는다.
//!
//! ```text
//! → {"jsonrpc":"2.0","id":1,"method":"ping","params":{"protocol_version":1,"session":"s-1a2b3c4d"}}
//! ← {"jsonrpc":"2.0","id":1,"result":{"session":"s-1a2b3c4d"}}
//! ```
//!
//! 실패는 표준 `error.code` 에 앱이 정한 이유를 `error.data.code` 문자열로 붙인다.
//!
//! | 경우 | `error.code` | `data.code` |
//! |---|---|---|
//! | JSON 이 아님 | -32700 | `parse_error` |
//! | 요청 모양이 아님(`params` 가 객체가 아님 포함)·batch·`id` 가 없는 `monitor.subscribe` | -32600 | `invalid_request` |
//! | 줄바꿈 전에 16 MiB 를 넘음 | -32600 | `too_large` |
//! | `protocol_version` 이 다름 | -32000 | `protocol_mismatch` |
//! | 모르는 메서드 | -32601 | `unknown_method` |
//! | `params` 가 맞지 않음 | -32602 | `invalid_params` |
//! | 처리 중 실패 | -32603 | `internal_error` |
//!
//! 버전은 메서드보다 먼저 검사한다. `protocol_mismatch` 의 `data` 는
//! `{"code":"protocol_mismatch","protocol_version":<앱의 버전>}` 이고, 이 모양은 버전을 올려도
//! 바꾸지 않는다.
//!
//! | 메서드 | `params`(공통 외) | `result` |
//! |---|---|---|
//! | `ping` | 없음 | `{"session":<받은 세션 id>}` |
//! | `canvas.put` | `text`(문자열), `id`(빈 문자열이 아닌 문자열, 선택), `title`(문자열, 선택) | `{"id":<문서 id>}` |
//! | `claude.hook` | `event`(문자열), `claude_session`(빈 문자열이 아닌 문자열), `config_dir`(절대경로 문자열), `source`(문자열, 선택) | `null` |
//! | `claude.exit` | 없음 | `null` |
//! | `inbox.push` | `to`(세션 id), `text`(빈 문자열이 아닌 문자열) | `null` |
//! | `inbox.read` | 없음 | `{"messages":[{"from":<보낸 세션 id>,"text":<본문>}…]}` |
//! | `monitor.subscribe` | `ancestors`(양의 정수 배열) | `null` |
//!
//! `canvas.put` 은 마크다운을 창의 Canvas 패널에 보인다. 같은 `id` 의 문서가 있으면 그 문서를 바꾸고,
//! `id` 가 없으면 앱이 새 id 를 만든다. id 는 형식 없는 문자열이다.
//!
//! `claude.hook` 은 그 터미널에서 돌고 있는 claude 의 hook 을 알린다. `event` 는 hook 이름
//! (`hook_event_name`)이고 앱은 모르는 이름을 받고 무시한다. `claude_session` 은 claude 의
//! `session_id`, `config_dir` 은 claude 가 `sessions/` 를 두는 디렉토리다. `source` 는 hook 입력에
//! `source`(`SessionStart` 의 `startup`·`compact` 등)가 있을 때만 그 값을 옮긴다. `claude.exit` 는 그
//! 터미널의 claude 가 끝났다고 알린다.
//!
//! `inbox.push` 는 `to` 세션에 메시지를 보낸다. `to` 가 `s-` 와 hex 8자리가 아니거나 그 세션이 끝났으면
//! `invalid_params` 다. `to` 를 구독하는 연결이 있으면 알림을 보내고, 본문이 알림에 다 실렸으면 읽은
//! 것으로 쳐서 보관하지 않는다. 그 밖의 메시지는 보관하고 `inbox.read` 가 오래된 것부터 돌려준 뒤
//! 지운다. 보관은 앱 메모리에만 한다.
//!
//! `monitor.subscribe` 는 `result` 를 보낸 뒤 연결을 닫지 않고, 알림이 생길 때마다
//! `{"jsonrpc":"2.0","method":"monitor.event","params":<알림>}` 한 줄을 보낸다. 이 연결은 10초 끊기가
//! 없고, 어느 쪽이든 닫으면 구독이 풀린다. `ancestors` 는 구독하는 프로세스의 부모부터 위로 올라간 pid
//! 들이고, 그 세션의 셸 pid 가 없으면 `invalid_params` 로 거절한다. 알림은 `event` 로 종류를 가리는
//! 객체다. inbox 의 알림은 `{"event":"inbox","from":<보낸 세션 id>,"body":<본문>}` 이고, 본문이 240 코드
//! 포인트를 넘으면 앞 240 만 싣고 `"truncated":true` 와 `"note"`(`maru inbox read` 안내)를 붙인다.
//!
//! # claude monitor
//!
//! 앱 claude plugin 의 `monitors/monitors.json` 이 대화형 claude 마다 `maru claude monitor` 를 띄운다.
//! Claude Code 는 이 프로세스의 stdout 한 줄마다 claude 에 알리고, 쉬는 claude 도 그 줄을 받아 새
//! 응답을 시작한다. 그래서 알릴 것이 없으면 시작할 때도 stdout 에 아무것도 쓰지 않는다.
//!
//! monitor 는 `monitor.subscribe` 로 앱에 붙어, 받은 알림 객체를 한 줄씩 stdout 에 쓴다.
//!
//! 종료 신호를 받거나 stdout 의 상대가 닫히면 끝난다. claude 는 정상으로 끝날 때 SIGTERM 을 보내지만,
//! 신호 없이 죽으면(SIGKILL 등) monitor 에 남는 흔적은 stdout 이 닫히는 것뿐이다.

use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand};
use nix::errno::Errno;
use nix::sys::event::{EventFilter, EventFlag, FilterFlag, KEvent, Kqueue};
use serde_json::{Map, Value, json};
use std::fs::File;
use std::io::{BufRead, BufReader, ErrorKind, IsTerminal, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

const PROTOCOL_VERSION: u64 = 1;
const TIMEOUT: Duration = Duration::from_secs(10);
// 앱이 받는 요청 한 줄의 상한이다. escape 하면 줄은 입력보다 길어지므로, 이보다 큰 입력은 보내도 거절된다.
const MAX_LINE: u64 = 16 * 1024 * 1024;
// 조상을 따라 올라가는 횟수의 상한. 프로세스 표가 도중에 바뀌어도 끝나게.
const MAX_ANCESTORS: usize = 64;

/// Send requests to the AI Maru app from one of its terminals.
#[derive(Parser)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Check that the app answers.
    Ping,
    /// Work with the Canvas panel.
    Canvas {
        #[command(subcommand)]
        command: CanvasCommand,
    },
    /// Exchange messages with other AI Maru terminals.
    Inbox {
        #[command(subcommand)]
        command: InboxCommand,
    },
    /// Report a claude running in this terminal. The app's zsh function and claude plugin
    /// call these.
    #[command(hide = true)]
    Claude {
        #[command(subcommand)]
        command: ClaudeCommand,
    },
}

#[derive(Subcommand)]
enum ClaudeCommand {
    /// Forward the claude hook payload on stdin.
    Hook,
    /// Say that claude has exited.
    Exit,
    /// Write the app's notifications to stdout, one per line, until stdout closes. The app's
    /// claude plugin runs this as a monitor.
    Monitor,
}

#[derive(Subcommand)]
enum InboxCommand {
    /// Send a message to another terminal session.
    ///
    /// Reads MESSAGE, or stdin when MESSAGE is omitted or `-`. A claude running in that
    /// terminal gets it as a notification, cut after 240 characters; `maru inbox read` there
    /// shows the whole message.
    Push {
        /// Session id of the receiving terminal, e.g. s-1a2b3c4d.
        session: String,
        /// Message text. It may start with `-`.
        #[arg(allow_hyphen_values = true)]
        message: Option<String>,
    },
    /// Print the unread messages sent to this terminal and mark them read.
    Read,
}

#[derive(Subcommand)]
enum CanvasCommand {
    /// Show markdown in the Canvas panel. With --id, replaces the document with that id if
    /// there is one.
    ///
    /// Reads FILE, or stdin when FILE is omitted or `-`. Prints the document's id; pass it
    /// back with --id to replace that document.
    Put {
        /// Replace the document with this id, or add the document under this id.
        #[arg(long)]
        id: Option<String>,
        /// Title in the panel's list, shown instead of the first heading.
        #[arg(long)]
        title: Option<String>,
        /// Markdown file to show.
        file: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(e) => {
            let _ = e.print();
            return if e.use_stderr() {
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            };
        }
    };
    match run(cli.command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            // 띄운 쪽이 stderr 를 닫았으면 `eprintln!` 은 패닉한다.
            let _ = writeln!(std::io::stderr(), "maru: {e:#}");
            ExitCode::FAILURE
        }
    }
}

fn run(command: Command) -> Result<()> {
    match command {
        Command::Ping => {
            let result = call(&target()?, "ping", Map::new())?;
            let session = result["session"]
                .as_str()
                .ok_or_else(|| anyhow!("the app answered without a session: {result}"))?;
            writeln!(std::io::stdout(), "pong (session {session})")?;
        }
        Command::Canvas {
            command: CanvasCommand::Put { id, title, file },
        } => {
            let id = canvas_put(id, title, file)?;
            writeln!(std::io::stdout(), "{id}")?;
        }
        Command::Inbox { command } => match command {
            InboxCommand::Push { session, message } => inbox_push(session, message)?,
            InboxCommand::Read => inbox_read()?,
        },
        Command::Claude { command } => match command {
            ClaudeCommand::Hook => claude_hook()?,
            ClaudeCommand::Exit => {
                call(&target()?, "claude.exit", Map::new())?;
            }
            ClaudeCommand::Monitor => claude_monitor()?,
        },
    }
    Ok(())
}

fn claude_hook() -> Result<()> {
    let target = target()?;
    let payload: Value = serde_json::from_reader(std::io::stdin().lock())
        .map_err(|e| anyhow!("stdin is not a hook payload: {e}"))?;
    let field = |name: &str| -> Result<Value> {
        match &payload[name] {
            Value::String(s) if !s.is_empty() => Ok(s.as_str().into()),
            _ => bail!("the hook payload has no {name}"),
        }
    };
    let mut params = Map::new();
    params.insert("event".into(), field("hook_event_name")?);
    params.insert("claude_session".into(), field("session_id")?);
    params.insert("config_dir".into(), claude_config_dir()?.into());
    if let Some(source @ Value::String(_)) = payload.get("source") {
        params.insert("source".into(), source.clone());
    }
    call(&target, "claude.hook", params)?;
    // SessionStart hook 의 stdout 은 claude 의 컨텍스트에 들어간다.
    if payload["hook_event_name"] == "SessionStart" {
        write!(
            std::io::stdout(),
            "You are in AI Maru terminal session {}. Messages from other sessions arrive as\n\
             monitor notifications. Send: `maru inbox push <session> <message>`. Unread: `maru inbox read`.\n",
            target.session
        )?;
    }
    Ok(())
}

fn claude_monitor() -> Result<()> {
    // 앱 터미널의 환경이 없으면 알릴 것도 없다.
    let Ok(target) = target() else {
        return Ok(());
    };
    // macOS 의 poll 은 쓰기를 기다리지 않으면 pipe·socket 의 상대가 닫힌 것을 알리지 않는다.
    let kq = Kqueue::new().context("cannot create a kqueue")?;
    watch(&kq, 1, EventFilter::EVFILT_WRITE).context("cannot watch stdout")?;
    let mut app = match subscribe(&target) {
        Ok(Some(app)) => Some(app),
        Ok(None) => return Ok(()),
        Err(_) => None,
    };
    if let Some(a) = &mut app {
        watch(&kq, a.stream.as_raw_fd() as usize, EventFilter::EVFILT_READ)
            .context("cannot watch the app")?;
        if a.write_events() == Flow::StdoutClosed {
            return Ok(());
        }
    }
    let idle = KEvent::new(
        0,
        EventFilter::EVFILT_WRITE,
        EventFlag::empty(),
        FilterFlag::empty(),
        0,
        0,
    );
    let mut events = [idle; 2];
    loop {
        let n = match kq.kevent(&[], &mut events, None) {
            Ok(n) => n,
            Err(Errno::EINTR) => continue,
            Err(e) => return Err(e).context("cannot watch stdout"),
        };
        for ev in &events[..n] {
            if ev.ident() == 1 {
                if ev.flags().contains(EventFlag::EV_EOF) {
                    return Ok(());
                }
            } else if let Some(a) = &mut app {
                match a.read() {
                    Flow::Open => {}
                    // 닫은 fd 는 kqueue 에서도 빠진다.
                    Flow::AppClosed => app = None,
                    Flow::StdoutClosed => return Ok(()),
                }
            }
        }
    }
}

fn watch(kq: &Kqueue, fd: usize, filter: EventFilter) -> nix::Result<()> {
    let ev = KEvent::new(
        fd,
        filter,
        EventFlag::EV_ADD | EventFlag::EV_CLEAR,
        FilterFlag::empty(),
        0,
        0,
    );
    kq.kevent(&[ev], &mut [], None).map(|_| ())
}

/// 앱이 구독을 받으면 그 연결을, 거절하면 `None` 을 돌려준다.
fn subscribe(target: &Target) -> Result<Option<App>> {
    let stream = connect(target)?;
    let mut params = Map::new();
    params.insert("ancestors".into(), ancestors().into());
    (&stream).write_all(request_line(target, "monitor.subscribe", params).as_bytes())?;
    let mut reader = BufReader::new(&stream);
    let mut reply = String::new();
    if reader.read_line(&mut reply)? == 0 {
        bail!("the app closed the connection without answering");
    }
    // 응답 뒤에 붙어 온 알림도 잃지 않게.
    let rest = reader.buffer().to_vec();
    if answer(&reply).is_err() {
        return Ok(None);
    }
    stream.set_nonblocking(true)?;
    Ok(Some(App { stream, buf: rest }))
}

#[derive(PartialEq)]
enum Flow {
    Open,
    AppClosed,
    StdoutClosed,
}

struct App {
    stream: UnixStream,
    buf: Vec<u8>,
}

impl App {
    fn read(&mut self) -> Flow {
        let mut chunk = [0u8; 65536];
        loop {
            match (&self.stream).read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => self.buf.extend_from_slice(&chunk[..n]),
                Err(e) if e.kind() == ErrorKind::WouldBlock => return self.write_events(),
                Err(e) if e.kind() == ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
        match self.write_events() {
            Flow::StdoutClosed => Flow::StdoutClosed,
            _ => Flow::AppClosed,
        }
    }

    fn write_events(&mut self) -> Flow {
        let mut out = std::io::stdout().lock();
        while let Some(i) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=i).collect();
            let Ok(msg) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            if msg["method"] != "monitor.event" {
                continue;
            }
            if writeln!(out, "{}", msg["params"])
                .and_then(|()| out.flush())
                .is_err()
            {
                return Flow::StdoutClosed;
            }
        }
        Flow::Open
    }
}

fn ancestors() -> Vec<u32> {
    let mut pids = Vec::new();
    let mut pid = std::os::unix::process::parent_id();
    while pid > 1 && pids.len() < MAX_ANCESTORS {
        pids.push(pid);
        match parent_of(pid) {
            Some(parent) => pid = parent,
            None => break,
        }
    }
    pids
}

fn parent_of(pid: u32) -> Option<u32> {
    use nix::libc;
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    // SAFETY: info 는 size 바이트짜리 버퍼이고, 커널이 다 채웠을 때만 읽는다.
    let n = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    // SAFETY: 위에서 size 바이트를 다 채웠다.
    (n == size).then(|| unsafe { info.assume_init() }.pbi_ppid)
}

fn claude_config_dir() -> Result<String> {
    let dir = match env_var("CLAUDE_CONFIG_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(env_var("HOME").ok_or_else(|| anyhow!("HOME is not set"))?)
            .join(".claude"),
    };
    let dir =
        std::path::absolute(&dir).with_context(|| format!("cannot resolve {}", dir.display()))?;
    dir.into_os_string()
        .into_string()
        .map_err(|_| anyhow!("the claude config directory is not UTF-8"))
}

fn canvas_put(id: Option<String>, title: Option<String>, file: Option<PathBuf>) -> Result<String> {
    if id.as_deref() == Some("") {
        bail!("--id must not be empty");
    }
    // 앱 터미널 밖이면 끝나지 않는 입력을 읽기 전에 실패해야 한다.
    let target = target()?;
    let (source, mut text) = match file.filter(|f| f.as_os_str() != "-") {
        Some(path) => {
            let source = path.display().to_string();
            let input = File::open(&path).with_context(|| format!("cannot read {source}"))?;
            let text = read_text(&source, input)?;
            (source, text)
        }
        None => (
            "stdin".to_owned(),
            read_stdin("give a FILE or pipe markdown into stdin, e.g. `maru canvas put note.md`")?,
        ),
    };
    // marked 는 BOM 뒤의 `#` 을 제목으로 읽지 않는다.
    if text.starts_with('\u{feff}') {
        text.drain(..'\u{feff}'.len_utf8());
    }
    if text.trim().is_empty() {
        bail!("{source} is empty");
    }
    let mut params = Map::new();
    params.insert("text".into(), text.into());
    if let Some(id) = id {
        params.insert("id".into(), id.into());
    }
    if let Some(title) = title {
        params.insert("title".into(), title.into());
    }
    let result = call(&target, "canvas.put", params)?;
    match result["id"].as_str() {
        Some(id) => Ok(id.to_owned()),
        None => bail!("the app answered without a document id: {result}"),
    }
}

fn read_text(source: &str, input: impl Read) -> Result<String> {
    let mut bytes = Vec::new();
    input
        .take(MAX_LINE + 1)
        .read_to_end(&mut bytes)
        .with_context(|| format!("cannot read {source}"))?;
    if bytes.len() as u64 > MAX_LINE {
        bail!("{source} is larger than the 16 MiB the app accepts");
    }
    String::from_utf8(bytes).map_err(|_| anyhow!("{source} is not UTF-8"))
}

fn read_stdin(hint: &str) -> Result<String> {
    let stdin = std::io::stdin();
    if stdin.is_terminal() {
        bail!("{hint}");
    }
    read_text("stdin", stdin)
}

fn inbox_push(to: String, message: Option<String>) -> Result<()> {
    // 앱 터미널 밖이면 끝나지 않는 입력을 읽기 전에 실패해야 한다.
    let target = target()?;
    let text = match message.filter(|m| m != "-") {
        Some(text) => text,
        None => read_stdin(
            "give a MESSAGE or pipe the message into stdin, e.g. `maru inbox push s-1a2b3c4d hello`",
        )?,
    };
    if text.trim().is_empty() {
        bail!("the message is empty");
    }
    let mut params = Map::new();
    params.insert("to".into(), to.into());
    params.insert("text".into(), text.into());
    call(&target, "inbox.push", params)?;
    Ok(())
}

fn inbox_read() -> Result<()> {
    let result = call(&target()?, "inbox.read", Map::new())?;
    let messages = result["messages"]
        .as_array()
        .ok_or_else(|| anyhow!("the app answered without messages: {result}"))?
        .iter()
        .map(|m| match (m["from"].as_str(), m["text"].as_str()) {
            (Some(from), Some(text)) => Ok((from, text)),
            _ => Err(anyhow!(
                "the app answered with a message it cannot print: {m}"
            )),
        })
        .collect::<Result<Vec<_>>>()?;
    if messages.is_empty() {
        writeln!(std::io::stderr(), "no unread messages")?;
        return Ok(());
    }
    let mut out = std::io::stdout().lock();
    for (from, text) in messages {
        writeln!(out, "--- from {from} ---")?;
        out.write_all(text.as_bytes())?;
        if !text.ends_with('\n') {
            writeln!(out)?;
        }
    }
    Ok(())
}

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

struct Target {
    socket: String,
    session: String,
}

fn target() -> Result<Target> {
    let (Some(socket), Some(session)) = (env_var("MARU_SOCKET"), env_var("MARU_SESSION_ID")) else {
        bail!("not inside an AI Maru terminal (MARU_SOCKET and MARU_SESSION_ID are not set)");
    };
    Ok(Target { socket, session })
}

fn request_line(target: &Target, method: &str, mut params: Map<String, Value>) -> String {
    params.insert("protocol_version".into(), PROTOCOL_VERSION.into());
    params.insert("session".into(), target.session.as_str().into());
    let request = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let mut line = request.to_string();
    line.push('\n');
    line
}

fn connect(target: &Target) -> Result<UnixStream> {
    let socket = &target.socket;
    let stream =
        UnixStream::connect(socket).with_context(|| format!("cannot reach the app at {socket}"))?;
    stream.set_read_timeout(Some(TIMEOUT))?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    Ok(stream)
}

fn call(target: &Target, method: &str, params: Map<String, Value>) -> Result<Value> {
    let stream = connect(target)?;

    (&stream)
        .write_all(request_line(target, method, params).as_bytes())
        .map_err(timed_out)
        .context("cannot send the request to the app")?;

    let mut reply = String::new();
    BufReader::new(&stream)
        .read_line(&mut reply)
        .map_err(timed_out)
        .context("cannot read the app's answer")?;
    if reply.is_empty() {
        bail!("the app closed the connection without answering");
    }
    answer(&reply)
}

fn answer(reply: &str) -> Result<Value> {
    let mut reply: Value = serde_json::from_str(reply)
        .with_context(|| format!("the app's answer is not JSON: {}", reply.trim_end()))?;

    if let Some(error) = reply.get("error") {
        let message = error["message"].as_str().unwrap_or("unknown error");
        if error["data"]["code"] == "protocol_mismatch" {
            let app = error["data"]["protocol_version"]
                .as_u64()
                .map_or("another version".into(), |v| format!("v{v}"));
            bail!("the app speaks protocol {app} but this CLI speaks v{PROTOCOL_VERSION}");
        }
        bail!("{message}");
    }
    match reply.get_mut("result") {
        Some(result) => Ok(result.take()),
        None => bail!("the app's answer has no result: {reply}"),
    }
}

fn timed_out(e: std::io::Error) -> anyhow::Error {
    // 읽기·쓰기 시간 초과는 플랫폼에 따라 WouldBlock 이나 TimedOut 으로 온다.
    if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) {
        anyhow!("the app did not answer within {}s", TIMEOUT.as_secs())
    } else {
        e.into()
    }
}
