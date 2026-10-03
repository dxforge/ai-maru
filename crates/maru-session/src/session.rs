use crate::pty::{self, Pty};
use crate::vt::{VtFormat, VtTerminal};
use anyhow::Result;
use nix::sys::signal::{Signal, killpg};
use nix::unistd::Pid;
use serde::Serialize;
use std::io::{Read, Write};
use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::sync::{Notify, watch};

const READ_CHUNK: usize = 8192;
/// 바이트로 센다. 대량 출력 중 PTY 읽기는 한 번에 스무 바이트도 안 되게 끊겨 와서, 청크
/// 개수로 세면 쉬지 않고 읽는 클라이언트도 밀린다.
const OUTPUT_BACKLOG: usize = 4 * 1024 * 1024;
/// 셸이 나간 뒤 남은 출력이 다 전달되길 기다리되, EOF 에 종료를 묶지 않으려는 상한.
const DRAIN_AFTER_EXIT: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Exit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

pub struct ReplayState {
    pub cols: u16,
    pub rows: u16,
    pub cursor_x: u16,
    pub cursor_y: u16,
    pub trailing_blank_rows: u64,
}

pub enum Recv {
    Data(Vec<u8>),
    /// 밀린 출력을 버렸다. 화면이 어긋났으니 `subscribe_with_replay` 로 다시 받아야 한다.
    Lagged,
}

pub struct Output {
    backlog: Mutex<Backlog>,
    notify: Notify,
}

#[derive(Default)]
struct Backlog {
    data: Vec<u8>,
    lagged: bool,
}

impl Output {
    fn push(&self, bytes: &[u8]) {
        let mut b = self.backlog.lock().unwrap();
        if b.lagged {
            return;
        }
        if b.data.len() + bytes.len() > OUTPUT_BACKLOG {
            b.lagged = true;
            b.data = Vec::new();
        } else {
            b.data.extend_from_slice(bytes);
        }
        drop(b);
        self.notify.notify_one();
    }

    pub fn try_recv(&self) -> Option<Recv> {
        let mut b = self.backlog.lock().unwrap();
        if b.lagged {
            Some(Recv::Lagged)
        } else if b.data.is_empty() {
            None
        } else {
            Some(Recv::Data(std::mem::take(&mut b.data)))
        }
    }

    pub async fn recv(&self) -> Recv {
        loop {
            if let Some(r) = self.try_recv() {
                return r;
            }
            self.notify.notified().await;
        }
    }
}

pub async fn wait_exit(rx: &mut watch::Receiver<Option<Exit>>) -> Option<Exit> {
    rx.wait_for(|e| e.is_some()).await.ok().and_then(|e| *e)
}

pub struct Session {
    pub tty: String,
    pub shell_pid: u32,
    pty: Pty,
    writer: Mutex<std::fs::File>,
    screen: Arc<Mutex<Screen>>,
    exit_rx: watch::Receiver<Option<Exit>>,
    primary: watch::Sender<Option<u64>>,
    next_conn: AtomicU64,
}

/// 크기를 VT 와 같은 락 아래 두어 재생 스냅샷과 어긋나지 않게 한다.
struct Screen {
    vt: VtTerminal,
    cols: u16,
    rows: u16,
    outputs: Vec<Weak<Output>>,
}

