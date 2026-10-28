//! 앱이 띄운 터미널 안에서 앱에 요청을 보내는 CLI.
//!
//! 앱은 pty 를 띄울 때 셸에 다음을 넣는다. 둘 중 하나라도 없으면 앱 터미널 밖이다.
//!
//! - `MARU_SOCKET` — 앱이 듣는 유닉스 도메인 소켓 경로
//! - `MARU_PTY_ID` — 그 터미널의 pty id
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
//! 모든 요청의 `params` 는 객체이고 `protocol_version`·`pty`(pty id)를 싣는다.
//!
//! ```text
//! → {"jsonrpc":"2.0","id":1,"method":"ping","params":{"protocol_version":1,"pty":"p-1a2b3c4d"}}
//! ← {"jsonrpc":"2.0","id":1,"result":{"pty":"p-1a2b3c4d"}}
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
//! | `ping` | 없음 | `{"pty":<받은 pty id>}` |
//! | `canvas.put` | `text`(문자열), `id`(빈 문자열이 아닌 문자열, 선택), `title`(문자열, 선택) | `{"id":<문서 id>}` |
//! | `inbox.push` | `to`(pty id), `text`(빈 문자열이 아닌 문자열) | `null` |
//! | `inbox.read` | 없음 | `{"messages":[{"from":<보낸 pty id>,"text":<본문>}…]}` |
//! | `monitor.subscribe` | `ancestors`(양의 정수 배열) | `null` |
//! | `pane.new` | `cwd`(절대경로 문자열), `direction`(`"right"`·`"down"`), `command`(문자열 배열, 비어 있지 않음, 선택), `full`(bool, 선택) | `{"pty":<새 pty id>}` |
//! | `pane.close` | `target`(pty id) | `null` |
//! | `cell.new` | `cwd`(절대경로 문자열), `command`(문자열 배열, 비어 있지 않음, 선택), `after`·`before`(pty id, 선택, 둘 중 하나만) | `{"pty":<새 pty id>}` |
//! | `job.new` | `command`(문자열 배열, 비어 있지 않음), `cwd`(절대경로 문자열), `name`(문자열, 선택) | `{"pty":<job 의 pty id>}` |
//! | `job.list` | 없음 | `{"jobs":[{"pty","name"(이름이 있을 때),"command","state":"running"·"exited","code","signal"}…]}` |
//! | `job.read` | `target`(job 이름이나 pty id) | `{"text":<글자>}` |
//! | `job.send` | `target`, `text`(문자열) | `null` |
//! | `job.kill` | `target` | `null` |
//! | `mate.list` | 없음 | `{"mates":[{"pty","state","kind","workspace","cell","dir","message"}…]}` |
//! | `app.restart` | `kill_ptys`(bool, 선택) | `null` |
//!
//! `mate.list` 는 창의 모든 workspace·cell 에서, pty 가 보낸 루트 program_status 레코드의 `app` 이
//! `claude-code` 인 pane 을 화면 순서(workspace → cell → pane)로 돌려준다. job 은 들지 않는다.
//! `state` 는 레코드의 상태(`idle`·`working`·`done`·`blocked`·`error`)다. `kind` 는 `permission`·`question`·
//! `auth` 나 null 이다. `workspace`·`cell` 은 사이드바가 보이는 이름이다. `cell` 은 브랜치가 있으면 이름 뒤에
//! 공백 하나를 두고 브랜치를 붙인다. `dir` 는 pane 의 cwd 절대경로이고, 모르면 시작 디렉토리, 그것도 없으면
//! 빈 문자열이다. `message` 는 레코드의 `message` 이고, 비었으면 `title` 이다.
//!
//! `canvas.put` 은 마크다운을 창의 Canvas 패널에 보인다. 같은 `id` 의 문서가 있으면 그 문서를 바꾸고,
//! `id` 가 없으면 앱이 새 id 를 만든다. id 는 형식 없는 문자열이다.
//!
//! `inbox.push` 는 `to` pty 에 메시지를 보낸다. `to` 가 `p-` 와 hex 8자리가 아니거나 그 pty 가 끝났으면
//! `invalid_params` 다. `to` 를 구독하는 연결이 있으면 알림을 보내고, 본문이 알림에 다 실렸으면 읽은
//! 것으로 쳐서 보관하지 않는다. 그 밖의 메시지는 보관하고 `inbox.read` 가 오래된 것부터 돌려준 뒤
//! 지운다. 보관은 앱 메모리에만 한다.
//!
//! `pane.new` 는 `pty` 의 pane 을 `direction` 쪽으로 나누고, 새 pane 에서 `cwd` 를 시작 디렉토리로
//! pty 를 띄운다. `full` 이 true 면 그 pane 이 든 cell 전체를 나눠 새 pane 을 `direction` 쪽 끝에
//! 붙인다. 포커스와 선택한 cell 은 바꾸지 않는다. `command` 가 있으면 대화형 로그인 셸이
//! 그 명령을 실행한다(셸이 sh·bash·zsh·ksh·dash 가 아니면 `/bin/sh` 가 실행한다). 명령이 끝나면 셸과
//! 함께 pane 이 닫힌다. 새 pty 가 뜬 뒤(명령이 그 전에 끝나면 끝난 뒤) 답한다. `pty` 의 pane 이 창에
//! 없으면 `invalid_params` 로 답한다. 나눈 pane 들이 하한(터미널 20열 × 5행) 아래로 내려가 나눌 자리가
//! 없으면 -32001 `no_space` 로 답하고 pane 을 열지 않는다. pty 를 띄우지 못하면 나눈 pane 을 닫고
//! `internal_error` 로 답한다.
//!
//! `pane.close` 는 `target` pty 의 pane 을 닫고 그 pty 를 끈다. `target` 의 pane 이 창에 없으면
//! `invalid_params` 다. 앱은 pane 을 찾은 뒤 답하고 pty 를 끄므로, 자기 pane 을 닫은 CLI 는 답을 받기
//! 전에 끝날 수 있다.
//!
//! `cell.new` 는 pane 하나인 cell 을 만들어 `pty` 의 cell 바로 뒤에 넣고, 그 pane 에서 `pane.new` 처럼
//! pty 를 띄운다. `pty` 가 job 이면 그 job 의 cell 이다(`job.*` 와 같다). 한 cell 에서 여러 번 부르면
//! 나중에 연 cell 이 앞에 놓인다. `after`·`before` 가 있으면 그 pty(pane 이나 job)의 cell 바로 뒤나
//! 바로 앞에 넣는다. 둘이 함께 오거나, pty id 가 아니거나, 그 pty 의 cell 이 없거나, 그 cell 이
//! `pty` 의 cell 과 다른 workspace 에 있으면 `invalid_params` 다.
//! `pty` 의 cell 을 모르면 새 workspace 를 목록 끝에 만들어 거기에 넣고, 이때 `after`·`before` 는
//! `invalid_params` 다. 포커스와 선택한 cell 은 바꾸지 않는다. 명령이 끝나 pane 이 닫히면 cell 이 닫히고, workspace 의 마지막 cell 이면 workspace 도
//! 닫힌다. 답하는 때와 pty 를 띄우지 못할 때는 `pane.new` 와 같고, 그때 닫는 pane 이 cell 의 하나뿐인
//! pane 이므로 cell 도 닫힌다.
//!
//! `job.*` 는 화면에 없는 pty(job)를 다룬다. job 은 부른 pty 의 cell 이 갖는다 — 부른 pty 가
//! job 이면 그 job 의 cell 이다. 다른 cell 의 job 은 목록에 없고 `target` 으로 가리켜도 없는
//! job 이다. cell 의 마지막 pane 이 닫히면 그 cell 의 job 을 끈다. 앱을 끝내면 job 도 끝나고,
//! `app.restart` 는 pane 처럼 job 을 남긴다.
//!
//! - `job.new` 는 `pane.new` 처럼 대화형 로그인 셸이 `command` 를 실행하는 pty 를 80×24 로 띄운다. 답의
//!   `pty` 는 그 pty 의 id 다. `name` 은 1~64자의 영숫자·`.`·`_`·`-` 이고 영숫자로
//!   시작하며 pty id 모양이 아니어야 한다(`target` 이 둘 다 받으므로). 같은 cell 에서 그 이름의
//!   job 이 돌고 있으면 -32001 `job_name_taken`, 끝났으면 그 job 을 지우고 띄운다.
//! - 셸이 끝나도 job 은 목록에 남고 `job.read` 로 출력을 읽을 수 있다. `job.kill` 하거나, 같은 이름으로
//!   `job.new` 하거나, cell 이 닫히면 빠진다. `code`·`signal` 은 끝난 job 의 종료 상태이고 돌고
//!   있으면 null 이다.
//! - `target` 이 `p-` 와 hex 8자리면 pty id 로, 아니면 이름으로 찾는다. 없으면 `invalid_params` 다.
//! - `job.read` 는 스크롤백과 화면을 스타일 없는 글자로 돌려준다. 화면 폭에서 접힌 줄은 잇는다.
//! - `job.send` 는 `text` 를 그대로 입력한다(Enter 는 CLI 가 붙인다). 끝난 job 이면 -32001
//!   `job_exited` 다. 프로그램이 입력을 읽지 않아 8초 안에 다 쓰지 못하면 `internal_error` 로 답하지만,
//!   입력은 pty 에 남아 프로그램이 읽을 때 들어간다. 줄 단위로 읽는 프로그램에는 PTY 의 줄 버퍼
//!   (`MAX_CANON`, macOS 에서 1024바이트)를 넘는 한 줄이 닿지 않는다.
//! - `job.kill` 은 돌고 있으면 끝내고, 끝난 뒤 목록에서 지우고 답한다.
//!
//! `app.restart` 는 pty 를 끄지 않고 앱을 다시 띄운다. 다시 뜬 앱은 workspace·cell·pane 을
//! 되살리고 같은 pty 에 다시 붙는다. 앱은 답을 보낸 뒤에 끝난다. 설치된 앱의 `maru-pty` 와
//! 떠 있는 pty 의 프로토콜 버전이 다르면 다시 뜬 앱은 그 pty 에 붙지 못한다.
//! 이때 `kill_ptys` 가 true 가 아니면 재시작하지 않고 -32001 `ptys_would_end` 로 답한다(`data.ptys` 는 꺼질 pty 수). `kill_ptys`
//! 가 true 면 재시작하고 다시 뜬 앱이 그 pty 를 끈다. 재시작할 수 없으면(dev 서버로 띄웠거나 창이 아직
//! 배치를 알리지 않았으면) -32001 `restart_unavailable` 로 답한다. 되살릴 화면을 저장하지 못하면 재시작하지
//! 않고 `internal_error` 로 답한다.
//!
//! `monitor.subscribe` 는 `result` 를 보낸 뒤 연결을 닫지 않고, 알림이 생길 때마다
//! `{"jsonrpc":"2.0","method":"monitor.event","params":<알림>}` 한 줄을 보낸다. 이 연결은 10초 끊기가
//! 없고, 어느 쪽이든 닫으면 구독이 풀린다. `ancestors` 는 구독하는 프로세스의 부모부터 위로 올라간 pid
//! 들이고, 그 pty 의 셸 pid 가 없으면 `invalid_params` 로 거절한다. 알림은 `event` 로 종류를 가리는
//! 객체다. 알림의 종류는 `method` 가 아니라 `event` 로 더한다 — 재시작 뒤에도 도는 이전
//! `maru claude monitor` 는 모르는 `method` 를 버린다.
//!
//! - inbox 의 알림은 `{"event":"inbox","from":<보낸 pty id>,"body":<본문>}` 이고, 본문이 240 코드
//!   포인트를 넘으면 앞 240 만 싣고 `"truncated":true` 와 `"note"`(`maru inbox read` 안내)를 붙인다.
//! - job 의 셸이 스스로 끝나면 그 job 을 띄운 pty 에 `{"event":"job","pty":<job 의 pty id>,
//!   "name":<이름, 없으면 뺀다>,"code","signal"}` 을 보낸다. 그 pty 에 구독이 없으면 보류했다가
//!   구독이 생길 때 보낸다. `job.kill` 이나 cell 닫기로 끝난 job 은 알리지 않는다.
//!
//! # claude monitor
//!
//! 앱 claude plugin 의 `monitors/monitors.json` 이 대화형 claude 마다 `maru claude monitor` 를 띄운다.
//! Claude Code 는 이 프로세스의 stdout 한 줄마다 claude 에 알리고, 쉬는 claude 도 그 줄을 받아 새
//! 응답을 시작한다. 그래서 알릴 것이 없으면 시작할 때도 stdout 에 아무것도 쓰지 않는다.
//!
//! monitor 는 `monitor.subscribe` 로 앱에 붙어, 받은 알림 객체를 한 줄씩 stdout 에 쓴다. 앱이 끝나거나
//! 처음부터 없으면, `MARU_SOCKET` 이 있는 디렉토리가 바뀔 때마다 다시 구독해 본다 — 재시작한 앱에도
//! 다시 붙는다. 그래서 앱은 그 경로에 소켓을 둘 때 이미 connect 를 받고 있어야 한다. 소켓이 보인 뒤에
//! listen 을 시작하면, 그 사이에 붙어 본 monitor 는 다음 변화가 올 때까지 붙지 못한다.
//!
//! 종료 신호를 받거나 stdout 의 상대가 닫히면 끝난다. claude 는 정상으로 끝날 때 SIGTERM 을 보내지만,
//! 신호 없이 죽으면(SIGKILL 등) monitor 에 남는 흔적은 stdout 이 닫히는 것뿐이다.

