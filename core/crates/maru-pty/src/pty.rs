use crate::master::{self, Master};
use crate::procinfo;
use crate::program_status::Records;
use crate::vt::{VtFormat, VtTerminal};
use anyhow::Result;
use nix::sys::signal::{Signal, killpg};
use nix::unistd::Pid;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::sync::{Notify, watch};

const READ_CHUNK: usize = 8192;
const OUTPUT_BACKLOG: usize = 4 * 1024 * 1024;
/// 셸이 나간 뒤 남은 출력이 다 전달되길 기다리되, EOF 에 종료를 묶지 않으려는 상한.
const DRAIN_AFTER_EXIT: Duration = Duration::from_millis(500);
const FOREGROUND_POLL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Exit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

/// tty 의 foreground 프로세스 그룹 리더. 프롬프트에서는 셸, 명령이 돌고 있으면 그 명령이다.
#[derive(Debug)]
pub struct Foreground {
    pub pid: i32,
    /// 리더가 이미 끝났거나 읽을 수 없으면 None 이다.
    pub cwd: Option<PathBuf>,
}

pub struct ReplayState {
    pub cols: u16,
    pub rows: u16,
    pub cursor_x: u16,
    pub cursor_y: u16,
}

pub enum Recv {
    Data(Vec<u8>),
    Size {
        cols: u16,
        rows: u16,
    },
    /// 클라이언트에 그대로 보낼 JSON 한 건(`program_status`·`foreground`). 구독자마다 복사하지
    /// 않으려고 `Arc` 다.
    Text(Arc<str>),
    /// 밀린 출력을 버렸다. 화면이 어긋났으니 `subscribe_with_replay` 로 다시 받아야 한다.
    Lagged,
}

pub struct Output {
    /// 자기가 바꾼 크기는 알리지 않으려고 둔다.
    conn: u64,
    backlog: Mutex<Backlog>,
    notify: Notify,
}

/// 크기 변경을 출력과 같은 큐에 넣는다. 따로 보내면 새 크기로 나온 출력이 먼저 닿을 수 있다.
#[derive(Default)]
struct Backlog {
    queue: VecDeque<Recv>,
    bytes: usize,
    lagged: bool,
}

impl Output {
    fn push(&self, bytes: &[u8]) {
        let mut b = self.backlog.lock().unwrap();
        if b.lagged {
            return;
        }
        if b.bytes + bytes.len() > OUTPUT_BACKLOG {
            b.lagged = true;
            b.queue.clear();
            b.bytes = 0;
        } else {
            b.bytes += bytes.len();
            match b.queue.back_mut() {
                Some(Recv::Data(data)) => data.extend_from_slice(bytes),
                _ => b.queue.push_back(Recv::Data(bytes.to_vec())),
            }
        }
        drop(b);
        self.notify.notify_one();
    }

    fn push_size(&self, cols: u16, rows: u16) {
        let mut b = self.backlog.lock().unwrap();
        // 밀렸으면 resync 헤더가 크기를 싣는다.
        if b.lagged {
            return;
        }
        if let Some(Recv::Size { .. }) = b.queue.back() {
            b.queue.pop_back();
        }
        b.queue.push_back(Recv::Size { cols, rows });
        drop(b);
        self.notify.notify_one();
    }

    fn push_text(&self, text: &Arc<str>) {
        let mut b = self.backlog.lock().unwrap();
        // 밀렸으면 resync 재생이 레코드를 다시 싣는다.
        if b.lagged {
            return;
        }
        // Text 도 bytes 에 센다. 읽지 않는 클라이언트의 큐가 Text 만으로 한도 없이 자라지 않게 하기 위해서다.
        if b.bytes + text.len() > OUTPUT_BACKLOG {
            b.lagged = true;
            b.queue.clear();
            b.bytes = 0;
        } else {
            b.bytes += text.len();
            b.queue.push_back(Recv::Text(text.clone()));
        }
        drop(b);
        self.notify.notify_one();
    }

