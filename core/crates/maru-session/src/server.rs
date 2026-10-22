use crate::PROTOCOL_VERSION;
use crate::frame::{TAG_TEXT, read_frame, write_json};
use crate::paths::{self, Paths};
use crate::record::{self, Record};
use crate::session::{Session, wait_exit};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::ffi::OsString;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::net::{UnixListener, UnixStream};
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinSet;

const TERMINATE_GRACE: Duration = Duration::from_secs(2);
const FLUSH_GRACE: Duration = Duration::from_secs(1);
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

#[derive(clap::Args)]
pub struct Options {
    /// Directory for the socket and the record. It is created when missing and set to mode 0700.
    #[arg(long)]
    pub dir: PathBuf,
    /// Session id: 1 to 64 ASCII letters, digits, '-' or '_'.
    #[arg(long)]
    pub id: String,
    /// Shell to run as a login shell. Defaults to `$SHELL`, or `/bin/sh` when that is unset, empty
    /// or not executable; in the last two cases the shell also gets `SHELL=/bin/sh`.
    #[arg(long)]
    pub shell: Option<PathBuf>,
    /// Working directory of the shell. Defaults to this process's working directory.
    #[arg(long)]
    pub cwd: Option<PathBuf>,
    #[arg(long, default_value_t = 80)]
    pub cols: u16,
    #[arg(long, default_value_t = 24)]
    pub rows: u16,
    /// Keep this process running after the shell exits, holding the screen and the exit status.
    /// It ends on a `kill` request or a termination signal.
    #[arg(long)]
    pub keep: bool,
    /// Given after `--`, the interactive login shell runs this command and exits. When the shell
    /// is not sh, bash, zsh, ksh or dash, `/bin/sh` runs it instead.
    #[arg(last = true)]
    pub command: Vec<String>,
}

type KillAck = oneshot::Sender<()>;

pub async fn run(opts: Options) -> Result<()> {
    let paths = Paths::new(&opts.dir, &opts.id)?;
    paths::prepare_dir(&opts.dir)?;

    // 셸·레코드를 만든 뒤 등록 전에 SIGTERM 이 닿으면 정리 없이 죽어 레코드가 남는다.
    let mut sigterm = signal(SignalKind::terminate())?;
    let mut sigint = signal(SignalKind::interrupt())?;
    let mut sighup = signal(SignalKind::hangup())?;

    // 셸을 띄운 뒤에 알면 그 셸이 고아가 되고 산 프로세스의 레코드를 덮는다.
    if UnixStream::connect(&paths.socket).await.is_ok() {
        bail!(
            "a live session process is already listening on {}",
            paths.socket.display()
        );
    }
    std::fs::remove_file(&paths.socket).ok();

    let (shell, shell_var) = choose_shell(opts.shell, std::env::var_os("SHELL"));
    let session = Session::spawn(
        &shell,
        shell_var.as_deref(),
        opts.cwd.as_deref(),
        &opts.command,
        opts.cols,
        opts.rows,
    )?;
    let listener = match publish(&opts.id, &paths, &session) {
        Ok(l) => l,
        Err(e) => {
            session.terminate(TERMINATE_GRACE).await;
            std::fs::remove_file(&paths.record).ok();
            return Err(e);
        }
    };
    log!(
        "maru-session {}: listening on {}",
        opts.id,
        paths.socket.display()
    );

    let keep = opts.keep;
    let (kill_tx, mut kill_rx) = mpsc::channel::<KillAck>(1);
    let mut exit_rx = session.exit_rx();
    let mut conns = JoinSet::new();
    let mut ack = None;
    loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    conns.spawn(handle(stream, session.clone(), kill_tx.clone()));
                }
                Err(e) => {
                    // fd 가 바닥나면 Linux 는 연결을 큐에 남겨 accept 가 같은 에러로 곧바로 다시 깨어난다.
                    log!("maru-session: accept failed: {e}");
                    tokio::time::sleep(ACCEPT_BACKOFF).await;
                }
            },
            Some(_) = conns.join_next(), if !conns.is_empty() => {}
            _ = wait_exit(&mut exit_rx), if !keep => break,
            Some(a) = kill_rx.recv() => {
                ack = Some(a);
                break;
            }
            _ = sigterm.recv() => break,
            _ = sigint.recv() => break,
            _ = sighup.recv() => break,
        }
    }

    drop(listener);
    session.terminate(TERMINATE_GRACE).await;
    std::fs::remove_file(&paths.socket).ok();
    std::fs::remove_file(&paths.record).ok();
    if let Some(a) = ack {
        let _ = a.send(());
    }
    // 아직 안 받은 동시 kill 요청들이 정리 뒤에 응답하게 놓아 준다.
    drop(kill_rx);
    let _ = tokio::time::timeout(FLUSH_GRACE, async {
        while conns.join_next().await.is_some() {}
    })
    .await;
    Ok(())
}