use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand};
use nix::errno::Errno;
use nix::sys::event::{EvFlags, EventFilter, FilterFlag, KEvent, Kqueue};
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
    /// Open panes next to this terminal and close panes in this window.
    Pane {
        #[command(subcommand)]
        command: PaneCommand,
    },
    /// Open cells in this terminal's workspace.
    Cell {
        #[command(subcommand)]
        command: CellCommand,
    },
    /// Run commands in terminals that are not shown, and read their output.
    Job {
        #[command(subcommand)]
        command: JobCommand,
    },
    /// See the Claude Code sessions running in this window's panes.
    Mate {
        #[command(subcommand)]
        command: MateCommand,
    },
    /// Control the app.
    App {
        #[command(subcommand)]
        command: AppCommand,
    },
    /// Commands the app's claude plugin runs from its hooks and monitors.
    #[command(hide = true)]
    Claude {
        #[command(subcommand)]
        command: ClaudeCommand,
    },
}

#[derive(Subcommand)]
enum ClaudeCommand {
    /// Read the claude hook payload on stdin. On SessionStart, print what claude should know
    /// about this terminal.
    Hook,
    /// Write the app's notifications to stdout, one per line, until stdout closes. The app's
    /// claude plugin runs this as a monitor.
    Monitor,
}