    pub fn try_recv(&self) -> Option<Recv> {
        let mut b = self.backlog.lock().unwrap();
        if b.lagged {
            return Some(Recv::Lagged);
        }
        let r = b.queue.pop_front()?;
        match &r {
            Recv::Data(data) => b.bytes -= data.len(),
            Recv::Text(text) => b.bytes -= text.len(),
            _ => {}
        }
        Some(r)
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

pub struct Pty {
    pub tty: String,
    pub shell_pid: u32,
    master: Master,
    writer: Arc<Mutex<std::fs::File>>,
    screen: Arc<Mutex<Screen>>,
    exit_rx: watch::Receiver<Option<Exit>>,
    primary: watch::Sender<Option<u64>>,
    next_conn: AtomicU64,
    terminating: AtomicBool,
    /// `Drop` 에서 깨워 기다리던 감시 스레드가 끝나게 한다.
    wake: Arc<Wake>,
}

impl Drop for Pty {
    fn drop(&mut self) {
        self.wake.wake();
    }
}

/// 크기와 레코드를 VT 와 같은 락 아래 두어 재생 스냅샷과 어긋나지 않게 한다.
struct Screen {
    vt: VtTerminal,
    cols: u16,
    rows: u16,
    status: Records,
    outputs: Vec<Weak<Output>>,
}

impl Screen {
    fn broadcast(&mut self, f: impl Fn(&Output)) {
        self.outputs
            .retain(|o| o.upgrade().inspect(|o| f(o)).is_some());
    }

    fn broadcast_text(&mut self, text: String) {
        let text: Arc<str> = text.into();
        self.broadcast(|o| o.push_text(&text));
    }
}

/// foreground 감시 스레드를 레코드가 생겼을 때만 깨운다. 레코드가 없는 pane 마다 1초에 한 번씩
/// 깨어나지 않게 하려는 것이다.
#[derive(Default)]
struct Wake {
    flag: Mutex<bool>,
    cv: std::sync::Condvar,
}

impl Wake {
    fn wake(&self) {
        *self.flag.lock().unwrap() = true;
        self.cv.notify_one();
    }

    fn wait(&self) {
        let mut flag = self.flag.lock().unwrap();
        while !*flag {
            flag = self.cv.wait(flag).unwrap();
        }
        *flag = false;
    }
}

impl Pty {
    pub fn spawn(
        shell: &Path,
        shell_var: Option<&Path>,
        cwd: Option<&Path>,
        command: &[String],
        cols: u16,
        rows: u16,
    ) -> Result<Arc<Self>> {
        // 셸이 뜬 뒤 크기 검사에 걸리면 그 셸을 쥘 핸들이 없다.
        let screen = Arc::new(Mutex::new(Screen {
            vt: VtTerminal::new(cols, rows)?,
            cols,
            rows,
            status: Records::default(),
            outputs: Vec::new(),
        }));
        let spawned = master::spawn(shell, shell_var, cwd, command, cols, rows)?;
        let shell_pid = spawned.child.id();
        let (exit_tx, exit_rx) = watch::channel(None);
        let (drained_tx, drained_rx) = std::sync::mpsc::channel::<()>();

        let mut reader = spawned.reader;
        // 셸 입력과 같은 락으로 써야 응답이 입력 시퀀스 중간에 끼지 않는다. 읽기 스레드가 PTY 쓰기나
        // 그 락에 막히면 모든 구독자의 출력이 멈추므로, 쓰기는 따로 둔 스레드가 순서대로 한다.
        let writer = Arc::new(Mutex::new(spawned.writer));
        let (reply_tx, reply_rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let reply_writer = writer.clone();
        std::thread::spawn(move || {
            for reply in reply_rx {
                let mut w = reply_writer.lock().unwrap();
                let _ = w.write_all(&reply).and_then(|()| w.flush());
            }
        });
        let wake = Arc::new(Wake::default());
        let screen_r = screen.clone();
        let wake_r = wake.clone();
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
                let events = screen.vt.take_events();
                if !events.reports.is_empty() {
                    let now = std::time::Instant::now();
                    let mut changed = false;
                    for report in &events.reports {
                        changed |= screen.status.apply(report, now);
                    }
                    // 보고를 실은 바이트보다 먼저 보낸다. 같은 청크에 보고와 그 뒤 출력이 함께
                    // 들어 있으면 클라이언트가 출력을 보고 다음 일을 시작한 뒤에 상태가 닿는다.
                    if changed {
                        let text = screen.status.message().to_string();
                        screen.broadcast_text(text);
                    }
                    if !screen.status.is_empty() {
                        wake_r.wake();
                    }
                }
                screen.broadcast(|o| o.push(bytes));
                drop(screen);
                for reply in events.pty_replies {
                    let _ = reply_tx.send(reply);
                }
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

        let pty = Arc::new(Pty {
            tty: spawned.tty,
            shell_pid,
            master: spawned.master,
            writer,
            screen,
            exit_rx,
            primary: watch::channel(None).0,
            next_conn: AtomicU64::new(1),
            terminating: AtomicBool::new(false),
            wake: wake.clone(),
        });
        let weak = Arc::downgrade(&pty);
        std::thread::spawn(move || watch_foreground(weak, wake));
        Ok(pty)
    }

    /// 블로킹 쓰기여야 한다 — 커널의 역압이 입력 큐를 넘는 여러 줄 입력이 잘리지 않게 지킨다.
    pub fn write(&self, bytes: &[u8]) -> std::io::Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(bytes)?;
        w.flush()
    }

    /// primary 를 바꾸는 것과 크기를 맞추는 것을 screen 락 하나로 묶는다. 따로 잡으면 그 사이에
    /// 다른 연결이 자리와 크기를 가져간 뒤 이 연결이 자기 크기로 덮는다.
    pub fn claim_primary(&self, conn: u64, size: Option<(u16, u16)>) -> Result<()> {
        let mut screen = self.screen.lock().unwrap();
        self.primary.send_replace(Some(conn));
        match size {
            Some((cols, rows)) => self.resize_locked(&mut screen, conn, cols, rows),
            None => Ok(()),
        }
    }

    pub fn resize_if_primary(&self, conn: u64, cols: u16, rows: u16) -> Result<()> {
        let mut screen = self.screen.lock().unwrap();
        if !self.is_primary(conn) {
            return Ok(());
        }
        self.resize_locked(&mut screen, conn, cols, rows)
    }

    fn resize_locked(&self, screen: &mut Screen, conn: u64, cols: u16, rows: u16) -> Result<()> {
        let changed = (screen.cols, screen.rows) != (cols, rows);
        // VT 가 먼저 거절해야 PTY 가 그대로 남는다.
        screen.vt.resize(cols, rows)?;
        self.master.resize(cols, rows)?;
        screen.cols = cols;
        screen.rows = rows;
        if !changed {
            return Ok(());
        }
        screen.broadcast(|o| {
            if o.conn != conn {
                o.push_size(cols, rows)
            }
        });
        Ok(())
    }

    pub fn capture(&self, unwrap: bool) -> Result<Vec<u8>> {
        let fmt = if unwrap {
            VtFormat::PlainUnwrapped
        } else {
            VtFormat::Plain
        };
        self.screen.lock().unwrap().vt.format(fmt)
    }

    pub fn foreground(&self) -> Foreground {
        let pid = self
            .master
            .foreground_pgid()
            .unwrap_or(self.shell_pid as i32);
        Foreground {
            pid,
            cwd: procinfo::cwd(pid),
        }
    }

    /// 재생과 같은 락 안에서 뜬 `program_status` 메시지를 함께 돌려준다. 따로 읽으면 그 사이에
    /// 온 보고가 재생 뒤 메시지와 구독 양쪽에 들어가거나 어느 쪽에도 안 들어간다.
    pub fn subscribe_with_replay(
        &self,
        conn: u64,
    ) -> Result<(Vec<u8>, ReplayState, serde_json::Value, Arc<Output>)> {
        let mut screen = self.screen.lock().unwrap();
        let replay = screen.vt.replay()?;
        let (cursor_x, cursor_y) = screen.vt.cursor()?;
        let state = ReplayState {
            cols: screen.cols,
            rows: screen.rows,
            cursor_x,
            cursor_y,
        };
        let status = screen.status.message();
        let output = Arc::new(Output {
            conn,
            backlog: Mutex::default(),
            notify: Notify::new(),
        });
        screen.outputs.push(Arc::downgrade(&output));
        Ok((replay, state, status, output))
    }

    pub fn exit_rx(&self) -> watch::Receiver<Option<Exit>> {
        self.exit_rx.clone()
    }

    pub fn exited(&self) -> Option<Exit> {
        *self.exit_rx.borrow()
    }

    pub fn terminating(&self) -> bool {
        self.terminating.load(Ordering::SeqCst)
    }

    pub fn next_conn_id(&self) -> u64 {
        self.next_conn.fetch_add(1, Ordering::Relaxed)
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

    pub async fn terminate(&self, grace: Duration) {
        let mut exit_rx = self.exit_rx();
        if exit_rx.borrow().is_some() {
            return;
        }
        self.terminating.store(true, Ordering::SeqCst);
        let shell = self.shell_pid as i32;
        let fg = self.master.foreground_pgid().filter(|&g| g != shell);
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

/// 레코드가 있는 동안 foreground cwd 가 바뀌면 모든 구독자에게 `foreground` 를 보낸다. claude 가 한
/// 상태에 머문 채 디렉토리를 옮긴 것을 앱이 알게 하려는 것이다.
fn watch_foreground(pty: Weak<Pty>, wake: Arc<Wake>) {
    loop {
        wake.wait();
        let mut last: Option<PathBuf> = None;
        loop {
            std::thread::sleep(FOREGROUND_POLL);
            let Some(pty) = pty.upgrade() else {
                return;
            };
            if pty.exited().is_some() || pty.screen.lock().unwrap().status.is_empty() {
                break;
            }
            // 락을 놓고 잰다 — proc 읽기가 느려도 출력 반영을 막지 않게.
            let fg = pty.foreground();
            // 리더가 먼저 끝난 파이프라인(`a | b`)에서는 cwd 를 못 읽는다. 옮긴 것이 아니므로 건너뛴다.
            let Some(cwd) = fg.cwd else { continue };
            if last.as_ref().is_some_and(|l| *l != cwd) {
                let text = serde_json::json!({
                    "type": "foreground", "pid": fg.pid, "cwd": cwd.to_string_lossy(),
                });
                pty.screen.lock().unwrap().broadcast_text(text.to_string());
            }
            last = Some(cwd);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;

    fn size(s: &Pty) -> (u16, u16) {
        let screen = s.screen.lock().unwrap();
        (screen.cols, screen.rows)
    }

    fn race(a: impl FnOnce() + Send + 'static, b: impl FnOnce() + Send + 'static) {
        let barrier = Arc::new(Barrier::new(2));
        let (ba, bb) = (barrier.clone(), barrier);
        let ta = std::thread::spawn(move || {
            ba.wait();
            a();
        });
        let tb = std::thread::spawn(move || {
            bb.wait();
            b();
        });
        ta.join().unwrap();
        tb.join().unwrap();
    }

    fn with_pty(f: impl FnOnce(&Arc<Pty>)) {
        with_pty_in(None, f);
    }

    fn with_pty_in(cwd: Option<&Path>, f: impl FnOnce(&Arc<Pty>)) {
        let s = Pty::spawn(Path::new("/bin/sh"), None, cwd, &[], 80, 24).unwrap();
        f(&s);
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(s.terminate(Duration::from_secs(2)));
    }

    fn wait_foreground(s: &Pty, pred: impl Fn(&Foreground) -> bool) -> Foreground {
        for _ in 0..300 {
            let fg = s.foreground();
            if pred(&fg) {
                return fg;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        s.foreground()
    }

    #[test]
    fn the_foreground_is_the_shell_at_the_prompt_and_the_command_while_it_runs() {
        let dir = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        with_pty_in(Some(&dir), |s| {
            let shell = s.shell_pid as i32;

            let fg = wait_foreground(s, |fg| fg.pid == shell && fg.cwd.is_some());
            assert_eq!(fg.cwd.as_deref(), Some(dir.as_path()));

            s.write(b"cd /\n").unwrap();
            let fg = wait_foreground(s, |fg| fg.cwd.as_deref() == Some(Path::new("/")));
            assert_eq!(fg.pid, shell, "cd 뒤에도 프롬프트에서는 셸이다");

            s.write(b"sleep 5\n").unwrap();
            let fg = wait_foreground(s, |fg| fg.pid != shell && fg.cwd.is_some());
            assert_ne!(fg.pid, shell, "명령이 돌면 그 명령이다");
            assert_eq!(fg.cwd.as_deref(), Some(Path::new("/")));
        });
    }

    #[test]
    fn the_foreground_has_no_cwd_once_the_shell_has_exited() {
        let s = Pty::spawn(Path::new("/bin/sh"), None, None, &[], 80, 24).unwrap();
        s.write(b"exit\n").unwrap();
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(wait_exit(&mut s.exit_rx()));
        assert_eq!(s.foreground().cwd, None);
    }

    #[test]
    fn the_size_follows_whichever_primary_claimed_last() {
        with_pty(|s| {
            for i in 0..5000 {
                let (a, b) = (s.next_conn_id(), s.next_conn_id());
                let (sa, sb) = (s.clone(), s.clone());
                race(
                    move || sa.claim_primary(a, Some((100, 30))).unwrap(),
                    move || sb.claim_primary(b, Some((120, 40))).unwrap(),
                );
                let want = if s.is_primary(a) {
                    (100, 30)
                } else {
                    (120, 40)
                };
                assert_eq!(size(s), want, "{i}번째");
            }
        });
    }

    #[test]
    fn a_primary_that_lost_its_seat_does_not_resize() {
        with_pty(|s| {
            for i in 0..5000 {
                let (a, b) = (s.next_conn_id(), s.next_conn_id());
                s.claim_primary(a, Some((80, 24))).unwrap();
                let (sa, sb) = (s.clone(), s.clone());
                race(
                    move || sa.resize_if_primary(a, 100, 30).unwrap(),
                    move || sb.claim_primary(b, Some((120, 40))).unwrap(),
                );
                assert_eq!(size(s), (120, 40), "{i}번째");
            }
        });
    }
}
