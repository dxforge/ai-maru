//! 대화에 아무것도 보내지 않는다. 임시 디렉토리를 믿는다고 답하므로, 돌릴 때마다 claude 의 설정에 그
//! 디렉토리가 남는다.

use nix::pty::{Winsize, openpty};
use nix::sys::signal::{Signal, kill};
use nix::unistd::Pid;
use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct Claude {
    child: Child,
    master: File,
    screen: Arc<Mutex<Vec<u8>>>,
    _cwd: tempfile::TempDir,
}

impl Claude {
    fn spawn() -> Self {
        let cwd = tempfile::tempdir().unwrap();
        let size = Winsize {
            ws_row: 50,
            ws_col: 200,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let pty = openpty(Some(&size), None).unwrap();
        let plugin =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../app/resources/claude-plugin");
        let mut cmd = Command::new("claude");
        cmd.arg("--plugin-dir")
            .arg(plugin)
            .current_dir(cwd.path())
            .env("MARU_CLI", env!("CARGO_BIN_EXE_maru"))
            .stdin(Stdio::from(pty.slave.try_clone().unwrap()))
            .stdout(Stdio::from(pty.slave.try_clone().unwrap()))
            .stderr(Stdio::from(pty.slave));
        // 이 테스트를 claude 안에서 돌리면 바깥 claude 의 값이 안쪽 claude 를 바꾼다.
        for (name, _) in std::env::vars() {
            if name.starts_with("CLAUDE_CODE") || name == "CLAUDECODE" {
                cmd.env_remove(name);
            }
        }
        unsafe {
            cmd.pre_exec(|| {
                nix::unistd::setsid()?;
                if nix::libc::ioctl(0, nix::libc::TIOCSCTTY.into(), 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let child = cmd.spawn().expect("claude is not on PATH");
        let master = File::from(pty.master);
        let screen = Arc::new(Mutex::new(Vec::new()));
        let mut reader = master.try_clone().unwrap();
        let sink = screen.clone();
        // 읽지 않으면 claude 가 화면을 쓰다 막힌다.
        std::thread::spawn(move || {
            let mut buf = [0; 65536];
            while let Ok(n @ 1..) = reader.read(&mut buf) {
                sink.lock().unwrap().extend_from_slice(&buf[..n]);
            }
        });
        Claude {
            child,
            master,
            screen,
            _cwd: cwd,
        }
    }

    fn pid(&self) -> i32 {
        self.child.id() as i32
    }

    fn type_text(&mut self, text: &str) {
        self.master.write_all(text.as_bytes()).unwrap();
    }

    fn shows(&self, text: &str) -> bool {
        let screen = self.screen.lock().unwrap();
        screen.windows(text.len()).any(|w| w == text.as_bytes())
    }

    fn monitors(&mut self) -> Vec<i32> {
        // 처음 여는 디렉토리라 claude 가 폴더를 믿을지 묻는다. 기본 선택지는 No, exit 다. 화면은
        // 단어 사이를 커서 이동으로 그려서 한 단어로 찾는다.
        let mut trusted = false;
        let mut found = Vec::new();
        assert!(
            until(Duration::from_secs(10), || {
                if !trusted && self.shows("trust") {
                    // 창이 뜨자마자 고르면 다시 그려지며 선택이 No, exit 로 돌아간다.
                    std::thread::sleep(Duration::from_secs(2));
                    self.type_text("\x1b[B");
                    std::thread::sleep(Duration::from_millis(500));
                    self.type_text("\r");
                    trusted = true;
                }
                found = monitors_of(self.pid());
                !found.is_empty()
            }),
            "monitor 가 뜨지 않았다. 화면:\n{}",
            String::from_utf8_lossy(&self.screen.lock().unwrap())
        );
        found
    }
}

impl Drop for Claude {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn until(limit: Duration, mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + limit;
    while Instant::now() < deadline {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    done()
}

fn monitors_of(claude: i32) -> Vec<i32> {
    let out = Command::new("ps")
        .args(["-axo", "pid=,ppid=,command="])
        .output()
        .unwrap();
    let procs: Vec<(i32, i32, String)> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse().ok()?;
            let ppid = fields.next()?.parse().ok()?;
            Some((pid, ppid, fields.collect::<Vec<_>>().join(" ")))
        })
        .collect();
    let parent = |pid: i32| procs.iter().find(|p| p.0 == pid).map(|p| p.1);
    let monitor = format!("{} claude monitor", env!("CARGO_BIN_EXE_maru"));
    procs
        .iter()
        .filter(|(_, _, command)| *command == monitor)
        .filter(|(pid, _, _)| {
            let mut pid = *pid;
            while let Some(ppid) = parent(pid).filter(|&p| p > 1) {
                if ppid == claude {
                    return true;
                }
                pid = ppid;
            }
            false
        })
        .map(|p| p.0)
        .collect()
}

fn alive(pid: i32) -> bool {
    kill(Pid::from_raw(pid), None).is_ok()
}

/// 남은 monitor 는 죽이고 실패시켜, 실패한 테스트가 프로세스를 남기지 않게.
fn assert_gone(monitors: &[i32]) {
    if until(Duration::from_secs(5), || {
        !monitors.iter().any(|&p| alive(p))
    }) {
        return;
    }
    for &pid in monitors {
        let _ = kill(Pid::from_raw(pid), Signal::SIGKILL);
    }
    panic!("monitor 가 남았다: {monitors:?}");
}

#[test]
#[ignore = "needs a logged-in claude on PATH"]
fn claude_stops_the_monitor_on_exit() {
    let mut claude = Claude::spawn();
    let monitors = claude.monitors();
    claude.type_text("/exit");
    // 명령 자동완성 목록이 뜨기 전에 Enter 를 보내면 받지 않는다.
    std::thread::sleep(Duration::from_secs(1));
    claude.type_text("\r");
    assert!(
        until(Duration::from_secs(5), || claude
            .shows("Background work is running")),
        "/exit 가 monitor 를 묻지 않았다"
    );
    // 첫 선택지 Exit and stop tasks
    claude.type_text("\r");
    assert_gone(&monitors);
}

fn assert_gone_after(signal: Signal) {
    let mut claude = Claude::spawn();
    let monitors = claude.monitors();
    kill(Pid::from_raw(claude.pid()), signal).unwrap();
    assert_gone(&monitors);
}

#[test]
#[ignore = "needs a logged-in claude on PATH"]
fn the_monitor_ends_when_claude_is_killed() {
    assert_gone_after(Signal::SIGKILL);
}

/// 세션을 끝낼 때 `maru-session` 은 포그라운드의 claude 에 SIGHUP 을 보낸다.
#[test]
#[ignore = "needs a logged-in claude on PATH"]
fn the_monitor_ends_when_claudes_terminal_hangs_up() {
    assert_gone_after(Signal::SIGHUP);
}