#[derive(Subcommand)]
enum InboxCommand {
    /// Send a message to another terminal.
    ///
    /// Reads MESSAGE, or stdin when MESSAGE is omitted or `-`. A claude running in that
    /// terminal gets it as a notification, cut after 240 characters; `maru inbox read` there
    /// shows the whole message.
    Push {
        /// Pty id of the receiving terminal, e.g. p-1a2b3c4d.
        pty: String,
        /// Message text. It may start with `-`.
        #[arg(allow_hyphen_values = true)]
        message: Option<String>,
    },
    /// Print the unread messages sent to this terminal and mark them read.
    Read,
}

#[derive(Subcommand)]
enum PaneCommand {
    /// Split this terminal's pane and run COMMAND in the new pane, or a shell when COMMAND
    /// is omitted. The pane closes when COMMAND exits. Focus stays where it is.
    ///
    /// Prints the new pane's pty id; `maru inbox push` sends messages to it and
    /// `maru pane close` closes it. Options go before COMMAND; everything from COMMAND on is
    /// passed to COMMAND. Use `sh -c '...'` for a pipeline.
    New {
        /// Directory to start in. Defaults to the current directory.
        #[arg(long)]
        cwd: Option<PathBuf>,
        /// Split below instead of to the right.
        #[arg(long)]
        down: bool,
        /// Split the whole cell instead of this pane, adding the new pane at its right
        /// end (bottom end with --down).
        #[arg(long)]
        full: bool,
        /// Command and its arguments.
        #[arg(trailing_var_arg = true)]
        command: Vec<String>,
    },
    /// Close the pane of a pty, any pane in this window.
    Close {
        /// Pty id of the pane to close, e.g. p-1a2b3c4d.
        pty: String,
    },
}

