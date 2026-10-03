use crate::PROTOCOL_VERSION;
use crate::frame::{TAG_TEXT, read_frame, write_json};
use crate::paths::{self, Paths};
use crate::record::{self, Record};
use crate::session::{Session, wait_exit};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{UnixListener, UnixStream};
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinSet;

const TERMINATE_GRACE: Duration = Duration::from_secs(2);
const FLUSH_GRACE: Duration = Duration::from_secs(1);
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

#[derive(clap::Args)]
pub struct Options {
    /// 소켓·레코드를 둘 디렉토리. 없으면 만들고 0700 으로 맞춘다.
    #[arg(long)]
    pub dir: PathBuf,
    /// 세션 id. 영숫자·'-'·'_' 1~64 자.
    #[arg(long)]
    pub id: String,
    /// 로그인 셸로 띄울 셸. 기본은 $SHELL, 없으면 /bin/sh.
    #[arg(long)]
    pub shell: Option<PathBuf>,
    /// 셸의 작업 디렉토리. 기본은 이 프로세스의 작업 디렉토리.
    #[arg(long)]
    pub cwd: Option<PathBuf>,
    #[arg(long, default_value_t = 80)]
    pub cols: u16,
    #[arg(long, default_value_t = 24)]
    pub rows: u16,
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
            "살아 있는 세션 프로세스가 이미 {} 를 듣고 있다",
            paths.socket.display()
        );
    }
    std::fs::remove_file(&paths.socket).ok();

    let shell = opts
        .shell
        .or_else(|| std::env::var_os("SHELL").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/bin/sh"));
    let session = Session::spawn(&shell, opts.cwd.as_deref(), opts.cols, opts.rows)?;
    let listener = match publish(&opts.id, &paths, &session) {
        Ok(l) => l,
        Err(e) => {
            session.terminate(TERMINATE_GRACE).await;
            std::fs::remove_file(&paths.record).ok();
            return Err(e);
        }
    };
    log!(
        "maru-session {}: {} 에서 듣는다",
        opts.id,
        paths.socket.display()
    );

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
                    log!("maru-session: accept 실패: {e}");
                    tokio::time::sleep(ACCEPT_BACKOFF).await;
                }
            },
            Some(_) = conns.join_next(), if !conns.is_empty() => {}
            _ = wait_exit(&mut exit_rx) => break,
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
        .with_context(|| format!("{} 에 bind 할 수 없다", paths.socket.display()))
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
            Err(_) => return error(&mut stream, "bad_request", "첫 프레임이 JSON 이 아니다").await,
        },
        Ok(Some(_)) => {
            return error(&mut stream, "bad_request", "첫 프레임은 Text 여야 한다").await;
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
        Some("capture") => match session.capture() {
            Ok(text) => {
                reply(
                    &mut stream,
                    json!({ "type": "capture", "text": String::from_utf8_lossy(&text) }),
                )
                .await
            }
            Err(e) => error(&mut stream, "capture_failed", &format!("{e:#}")).await,
        },
        _ => error(&mut stream, "unknown_request", "모르는 type").await,
    }
}

async fn reply(stream: &mut UnixStream, v: Value) {
    let _ = write_json(stream, &v).await;
}

async fn error(stream: &mut UnixStream, code: &str, message: &str) {
    reply(stream, crate::frame::error(code, message)).await
}
