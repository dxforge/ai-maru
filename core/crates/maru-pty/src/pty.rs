use crate::master::{self, Master};
use crate::procinfo;
use crate::program_status::Records;
use crate::state::{PaneState, same_dir_as};
use crate::vt::{VtEvents, VtFormat, VtTerminal};
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

    pub fn try_recv(&self) -> Option<Recv> {
        let mut b = self.backlog.lock().unwrap();
        if b.lagged {
            return Some(Recv::Lagged);
        }
        let r = b.queue.pop_front()?;
        if let Recv::Data(data) = &r {
            b.bytes -= data.len();
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

pub(crate) fn epoch_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
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
    /// 띄울 때 받은 `--cwd`. 셸 cwd 가 없을 때 foreground cwd 를 이 경로와 견준다.
    start_cwd: Option<String>,
}

impl Drop for Pty {
    fn drop(&mut self) {
        self.wake.wake();
    }
}

/// 크기를 VT 와 같은 락 아래 두어 재생 스냅샷과 어긋나지 않게 한다. 상태도 VT 의 제목을 읽으므로 같은 락 아래 둔다.
struct Screen {
    vt: VtTerminal,
    cols: u16,
    rows: u16,
    status: Records,
    pane: PaneState,
    outputs: Vec<Weak<Output>>,
    /// 상태 구독자에게 보낼 마지막 상태. 이 프로세스가 끝날 때 비워 구독 연결을 닫게 한다.
    state_tx: Option<watch::Sender<Arc<str>>>,
}

impl Screen {
    fn broadcast(&mut self, f: impl Fn(&Output)) {
        self.outputs
            .retain(|o| o.upgrade().inspect(|o| f(o)).is_some());
    }

    /// 한 `write` 의 콜백 결과를 상태에 반영하고, 상태가 바뀌었을 수 있으면 true 다. 제목은 VT 가 들고 있어
    /// 콜백이 불렸는지만 본다.
    fn apply_events(&mut self, events: &VtEvents) -> bool {
        let now = std::time::Instant::now();
        let mut changed = events.title_changed;
        for report in &events.reports {
            changed |= self.status.apply(report, now);
        }
        for event in &events.cwd {
            changed |= self.pane.apply(event);
        }
        if !events.commands.is_empty() {
            let now = epoch_millis();
            for event in &events.commands {
                changed |= self.pane.apply_command(event, now);
            }
        }
        if self.status.is_empty() {
            changed |= self.pane.foreground_cwd.take().is_some();
        }
        changed
    }

    fn state_message(&self) -> Arc<str> {
        self.pane.message(self.vt.title(), &self.status).into()
    }

    /// 상태가 지난번 보낸 것과 다르면 모든 구독자에게 보낸다. ghostty 는 같은 제목에도 콜백을 부르므로 견준다.
    fn publish_state(&mut self) {
        let message = self.state_message();
        if let Some(tx) = &self.state_tx {
            tx.send_if_modified(|last| {
                let changed = *last != message;
                if changed {
                    *last = message;
                }
                changed
            });
        }
    }
}

/// foreground 감시 스레드를 레코드가 생겼을 때와, 레코드가 있는 동안 셸이 OSC 7 을 보고했을 때 깨운다. 레코드가 없는
/// pane 마다 1초에 한 번씩 깨어나지 않게 하려는 것이다.
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

    fn wait_timeout(&self, dur: Duration) {
        let flag = self.flag.lock().unwrap();
        let (mut flag, _) = self.cv.wait_timeout_while(flag, dur, |f| !*f).unwrap();
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
        let mut screen = Screen {
            vt: VtTerminal::new(cols, rows)?,
            cols,
            rows,
            status: Records::default(),
            pane: if command.is_empty() {
                PaneState::default()
            } else {
                PaneState::for_command(command, epoch_millis())
            },
            outputs: Vec::new(),
            state_tx: None,
        };
        screen.state_tx = Some(watch::channel(screen.state_message()).0);
        let screen = Arc::new(Mutex::new(screen));
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
                let had_records = !screen.status.is_empty();
                screen.vt.write(bytes);
                let events = screen.vt.take_events();
                // 보고를 실은 바이트보다 먼저 구독자에게 넣는다. 다른 연결이라 순서가 보장되지는 않지만,
                // 같은 청크의 출력을 보고 다음 일을 시작한 클라이언트에 상태가 늦게 닿는 일을 줄인다.
                if screen.apply_events(&events) {
                    screen.publish_state();
                }
                // 셸이 `cd` 한 뒤 보낸 OSC 7 이면 다음 1초를 기다리지 않고 잰다. 그동안 화면 cwd 가 옛 foreground
                // cwd 로 남지 않게 하려는 것이다.
                if !screen.status.is_empty() && (!had_records || !events.cwd.is_empty()) {
                    wake_r.wake();
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
            start_cwd: cwd.and_then(Path::to_str).map(str::to_owned),
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

    /// 지우는 바이트를 PTY 출력과 같은 락 안에서 VT 에 쓰고 모든 구독자에게 보낸다. 출력 사이에 같은
    /// 순서로 끼어야 클라이언트의 xterm 이 이 화면과 같게 지워진다.
    pub fn clear_scrollback_if_primary(&self, conn: u64) -> Result<()> {
        let mut screen = self.screen.lock().unwrap();
        if !self.is_primary(conn) {
            return Ok(());
        }
        let Some(seq) = screen.vt.clear_scrollback_sequence()? else {
            return Ok(());
        };
        screen.vt.write(&seq);
        screen.broadcast(|o| o.push(&seq));
        Ok(())
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

    pub fn subscribe_with_replay(&self, conn: u64) -> Result<(Vec<u8>, ReplayState, Arc<Output>)> {
        let mut screen = self.screen.lock().unwrap();
        let replay = screen.vt.replay()?;
        let (cursor_x, cursor_y) = screen.vt.cursor()?;
        let state = ReplayState {
            cols: screen.cols,
            rows: screen.rows,
            cursor_x,
            cursor_y,
        };
        let output = Arc::new(Output {
            conn,
            backlog: Mutex::default(),
            notify: Notify::new(),
        });
        screen.outputs.push(Arc::downgrade(&output));
        Ok((replay, state, output))
    }

    /// 돌려준 구독의 첫 `changed()` 는 곧바로 돌아오므로 지금 상태부터 읽을 수 있다. 프로세스가 끝나는 중이면 이미 닫힌 구독을 돌려준다.
    pub fn subscribe_state(&self) -> watch::Receiver<Arc<str>> {
        let screen = self.screen.lock().unwrap();
        let Some(tx) = &screen.state_tx else {
            return watch::channel(Arc::from("")).1;
        };
        let mut rx = tx.subscribe();
        rx.mark_changed();
        rx
    }

    /// 구독 연결이 남은 상태를 보낸 뒤 닫히게 한다. 이 프로세스가 끝날 때 부른다.
    pub fn close_state_subscriptions(&self) {
        self.screen.lock().unwrap().state_tx = None;
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

/// 레코드가 있는 동안 foreground cwd 를 상태에 둔다. claude 가 한 상태에 머문 채 디렉토리를 옮긴 것을 앱이 알게
/// 하려는 것이다. 레코드가 생겨 깨어나면 바로 한 번 재고, 그 뒤로 1초마다 잰다. 그사이 셸이 OSC 7 을 보고하면 바로 잰다.
fn watch_foreground(pty: Weak<Pty>, wake: Arc<Wake>) {
    loop {
        wake.wait();
        loop {
            let Some(pty) = pty.upgrade() else {
                return;
            };
            let keep = {
                let screen = pty.screen.lock().unwrap();
                if pty.exited().is_some() || screen.status.is_empty() {
                    break;
                }
                // 셸 없이 띄운 명령은 OSC 7 이 없다. 그때는 시작 디렉토리의 경로(심볼릭 링크일 수 있다)를 지킨다.
                screen.pane.cwd.clone().or_else(|| pty.start_cwd.clone())
            };
            // 락을 놓고 잰다 — proc 읽기가 느려도 출력 반영을 막지 않게.
            // 리더가 먼저 끝난 파이프라인(`a | b`)에서는 cwd 를 못 읽는다. 옮긴 것이 아니므로 그대로 둔다.
            if let Some(cwd) = pty.foreground().cwd {
                let cwd = same_dir_as(&cwd, keep.as_deref());
                let mut screen = pty.screen.lock().unwrap();
                // 재는 동안 레코드가 비었으면 읽기 스레드가 지운 값을 되살리지 않는다.
                if !screen.status.is_empty() && screen.pane.foreground_cwd.as_ref() != Some(&cwd) {
                    screen.pane.foreground_cwd = Some(cwd);
                    screen.publish_state();
                }
            }
            // 자는 동안 `Pty` 를 쥐고 있으면 프로세스가 끝나도 이 스레드가 놓지 않는다.
            drop(pty);
            wake.wait_timeout(FOREGROUND_POLL);
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
    fn a_subscription_gets_the_current_state_and_nothing_once_closed() {
        with_pty(|s| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let mut rx = s.subscribe_state();
            assert!(rt.block_on(rx.changed()).is_ok());
            assert!(rx.borrow_and_update().contains(r#""type":"state""#));

            let mut open = s.subscribe_state();
            s.close_state_subscriptions();
            assert!(
                rt.block_on(open.changed()).is_ok(),
                "닫기 전에 보지 않은 상태는 보낸다"
            );
            open.borrow_and_update();
            assert!(rt.block_on(open.changed()).is_err());
            assert!(
                rt.block_on(s.subscribe_state().changed()).is_err(),
                "닫은 뒤 연 구독은 아무것도 보내지 않고 닫혀 있다"
            );
        });
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