#[derive(Subcommand)]
enum CellCommand {
    /// Open a cell right after this terminal's cell and run COMMAND in its pane, or a shell when
    /// COMMAND is omitted. The cell closes when COMMAND exits. Focus and the selected cell stay
    /// where they are.
    ///
    /// Prints the new pane's pty id; `maru inbox push` sends messages to it and
    /// `maru pane close` closes it. `--after` or `--before` places the cell next to another
    /// cell in this terminal's workspace instead. Options go before COMMAND; everything from
    /// COMMAND on is passed to COMMAND. Use `sh -c '...'` for a pipeline.
    New {
        /// Directory to start in. Defaults to the current directory.
        #[arg(long)]
        cwd: Option<PathBuf>,
        /// Open the cell right after the cell of this pty (a pane or a job), e.g. p-1a2b3c4d.
        #[arg(long, value_name = "PTY", conflicts_with = "before")]
        after: Option<String>,
        /// Open the cell right before the cell of this pty (a pane or a job).
        #[arg(long, value_name = "PTY")]
        before: Option<String>,
        /// Command and its arguments.
        #[arg(trailing_var_arg = true)]
        command: Vec<String>,
    },
}

#[derive(Subcommand)]
enum JobCommand {
    /// Run COMMAND in a terminal that is not shown. The job belongs to this terminal's cell
    /// and ends when the cell closes.
    ///
    /// Prints the job's pty id. Options go before COMMAND; everything from COMMAND on is
    /// passed to COMMAND. A job that exits on its own stays listed with its output, and this
    /// terminal gets a `job` notification. A name that a running job holds is refused; a
    /// job that has exited gives its name to the new one.
    New {
        /// Name to refer to the job by, unique in this cell.
        #[arg(long)]
        name: Option<String>,
        /// Directory to start in. Defaults to the current directory.
        #[arg(long)]
        cwd: Option<PathBuf>,
        /// Command and its arguments.
        #[arg(trailing_var_arg = true, required = true)]
        command: Vec<String>,
    },
    /// List this cell's jobs in the order they started.
    List,
    /// Print a job's scrollback and screen as text.
    Read {
        /// Job name or pty id.
        job: String,
    },
    /// Type TEXT into a job and press Enter.
    ///
    /// Reads TEXT, or stdin when TEXT is omitted or `-`. A program that reads line by line
    /// does not get a line longer than the terminal's line buffer (1024 bytes on macOS).
    Send {
        /// Do not press Enter after TEXT.
        #[arg(long)]
        no_enter: bool,
        /// Job name or pty id.
        job: String,
        /// Text to type. It may start with `-`.
        #[arg(allow_hyphen_values = true)]
        text: Option<String>,
    },
    /// End a job if it is running and remove it from the list.
    Kill {
        /// Job name or pty id.
        job: String,
    },
}