impl Session {
    pub fn spawn(shell: &Path, cwd: Option<&Path>, cols: u16, rows: u16) -> Result<Arc<Self>> {
        // 셸이 뜬 뒤 크기 검사에 걸리면 그 셸을 쥘 핸들이 없다.
        let screen = Arc::new(Mutex::new(Screen {
            vt: VtTerminal::new(cols, rows)?,
            cols,
            rows,
            outputs: Vec::new(),
        }));
        let spawned = pty::spawn(shell, cwd, cols, rows)?;
        let shell_pid = spawned.child.id();
        let (exit_tx, exit_rx) = watch::channel(None);
        let (drained_tx, drained_rx) = std::sync::mpsc::channel::<()>();

        let mut reader = spawned.reader;
        let screen_r = screen.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; READ_CHUNK];
            loop {
                let n = match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                };
                let bytes = &buf[..n];
                // `subscribe_with_replay` 와 같은 락 안에서 반영·전달해야 출력이 스냅샷과 구독 중
                // 정확히 한쪽에만 들어간다.
                let mut screen = screen_r.lock().unwrap();
                screen.vt.write(bytes);
                screen
                    .outputs
                    .retain(|o| o.upgrade().inspect(|o| o.push(bytes)).is_some());
            }
            let _ = drained_tx.send(());
        });

        let mut child = spawned.child;
        std::thread::spawn(move || {
            let exit = match child.wait() {
                Ok(s) => Exit {
                    code: s.code(),
                    signal: s.signal(),
                },
                Err(_) => Exit {
                    code: None,
                    signal: None,
                },
            };
            let _ = drained_rx.recv_timeout(DRAIN_AFTER_EXIT);
            let _ = exit_tx.send(Some(exit));
        });

        Ok(Arc::new(Session {
            tty: spawned.tty,
            shell_pid,
            pty: spawned.pty,
            writer: Mutex::new(spawned.writer),
            screen,
            exit_rx,
            primary: watch::channel(None).0,
            next_conn: AtomicU64::new(1),
        }))
    }

    /// 블로킹 쓰기여야 한다 — 커널의 역압이 캐노니컬 모드 한 줄 한도를 넘는 입력이 잘리지 않게 지킨다.
    pub fn write(&self, bytes: &[u8]) -> std::io::Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(bytes)?;
        w.flush()
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let mut screen = self.screen.lock().unwrap();
        // VT 가 먼저 거절해야 PTY 가 그대로 남는다.
        screen.vt.resize(cols, rows)?;
        self.pty.resize(cols, rows)?;
        screen.cols = cols;
        screen.rows = rows;
        Ok(())
    }

    pub fn capture(&self) -> Result<Vec<u8>> {
        self.screen.lock().unwrap().vt.format(VtFormat::Plain)
    }

    pub fn subscribe_with_replay(&self) -> Result<(Vec<u8>, ReplayState, Arc<Output>)> {
        let mut screen = self.screen.lock().unwrap();
        let replay = screen.vt.format(VtFormat::Vt)?;
        let (cursor_x, cursor_y) = screen.vt.cursor()?;
        let state = ReplayState {
            cols: screen.cols,
            rows: screen.rows,
            cursor_x,
            cursor_y,
            trailing_blank_rows: screen.vt.trailing_blank_rows(&replay)?,
        };
        let output = Arc::new(Output {
            backlog: Mutex::default(),
            notify: Notify::new(),
        });
        screen.outputs.push(Arc::downgrade(&output));
        Ok((replay, state, output))
    }

    pub fn exit_rx(&self) -> watch::Receiver<Option<Exit>> {
        self.exit_rx.clone()
    }

    pub fn next_conn_id(&self) -> u64 {
        self.next_conn.fetch_add(1, Ordering::Relaxed)
    }

    pub fn claim_primary(&self, conn: u64) {
        self.primary.send_replace(Some(conn));
    }

    pub fn release_primary(&self, conn: u64) {
        self.primary.send_if_modified(|p| {
            let mine = *p == Some(conn);
            if mine {
                *p = None;
            }
            mine
        });
    }

    pub fn is_primary(&self, conn: u64) -> bool {
        *self.primary.borrow() == Some(conn)
    }

    pub fn primary_rx(&self) -> watch::Receiver<Option<u64>> {
        self.primary.subscribe()
    }

    /// 터미널을 닫을 때처럼 SIGHUP 으로 끝낸다.
    pub async fn terminate(&self, grace: Duration) {
        let mut exit_rx = self.exit_rx();
        if exit_rx.borrow().is_some() {
            return;
        }
        let shell = self.shell_pid as i32;
        let fg = self.pty.foreground_pgid().filter(|&g| g != shell);
        let groups: Vec<Pid> = [Some(shell), fg]
            .into_iter()
            .flatten()
            .map(Pid::from_raw)
            .collect();
        for &g in &groups {
            let _ = killpg(g, Signal::SIGHUP);
        }
        if tokio::time::timeout(grace, wait_exit(&mut exit_rx))
            .await
            .is_ok()
        {
            return;
        }
        for &g in &groups {
            let _ = killpg(g, Signal::SIGKILL);
        }
        wait_exit(&mut exit_rx).await;
    }
}