/// `SHELL` 이 비었거나 실행할 수 없으면 자식의 `SHELL` 을 `/bin/sh` 로 바꿔 넣는다.
/// 셸 안에서 `$SHELL` 을 실행하는 프로그램이 같은 값을 실행하다 실패하기 때문이다.
fn choose_shell(flag: Option<PathBuf>, var: Option<OsString>) -> (PathBuf, Option<PathBuf>) {
    const FALLBACK: &str = "/bin/sh";
    if let Some(shell) = flag {
        return (shell, None);
    }
    match var {
        None => (PathBuf::from(FALLBACK), None),
        Some(v) if is_executable(Path::new(&v)) => (PathBuf::from(v), None),
        Some(_) => (PathBuf::from(FALLBACK), Some(PathBuf::from(FALLBACK))),
    }
}

fn is_executable(path: &Path) -> bool {
    let file =
        |p: &Path| p.is_file() && nix::unistd::access(p, nix::unistd::AccessFlags::X_OK).is_ok();
    if path.as_os_str().is_empty() {
        return false;
    }
    if path.as_os_str().as_bytes().contains(&b'/') {
        return file(path);
    }
    std::env::var_os("PATH")
        .is_some_and(|dirs| std::env::split_paths(&dirs).any(|d| file(&d.join(path))))
}

fn publish(id: &str, paths: &Paths, session: &Session) -> Result<UnixListener> {
    record::write(
        &paths.record,
        &Record {
            protocol_version: PROTOCOL_VERSION,
            id: id.to_string(),
            pid: std::process::id(),
            shell_pid: session.shell_pid,
            tty: session.tty.clone(),
            created_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        },
    )?;
    UnixListener::bind(&paths.socket)
        .with_context(|| format!("cannot bind {}", paths.socket.display()))
}

async fn handle(mut stream: UnixStream, session: Arc<Session>, kill_tx: mpsc::Sender<KillAck>) {
    let same_user = stream
        .peer_cred()
        .is_ok_and(|c| c.uid() == nix::unistd::geteuid().as_raw());
    if !same_user {
        return;
    }

    let req = match read_frame(&mut stream).await {
        Ok(Some((TAG_TEXT, payload))) => match serde_json::from_slice::<Value>(&payload) {
            Ok(v) => v,
            Err(_) => {
                return error(&mut stream, "bad_request", "the first frame is not JSON").await;
            }
        },
        Ok(Some(_)) => {
            return error(&mut stream, "bad_request", "the first frame must be Text").await;
        }
        _ => return,
    };

    match req["type"].as_str() {
        Some("version") => {
            reply(
                &mut stream,
                json!({ "type": "version", "protocol_version": PROTOCOL_VERSION }),
            )
            .await
        }
        Some("kill") => {
            let (tx, rx) = oneshot::channel();
            if kill_tx.send(tx).await.is_ok() {
                let _ = rx.await;
            }
            reply(&mut stream, json!({ "type": "killed" })).await
        }
        _ if req["protocol_version"].as_u64() != Some(PROTOCOL_VERSION.into()) => {
            reply(
                &mut stream,
                json!({ "type": "error", "code": "protocol_mismatch", "protocol_version": PROTOCOL_VERSION }),
            )
            .await
        }
        Some("attach") => crate::attach::run(stream, session, &req).await,
        Some("status") => {
            let wait = req["wait"] == true;
            let exit = if wait {
                let mut rx = session.exit_rx();
                let mut probe = [0u8; 1];
                tokio::select! {
                    // 끝낸 것이 이 프로세스면 셸이 스스로 끝난 것이 아니므로 답하지 않는다.
                    exit = wait_exit(&mut rx) => match exit {
                        Some(exit) if !session.terminating() => Some(exit),
                        _ => return,
                    },
                    // 기다리던 쪽이 끊었으면 셸이 끝날 때까지 연결을 열어 두지 않는다.
                    _ = stream.read(&mut probe) => return,
                }
            } else {
                session.exited()
            };
            reply(&mut stream, json!({ "type": "status", "exit": exit })).await
        }
        Some("input") => {
            let Some(text) = req["text"].as_str() else {
                return error(&mut stream, "bad_request", "text must be a string").await;
            };
            if session.exited().is_some() {
                return error(&mut stream, "exited", "the shell has exited").await;
            }
            let bytes = text.as_bytes().to_vec();
            let s = session.clone();
            let written = tokio::task::spawn_blocking(move || s.write(&bytes))
                .await
                .map_err(std::io::Error::other)
                .and_then(|r| r);
            match written {
                Ok(()) => reply(&mut stream, json!({ "type": "input" })).await,
                Err(e) => error(&mut stream, "input_failed", &e.to_string()).await,
            }
        }
        Some("capture") => match session.capture(req["unwrap"] == true) {
            Ok(text) => {
                reply(
                    &mut stream,
                    json!({ "type": "capture", "text": String::from_utf8_lossy(&text) }),
                )
                .await
            }
            Err(e) => error(&mut stream, "capture_failed", &format!("{e:#}")).await,
        },
        _ => error(&mut stream, "unknown_request", "unknown type").await,
    }
}

async fn reply(stream: &mut UnixStream, v: Value) {
    let _ = write_json(stream, &v).await;
}

async fn error(stream: &mut UnixStream, code: &str, message: &str) {
    reply(stream, crate::frame::error(code, message)).await
}