#[derive(Subcommand)]
enum MateCommand {
    /// List the panes running claude, in every workspace and cell, in screen order.
    ///
    /// Prints tab-separated columns with a header: PTY, STATE, WORKSPACE, CELL, DIR, MESSAGE.
    /// STATE is idle, working, done, blocked or error; a blocked state with a reason reads
    /// e.g. blocked(permission). WORKSPACE and CELL are the names shown in the sidebar. DIR
    /// is the pane's directory. MESSAGE is what claude last reported. Control characters in a
    /// value, such as tabs and newlines, become spaces, and an unknown value is an empty column.
    List,
}

#[derive(Subcommand)]
enum AppCommand {
    /// Restart the app and keep its terminals running. The restarted app restores the
    /// workspaces, cells and panes and reattaches them to their terminals.
    ///
    /// Refuses when the installed app cannot reattach to the running terminals; pass
    /// --kill-ptys to restart anyway and end them.
    Restart {
        /// Restart even if the terminals would end.
        #[arg(long)]
        kill_ptys: bool,
    },
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
            let pty = pty_of(call(&target()?, "ping", Map::new())?)?;
            writeln!(std::io::stdout(), "pong (pty {pty})")?;
        }
        Command::Canvas {
            command: CanvasCommand::Put { id, title, file },
        } => {
            let id = canvas_put(id, title, file)?;
            writeln!(std::io::stdout(), "{id}")?;
        }
        Command::Inbox { command } => match command {
            InboxCommand::Push { pty, message } => inbox_push(pty, message)?,
            InboxCommand::Read => inbox_read()?,
        },
        Command::Pane { command } => match command {
            PaneCommand::New {
                cwd,
                down,
                full,
                command,
            } => {
                let pty = pane_new(cwd, down, full, command)?;
                writeln!(std::io::stdout(), "{pty}")?;
            }
            PaneCommand::Close { pty } => {
                call(&target()?, "pane.close", target_params(pty))?;
            }
        },
        Command::Cell {
            command:
                CellCommand::New {
                    cwd,
                    after,
                    before,
                    command,
                },
        } => {
            let pty = cell_new(cwd, after, before, command)?;
            writeln!(std::io::stdout(), "{pty}")?;
        }
        Command::Job { command } => match command {
            JobCommand::New { name, cwd, command } => {
                let pty = job_new(name, cwd, command)?;
                writeln!(std::io::stdout(), "{pty}")?;
            }
            JobCommand::List => job_list()?,
            JobCommand::Read { job } => {
                let result = call(&target()?, "job.read", target_params(job))?;
                let text = result["text"]
                    .as_str()
                    .ok_or_else(|| anyhow!("the app answered without text: {result}"))?;
                let mut out = std::io::stdout().lock();
                out.write_all(text.as_bytes())?;
                if !text.is_empty() && !text.ends_with('\n') {
                    writeln!(out)?;
                }
            }
            JobCommand::Send {
                no_enter,
                job,
                text,
            } => job_send(job, text, !no_enter)?,
            JobCommand::Kill { job } => {
                call(&target()?, "job.kill", target_params(job))?;
            }
        },
        Command::Mate {
            command: MateCommand::List,
        } => mate_list()?,
        Command::App {
            command: AppCommand::Restart { kill_ptys },
        } => {
            let mut params = Map::new();
            params.insert("kill_ptys".into(), kill_ptys.into());
            call(&target()?, "app.restart", params)?;
        }
        Command::Claude { command } => match command {
            ClaudeCommand::Hook => claude_hook()?,
            ClaudeCommand::Monitor => claude_monitor()?,
        },
    }
    Ok(())
}

fn claude_hook() -> Result<()> {
    let target = target()?;
    let payload: Value = serde_json::from_reader(std::io::stdin().lock())
        .map_err(|e| anyhow!("stdin is not a hook payload: {e}"))?;
    let Some(event) = payload["hook_event_name"].as_str() else {
        bail!("the hook payload has no hook_event_name");
    };
    // SessionStart hook 의 stdout 은 claude 의 컨텍스트에 들어간다.
    if event == "SessionStart" {
        write!(
            std::io::stdout(),
            "You are in AI Maru pty {}. Messages from other ptys arrive as\n\
             monitor notifications. Send: `maru inbox push <pty> <message>`. Unread: `maru inbox read`.\n\
             Background processes (dev servers, builds, watchers): `maru job new --name <name> <command>`.\n\
             When one exits on its own you get a {{\"event\":\"job\"}} notification; `maru job read <name>` shows its output.\n",
            target.pty
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
    watch(&kq, 1, EventFilter::EVFILT_WRITE, FilterFlag::empty()).context("cannot watch stdout")?;
    // 다시 뜬 앱이 소켓을 같은 경로로 옮기므로(모듈 doc 「claude monitor」) 디렉토리를 감시한다.
    let dir = std::path::Path::new(&target.socket)
        .parent()
        .and_then(|d| File::open(d).ok());
    if let Some(d) = &dir {
        let fd = d.as_raw_fd() as usize;
        watch(&kq, fd, EventFilter::EVFILT_VNODE, FilterFlag::NOTE_WRITE)
            .context("cannot watch the app's socket directory")?;
    }
    let mut app = None;
    if !resubscribe(&kq, &target, &mut app)? {
        return Ok(());
    }
    let idle = KEvent::new(
        0,
        EventFilter::EVFILT_WRITE,
        EvFlags::empty(),
        FilterFlag::empty(),
        0,
        0,
    );
    let mut events = [idle; 3];
    loop {
        let n = match kq.kevent(&[], &mut events, None) {
            Ok(n) => n,
            Err(Errno::EINTR) => continue,
            Err(e) => return Err(e).context("cannot watch stdout"),
        };
        for ev in &events[..n] {
            if ev.ident() == 1 {
                if ev.flags().contains(EvFlags::EV_EOF) {
                    return Ok(());
                }
            } else if dir
                .as_ref()
                .is_some_and(|d| ev.ident() == d.as_raw_fd() as usize)
            {
                if app.is_none() && !resubscribe(&kq, &target, &mut app)? {
                    return Ok(());
                }
            } else if let Some(a) = &mut app {
                match a.read() {
                    Flow::Open => {}
                    // 닫은 fd 는 kqueue 에서도 빠진다. 앱이 이미 다시 떠 있으면 디렉토리가 더 바뀌지 않으므로
                    // 곧바로 한 번 붙어 본다.
                    Flow::AppClosed => {
                        app = None;
                        if !resubscribe(&kq, &target, &mut app)? {
                            return Ok(());
                        }
                    }
                    Flow::StdoutClosed => return Ok(()),
                }
            }
        }
    }
}

/// 앱에 붙으면 `app` 에 넣는다. 앱이 구독을 거절했거나 stdout 이 닫혀 끝내야 하면 false 다.
fn resubscribe(kq: &Kqueue, target: &Target, app: &mut Option<App>) -> Result<bool> {
    let mut a = match subscribe(target) {
        Ok(Some(a)) => a,
        Ok(None) => return Ok(false),
        Err(_) => return Ok(true),
    };
    let fd = a.stream.as_raw_fd() as usize;
    watch(kq, fd, EventFilter::EVFILT_READ, FilterFlag::empty()).context("cannot watch the app")?;
    if a.write_events() == Flow::StdoutClosed {
        return Ok(false);
    }
    *app = Some(a);
    Ok(true)
}

fn watch(kq: &Kqueue, fd: usize, filter: EventFilter, fflags: FilterFlag) -> nix::Result<()> {
    let ev = KEvent::new(
        fd,
        filter,
        EvFlags::EV_ADD | EvFlags::EV_CLEAR,
        fflags,
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
            "give a MESSAGE or pipe the message into stdin, e.g. `maru inbox push p-1a2b3c4d hello`",
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

fn start_dir(cwd: Option<PathBuf>) -> Result<String> {
    let cwd = match cwd {
        Some(dir) => std::path::absolute(&dir)
            .with_context(|| format!("cannot resolve {}", dir.display()))?,
        None => std::env::current_dir().context("cannot read the current directory")?,
    };
    // 앱은 열 수 없는 디렉토리를 홈으로 바꿔 띄우므로, 잘못 준 경로는 여기서 알린다.
    if !cwd.is_dir() {
        bail!("{} is not a directory", cwd.display());
    }
    cwd.into_os_string()
        .into_string()
        .map_err(|_| anyhow!("the directory is not UTF-8"))
}

fn pane_new(cwd: Option<PathBuf>, down: bool, full: bool, command: Vec<String>) -> Result<String> {
    let target = target()?;
    let mut params = Map::new();
    params.insert("cwd".into(), start_dir(cwd)?.into());
    params.insert(
        "direction".into(),
        if down { "down" } else { "right" }.into(),
    );
    if full {
        params.insert("full".into(), true.into());
    }
    if !command.is_empty() {
        params.insert("command".into(), command.into());
    }
    pty_of(call(&target, "pane.new", params)?)
}

fn cell_new(
    cwd: Option<PathBuf>,
    after: Option<String>,
    before: Option<String>,
    command: Vec<String>,
) -> Result<String> {
    let target = target()?;
    let mut params = Map::new();
    params.insert("cwd".into(), start_dir(cwd)?.into());
    if let Some(pty) = after {
        params.insert("after".into(), pty.into());
    }
    if let Some(pty) = before {
        params.insert("before".into(), pty.into());
    }
    if !command.is_empty() {
        params.insert("command".into(), command.into());
    }
    pty_of(call(&target, "cell.new", params)?)
}

fn job_new(name: Option<String>, cwd: Option<PathBuf>, command: Vec<String>) -> Result<String> {
    let target = target()?;
    let mut params = Map::new();
    params.insert("cwd".into(), start_dir(cwd)?.into());
    params.insert("command".into(), command.into());
    if let Some(name) = name {
        params.insert("name".into(), name.into());
    }
    pty_of(call(&target, "job.new", params)?)
}

fn pty_of(result: Value) -> Result<String> {
    match result["pty"].as_str() {
        Some(pty) => Ok(pty.to_owned()),
        None => bail!("the app answered without a pty: {result}"),
    }
}

fn target_params(target: String) -> Map<String, Value> {
    let mut params = Map::new();
    params.insert("target".into(), target.into());
    params
}

fn job_send(job: String, text: Option<String>, enter: bool) -> Result<()> {
    // 앱 터미널 밖이면 끝나지 않는 입력을 읽기 전에 실패해야 한다.
    let target = target()?;
    let mut text = match text.filter(|t| t != "-") {
        Some(text) => text,
        None => {
            let mut text =
                read_stdin("give TEXT or pipe the input into stdin, e.g. `maru job send dev r`")?;
            // `echo r | maru job send dev` 가 Enter 를 두 번 누르지 않게.
            if enter && text.ends_with('\n') {
                text.pop();
            }
            text
        }
    };
    if enter {
        text.push('\r');
    } else if text.is_empty() {
        bail!("nothing to send");
    }
    let mut params = target_params(job);
    params.insert("text".into(), text.into());
    call(&target, "job.send", params)?;
    Ok(())
}

fn list_rows<const N: usize>(
    method: &str,
    key: &str,
    row: impl FnMut(&Value) -> Result<[String; N]>,
) -> Result<Option<Vec<[String; N]>>> {
    let result = call(&target()?, method, Map::new())?;
    let rows = result[key]
        .as_array()
        .ok_or_else(|| anyhow!("the app answered without {key}: {result}"))?
        .iter()
        .map(row)
        .collect::<Result<Vec<_>>>()?;
    if rows.is_empty() {
        writeln!(std::io::stderr(), "no {key}")?;
        return Ok(None);
    }
    Ok(Some(rows))
}

fn job_list() -> Result<()> {
    let Some(rows) = list_rows("job.list", "jobs", job_row)? else {
        return Ok(());
    };
    let header = ["PTY", "NAME", "STATE", "COMMAND"].map(String::from);
    let mut widths = [0; 3];
    for row in std::iter::once(&header).chain(&rows) {
        for (w, cell) in widths.iter_mut().zip(row) {
            *w = (*w).max(cell.chars().count());
        }
    }
    let mut out = std::io::stdout().lock();
    for row in std::iter::once(&header).chain(&rows) {
        for (w, cell) in widths.iter().zip(row) {
            write!(out, "{cell:<0$}  ", w)?;
        }
        writeln!(out, "{}", row[3])?;
    }
    Ok(())
}

fn job_row(job: &Value) -> Result<[String; 4]> {
    let fail = || anyhow!("the app answered with a job it cannot print: {job}");
    let pty = job["pty"].as_str().ok_or_else(fail)?;
    let name = match &job["name"] {
        Value::Null => "-",
        Value::String(name) => name,
        _ => return Err(fail()),
    };
    let command = job["command"]
        .as_array()
        .and_then(|args| {
            args.iter()
                .map(|a| a.as_str().map(shell_word))
                .collect::<Option<Vec<_>>>()
        })
        .ok_or_else(fail)?
        .join(" ");
    let state = match (
        job["state"].as_str(),
        job["code"].as_i64(),
        job["signal"].as_i64(),
    ) {
        (Some("running"), _, _) => "running".to_owned(),
        (Some("exited"), Some(code), _) => format!("exited {code}"),
        (Some("exited"), None, Some(signal)) => format!("signal {signal}"),
        _ => return Err(fail()),
    };
    Ok([pty.to_owned(), name.to_owned(), state, command])
}

fn mate_list() -> Result<()> {
    let home = env_var("HOME");
    let Some(rows) = list_rows("mate.list", "mates", |m| mate_row(m, home.as_deref()))? else {
        return Ok(());
    };
    let mut text = String::from("PTY\tSTATE\tWORKSPACE\tCELL\tDIR\tMESSAGE\n");
    for row in rows {
        text.push_str(&row.join("\t"));
        text.push('\n');
    }
    // `| head -1` 처럼 읽는 쪽이 먼저 닫는 것은 실패가 아니다.
    match std::io::stdout().lock().write_all(text.as_bytes()) {
        Err(e) if e.kind() == ErrorKind::BrokenPipe => Ok(()),
        r => Ok(r?),
    }
}

fn mate_row(mate: &Value, home: Option<&str>) -> Result<[String; 6]> {
    let fail = || anyhow!("the app answered with a mate it cannot print: {mate}");
    let text = |key: &str| mate[key].as_str().ok_or_else(fail);
    let state = match (text("state")?, &mate["kind"]) {
        ("blocked", Value::String(kind)) => format!("blocked({kind})"),
        (state, Value::Null | Value::String(_)) => state.to_owned(),
        _ => return Err(fail()),
    };
    let row = [
        text("pty")?.to_owned(),
        state,
        text("workspace")?.to_owned(),
        text("cell")?.to_owned(),
        tilde(text("dir")?, home),
        text("message")?.to_owned(),
    ];
    Ok(row.map(|v| tsv_field(&v)))
}

/// 제어 문자를 공백으로 바꾼다. 값 안의 탭·줄바꿈이 열과 줄을 가르거나, ESC 가 출력을 읽는 터미널의 상태를 바꿀 수 있기 때문이다.
fn tsv_field(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

fn tilde(path: &str, home: Option<&str>) -> String {
    let Some(home) = home
        .map(|h| h.trim_end_matches('/'))
        .filter(|h| !h.is_empty())
    else {
        return path.to_owned();
    };
    match path.strip_prefix(home) {
        Some("") => "~".to_owned(),
        Some(rest) if rest.starts_with('/') => format!("~{rest}"),
        _ => path.to_owned(),
    }
}

/// 셸에 다시 넣으면 같은 인자가 되게 쓴다.
fn shell_word(arg: &str) -> String {
    let plain = |b: u8| b.is_ascii_alphanumeric() || b"_@%+=:,./-".contains(&b);
    if !arg.is_empty() && arg.bytes().all(plain) {
        arg.to_owned()
    } else {
        format!("'{}'", arg.replace('\'', r"'\''"))
    }
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
    pty: String,
}

fn target() -> Result<Target> {
    let (Some(socket), Some(pty)) = (env_var("MARU_SOCKET"), env_var("MARU_PTY_ID")) else {
        bail!("not inside an AI Maru terminal (MARU_SOCKET and MARU_PTY_ID are not set)");
    };
    Ok(Target { socket, pty })
}

fn request_line(target: &Target, method: &str, mut params: Map<String, Value>) -> String {
    params.insert("protocol_version".into(), PROTOCOL_VERSION.into());
    params.insert("pty".into(), target.pty.as_str().into());
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
