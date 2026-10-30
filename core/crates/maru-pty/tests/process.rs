use maru_pty::PROTOCOL_VERSION;
use maru_pty::frame::{TAG_BINARY, TAG_TEXT, decode_header, encode};
use maru_pty::paths::Paths;
use maru_pty::record::{self, Record};
use nix::sys::signal::{Signal, kill, killpg};
use nix::unistd::Pid;
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(10);

struct Proc {
    child: Child,
    _tmp: tempfile::TempDir,
    dir: PathBuf,
    id: String,
    paths: Paths,
}

fn spawn(dir: &Path, id: &str) -> Child {
    spawn_with(dir, id, &[])
}

fn spawn_with(dir: &Path, id: &str, extra: &[&std::ffi::OsStr]) -> Child {
    spawn_env(dir, id, extra, &[])
}

fn spawn_env(dir: &Path, id: &str, extra: &[&std::ffi::OsStr], env: &[(&str, &Path)]) -> Child {
    Command::new(env!("CARGO_BIN_EXE_maru-pty"))
        .args([
            "--id", id, "--shell", "/bin/sh", "--cols", "80", "--rows", "24",
        ])
        .arg("--dir")
        .arg(dir)
        .args(extra)
        .envs(env.iter().copied())
        // 셸의 TERM 이 상속값이 아니라 pty 프로세스가 정한 값인지 보려고 일부러 다르게 둔다.
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

fn tmpdir() -> tempfile::TempDir {
    // macOS 의 기본 temp 디렉토리는 길어서 소켓 경로 한도에 가까워진다.
    tempfile::Builder::new()
        .prefix("ms")
        .tempdir_in("/tmp")
        .unwrap()
}

fn start() -> Proc {
    start_in(tmpdir(), &[])
}

fn start_in(tmp: tempfile::TempDir, extra: &[&std::ffi::OsStr]) -> Proc {
    start_env(tmp, extra, &[])
}

fn start_env(tmp: tempfile::TempDir, extra: &[&std::ffi::OsStr], env: &[(&str, &Path)]) -> Proc {
    start_child(tmp, |dir, id| spawn_env(dir, id, extra, env))
}

fn start_child(tmp: tempfile::TempDir, spawn: impl FnOnce(&Path, &str) -> Child) -> Proc {
    let dir = tmp.path().join("s");
    let id = "pty-test".to_string();
    let mut p = Proc {
        child: spawn(&dir, &id),
        paths: Paths::new(&dir, &id).unwrap(),
        _tmp: tmp,
        dir,
        id,
    };
    p.wait_ready();
    p
}

impl Proc {
    fn wait_ready(&mut self) {
        let deadline = Instant::now() + WAIT;
        while UnixStream::connect(self.socket()).is_err() {
            assert!(
                self.child.try_wait().unwrap().is_none(),
                "pty 프로세스가 준비 전에 끝났다"
            );
            assert!(Instant::now() < deadline, "소켓이 열리지 않았다");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn socket(&self) -> &Path {
        &self.paths.socket
    }

    fn record_path(&self) -> &Path {
        &self.paths.record
    }

    fn record(&self) -> Record {
        record::read(self.record_path()).unwrap()
    }

    fn connect(&self) -> Conn {
        let s = UnixStream::connect(self.socket()).unwrap();
        s.set_read_timeout(Some(WAIT)).unwrap();
        Conn(s)
    }

    fn request(&self, req: Value) -> Value {
        let mut c = self.connect();
        c.send_text(req);
        c.text()
    }

    fn attach(&self, role: &str, cols: u16, rows: u16) -> (Conn, Value, Vec<u8>) {
        let mut c = self.connect();
        c.send_text(json!({
            "type": "attach", "protocol_version": PROTOCOL_VERSION,
            "role": role, "cols": cols, "rows": rows,
        }));
        let header = c.text();
        assert_eq!(header["type"], "attached", "{header}");
        let (tag, replay) = c.frame().expect("재생 프레임이 없다");
        assert_eq!(tag, TAG_BINARY);
        (c, header, replay)
    }

    fn subscribe(&self) -> (Conn, Value) {
        let mut c = self.connect();
        c.send_text(json!({ "type": "subscribe", "protocol_version": PROTOCOL_VERSION }));
        let first = c.state();
        (c, first)
    }

    fn wait(&mut self) -> ExitStatus {
        let deadline = Instant::now() + WAIT;
        loop {
            if let Some(s) = self.child.try_wait().unwrap() {
                return s;
            }
            assert!(Instant::now() < deadline, "pty 프로세스가 끝나지 않았다");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Proc {
    fn drop(&mut self) {
        if let Ok(rec) = record::read(self.record_path()) {
            let _ = killpg(Pid::from_raw(rec.shell_pid as i32), Signal::SIGKILL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Conn(UnixStream);

impl Conn {
    fn send(&mut self, tag: u8, payload: &[u8]) {
        self.0.write_all(&encode(tag, payload)).unwrap();
    }

    fn send_text(&mut self, v: Value) {
        self.send(TAG_TEXT, v.to_string().as_bytes());
    }

    fn input(&mut self, s: &str) {
        self.send(TAG_BINARY, s.as_bytes());
    }

    fn frame(&mut self) -> Option<(u8, Vec<u8>)> {
        self.try_frame()
            .unwrap_or_else(|e| panic!("프레임을 읽지 못했다: {e}"))
    }

    fn try_frame(&mut self) -> std::io::Result<Option<(u8, Vec<u8>)>> {
        let mut head = [0u8; 5];
        match self.0.read_exact(&mut head) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e),
        }
        let (tag, len) = decode_header(&head).unwrap();
        let mut payload = vec![0u8; len];
        self.0.read_exact(&mut payload)?;
        Ok(Some((tag, payload)))
    }

    fn text(&mut self) -> Value {
        let (tag, payload) = self.frame().expect("응답 없이 끊겼다");
        assert_eq!(tag, TAG_TEXT);
        serde_json::from_slice(&payload).unwrap()
    }

    fn output_until(&mut self, want: &str) -> Vec<Value> {
        self.until(want).0
    }

    fn bytes_until(&mut self, want: &str) -> Vec<u8> {
        self.until(want).1
    }

    fn until(&mut self, want: &str) -> (Vec<Value>, Vec<u8>) {
        let want = want.as_bytes();
        let mut out = Vec::new();
        let mut texts = Vec::new();
        loop {
            let frame = self.try_frame();
            let Ok(Some((tag, payload))) = frame else {
                let tail = &out[out.len().saturating_sub(2000)..];
                panic!(
                    "{:?} 가 나오기 전에 끊겼다({frame:?}). 마지막 출력: {:?}, Text: {texts:?}",
                    String::from_utf8_lossy(want),
                    String::from_utf8_lossy(tail)
                );
            };
            if tag == TAG_TEXT {
                texts.push(serde_json::from_slice(&payload).unwrap());
                continue;
            }
            // 누적분을 매번 다 훑으면 대량 출력에서 이 클라이언트가 밀려 resync 에 걸린다.
            let from = out.len().saturating_sub(want.len());
            out.extend_from_slice(&payload);
            if out[from..].windows(want.len()).any(|w| w == want) {
                return (texts, out);
            }
        }
    }

    fn state(&mut self) -> Value {
        let v = self.text();
        assert_eq!(v["type"], "state", "{v}");
        v
    }

    /// `pred` 를 만족하는 상태가 올 때까지 읽는다. 연결의 읽기 시간 제한(`WAIT`)을 넘으면 실패한다.
    fn state_until(&mut self, pred: impl Fn(&Value) -> bool) -> Value {
        loop {
            let v = self.state();
            if pred(&v) {
                return v;
            }
        }
    }

    fn expect_resync_replay(&mut self) {
        let (tag, replay) = self.frame().expect("resync 재생 전에 끊겼다");
        assert_eq!(tag, TAG_BINARY);
        assert!(replay.starts_with(b"\x1bc"), "리셋으로 시작하지 않는다");
    }

    fn next_text(&mut self) -> Value {
        loop {
            match self.frame() {
                Some((TAG_TEXT, payload)) => return serde_json::from_slice(&payload).unwrap(),
                Some(_) => continue,
                None => panic!("Text 프레임 전에 끊겼다"),
            }
        }
    }

    fn texts_for(&mut self, dur: Duration) -> Vec<Value> {
        let deadline = Instant::now() + dur;
        let mut texts = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            self.0.set_read_timeout(Some(left)).unwrap();
            match self.try_frame() {
                Ok(Some((TAG_TEXT, payload))) => {
                    texts.push(serde_json::from_slice(&payload).unwrap())
                }
                Ok(Some(_)) => continue,
                Ok(None) | Err(_) => break,
            }
        }
        self.0.set_read_timeout(Some(WAIT)).unwrap();
        texts
    }
}

fn pid(raw: u32) -> Pid {
    Pid::from_raw(raw as i32)
}

fn alive(raw: u32) -> bool {
    kill(pid(raw), None).is_ok()
}

fn stderr(child: &mut Child) -> String {
    let mut err = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut err)
        .unwrap();
    err
}

#[test]
fn the_record_is_readable_once_the_socket_accepts_and_the_dir_is_owner_only() {
    let p = start();
    let rec = p.record();
    assert_eq!(rec.protocol_version, PROTOCOL_VERSION);
    assert_eq!(rec.id, p.id);
    assert_eq!(rec.pid, p.child.id());
    assert!(
        rec.tty.starts_with("ttys") || rec.tty.starts_with("pts/"),
        "{}",
        rec.tty
    );
    assert!(alive(rec.shell_pid));
    let mode = std::fs::metadata(&p.dir).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700);
}

#[test]
fn the_process_leaves_its_launchers_session() {
    let p = start();
    let me = pid(p.child.id());
    assert_eq!(nix::unistd::getsid(Some(me)).unwrap(), me);
}

#[test]
fn version_and_kill_ignore_the_protocol_version_but_nothing_else_does() {
    let mut p = start();
    let v = p.request(json!({ "type": "version" }));
    assert_eq!(
        v,
        json!({ "type": "version", "protocol_version": PROTOCOL_VERSION })
    );

    for req in [
        json!({ "type": "capture" }),
        json!({ "type": "attach", "protocol_version": PROTOCOL_VERSION + 1, "role": "observer" }),
    ] {
        let r = p.request(req.clone());
        assert_eq!(r["code"], "protocol_mismatch", "{req} → {r}");
        assert_eq!(r["protocol_version"], PROTOCOL_VERSION);
    }

    let r = p.request(json!({ "type": "kill", "protocol_version": PROTOCOL_VERSION + 1 }));
    assert_eq!(r["type"], "killed");
    assert!(p.wait().success());
}

#[test]
fn reattaching_replays_earlier_output() {
    let p = start();
    let (mut c, header, _) = p.attach("primary", 80, 24);
    assert_eq!(header["protocol_version"], PROTOCOL_VERSION);
    assert_eq!(header["tty"], p.record().tty);
    for k in ["cursor_x", "cursor_y"] {
        assert!(header[k].is_u64(), "{k}: {header}");
    }
    // 셸이 입력을 그대로 되돌려 보여 주므로 결과는 입력에 없는 문자열이어야 한다.
    c.input("echo mark-$((40+2))\n");
    c.output_until("mark-42");
    drop(c);

    let (_c, _, replay) = p.attach("observer", 80, 24);
    assert!(
        String::from_utf8_lossy(&replay).contains("mark-42"),
        "{:?}",
        String::from_utf8_lossy(&replay)
    );
}

#[test]
fn every_attached_client_sees_the_output() {
    let p = start();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let (mut b, _, _) = p.attach("observer", 80, 24);
    a.input("echo both-$((1+1))\n");
    a.output_until("both-2");
    b.output_until("both-2");
}

#[test]
fn capture_returns_the_screen_as_plain_text() {
    let p = start();
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("printf '\\033[31mred-%s\\033[0m\\n' $((2*3))\n");
    c.output_until("red-6");
    let cap = p.request(json!({ "type": "capture", "protocol_version": PROTOCOL_VERSION }));
    let text = cap["text"].as_str().unwrap();
    assert!(text.contains("red-6") && !text.contains('\x1b'), "{text:?}");
}

#[test]
fn only_one_primary_sets_the_size() {
    let p = start();
    let (mut first, h, _) = p.attach("primary", 100, 30);
    assert_eq!(
        (h["cols"].as_u64(), h["rows"].as_u64()),
        (Some(100), Some(30))
    );
    assert_eq!(h["role"], "primary");

    let (mut obs, h, _) = p.attach("observer", 200, 60);
    assert_eq!(
        (h["cols"].as_u64(), h["rows"].as_u64()),
        (Some(100), Some(30))
    );
    assert_eq!(h["role"], "observer");
    obs.send_text(json!({ "type": "resize", "cols": 150, "rows": 50 }));

    let (mut second, h, _) = p.attach("primary", 120, 40);
    assert_eq!(
        (h["cols"].as_u64(), h["rows"].as_u64()),
        (Some(120), Some(40))
    );
    let mut texts = vec![first.next_text(), first.next_text()];
    texts.sort_by_key(|v| v["type"].to_string());
    assert_eq!(
        texts,
        [
            json!({ "type": "role", "role": "observer" }),
            json!({ "type": "size", "cols": 120, "rows": 40 }),
        ]
    );
    first.send_text(json!({ "type": "resize", "cols": 70, "rows": 10 }));

    second.input("stty size\n");
    second.output_until("40 120");
    let (_c, h, _) = p.attach("observer", 1, 1);
    assert_eq!(
        (h["cols"].as_u64(), h["rows"].as_u64()),
        (Some(120), Some(40))
    );
}

const CLEAR_SCROLLBACK: &str = "\x1b[3J";

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|w| w == needle.as_bytes())
}

#[test]
fn clear_scrollback_clears_the_replay_and_reaches_every_client() {
    let p = start();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let (mut b, _, _) = p.attach("observer", 80, 24);
    a.input("seq 1 100; echo done-$((1+1))\n");
    a.output_until("done-2");
    b.output_until("done-2");

    a.send_text(json!({ "type": "clear_scrollback" }));
    b.bytes_until(CLEAR_SCROLLBACK);
    a.bytes_until(CLEAR_SCROLLBACK);

    let (_c, _, replay) = p.attach("observer", 80, 24);
    let replay = String::from_utf8_lossy(&replay);
    assert!(!replay.contains("done-2"), "{replay:?}");
    assert!(!replay.contains("\n50\r"), "{replay:?}");
}

#[test]
fn clear_scrollback_from_an_observer_is_ignored() {
    let p = start();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let (mut b, _, _) = p.attach("observer", 80, 24);
    a.input("echo kept-$((2+3))\n");
    a.output_until("kept-5");

    b.send_text(json!({ "type": "clear_scrollback" }));
    a.input("echo after-$((1+2))\n");
    assert!(!contains(&a.bytes_until("after-3"), CLEAR_SCROLLBACK));

    let (_c, _, replay) = p.attach("observer", 80, 24);
    assert!(String::from_utf8_lossy(&replay).contains("kept-5"));
}

#[test]
fn clear_scrollback_does_nothing_on_the_alternate_screen() {
    let p = start();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let (mut b, _, _) = p.attach("observer", 80, 24);
    a.input("echo kept-$((2+3)); printf '\\033[?1049h'; echo alt-$((3+4))\n");
    a.output_until("alt-7");

    a.send_text(json!({ "type": "clear_scrollback" }));
    a.input("echo after-$((1+2))\n");
    assert!(!contains(&a.bytes_until("after-3"), CLEAR_SCROLLBACK));
    assert!(!contains(&b.bytes_until("after-3"), CLEAR_SCROLLBACK));

    a.input("printf '\\033[?1049l'; echo left-$((4+4))\n");
    a.output_until("left-8");
    let (_c, _, replay) = p.attach("observer", 80, 24);
    assert!(String::from_utf8_lossy(&replay).contains("kept-5"));
}

#[test]
fn kill_ends_the_shell_then_removes_the_files_then_answers() {
    let mut p = start();
    let shell = p.record().shell_pid;
    let (mut c, _, _) = p.attach("primary", 80, 24);

    let r = p.request(json!({ "type": "kill" }));
    assert_eq!(r["type"], "killed");
    assert!(!p.socket().exists() && !p.record_path().exists());
    assert!(!alive(shell), "셸 {shell} 이 살아 있다");

    let exit = c.next_text();
    assert_eq!(exit["type"], "exit", "{exit}");
    assert_eq!(exit["signal"], Signal::SIGHUP as i32);
    assert!(p.wait().success());
}

#[test]
fn termination_signals_take_the_same_cleanup_path() {
    for sig in [Signal::SIGTERM, Signal::SIGINT, Signal::SIGHUP] {
        let mut p = start();
        let shell = p.record().shell_pid;
        kill(pid(p.child.id()), sig).unwrap();
        assert!(p.wait().success(), "{sig}");
        assert!(!p.socket().exists() && !p.record_path().exists(), "{sig}");
        assert!(!alive(shell), "{sig}");
    }
}

#[test]
fn sigterm_right_after_the_record_appears_still_cleans_up() {
    for _ in 0..30 {
        let tmp = tmpdir();
        let dir = tmp.path().join("s");
        let paths = Paths::new(&dir, "pty-test").unwrap();
        let mut child = spawn(&dir, "pty-test");
        let deadline = Instant::now() + WAIT;
        let rec = loop {
            if let Ok(rec) = record::read(&paths.record) {
                break rec;
            }
            assert!(Instant::now() < deadline, "레코드가 생기지 않았다");
        };
        kill(pid(child.id()), Signal::SIGTERM).unwrap();
        assert!(
            child.wait().unwrap().success(),
            "정리 경로를 안 타고 죽었다"
        );
        assert!(!paths.record.exists() && !paths.socket.exists());
        assert!(!alive(rec.shell_pid));
    }
}

#[test]
fn the_process_ends_when_the_shell_exits() {
    let mut p = start();
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("echo bye-$((3+4)); exit 3\n");
    let texts = c.output_until("bye-7");
    assert!(texts.is_empty(), "{texts:?}");
    let exit = c.next_text();
    assert_eq!(exit, json!({ "type": "exit", "code": 3, "signal": null }));
    assert!(p.wait().success());
    assert!(!p.socket().exists() && !p.record_path().exists());
}

fn start_keep(command: &str) -> Proc {
    let args = ["--keep", "--", "/bin/sh", "-c", command];
    let args: Vec<&std::ffi::OsStr> = args.iter().map(|a| a.as_ref()).collect();
    start_in(tmpdir(), &args)
}

fn status(wait: bool) -> Value {
    json!({ "type": "status", "protocol_version": PROTOCOL_VERSION, "wait": wait })
}

#[test]
fn keep_leaves_the_files_and_answers_after_the_shell_exits() {
    let mut p = start_keep("echo done-$((1+1)); exit 3");
    let exit = p.request(status(true));
    assert_eq!(
        exit,
        json!({ "type": "status", "exit": { "code": 3, "signal": null } })
    );
    assert!(p.socket().exists() && p.record_path().exists());
    assert!(p.child.try_wait().unwrap().is_none(), "프로세스가 끝났다");
    let cap = p.request(json!({ "type": "capture", "protocol_version": PROTOCOL_VERSION }));
    assert!(cap["text"].as_str().unwrap().contains("done-2"), "{cap}");
    assert_eq!(p.request(status(false)), exit);

    assert_eq!(p.request(json!({ "type": "kill" }))["type"], "killed");
    assert!(p.wait().success());
    assert!(!p.socket().exists() && !p.record_path().exists());
}

#[test]
fn status_wait_answers_when_the_shell_exits() {
    let p = start_keep("read x; exit 5");
    assert_eq!(
        p.request(status(false)),
        json!({ "type": "status", "exit": null })
    );
    let mut waiting = p.connect();
    waiting.send_text(status(true));
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("go\n");
    let want = json!({ "type": "status", "exit": { "code": 5, "signal": null } });
    assert_eq!(waiting.text(), want);
    assert_eq!(p.request(status(true)), want);
}

#[test]
fn status_wait_closes_without_an_answer_when_the_pty_ends_the_shell() {
    for how in ["kill", "SIGTERM"] {
        let mut p = start_keep("sleep 30");
        let mut waiting = p.connect();
        waiting.send_text(status(true));
        // wait 가 기다리기 시작한 뒤에 끝내야 이 경로를 시험한다.
        std::thread::sleep(Duration::from_millis(100));
        if how == "kill" {
            assert_eq!(p.request(json!({ "type": "kill" }))["type"], "killed");
        } else {
            kill(pid(p.child.id()), Signal::SIGTERM).unwrap();
        }
        assert_eq!(waiting.frame(), None, "{how}");
        assert!(p.wait().success(), "{how}");
    }
}

fn open_fds(pid: u32) -> usize {
    let out = Command::new("lsof")
        .args(["-p", &pid.to_string()])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).lines().count()
}

#[test]
fn status_wait_lets_go_of_a_client_that_hung_up() {
    let p = start_keep("sleep 30");
    let pid = p.child.id();
    let before = open_fds(pid);
    let waits: Vec<Conn> = (0..30)
        .map(|_| {
            let mut c = p.connect();
            c.send_text(status(true));
            c
        })
        .collect();
    let deadline = Instant::now() + WAIT;
    while open_fds(pid) < before + 30 {
        assert!(Instant::now() < deadline, "wait 연결이 다 열리지 않았다");
        std::thread::sleep(Duration::from_millis(50));
    }
    drop(waits);
    while open_fds(pid) > before + 2 {
        assert!(Instant::now() < deadline, "끊은 wait 의 연결이 남았다");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn status_wait_without_keep_answers_then_the_process_ends() {
    let mut p = start();
    let mut waiting = p.connect();
    waiting.send_text(status(true));
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("exit 4\n");
    assert_eq!(
        waiting.text(),
        json!({ "type": "status", "exit": { "code": 4, "signal": null } })
    );
    assert!(p.wait().success());
}

#[test]
fn input_reaches_the_shell_and_is_refused_after_exit() {
    let p = start_keep("read a; echo \"in-$a\"; read b; exit 0");
    let (mut c, _, _) = p.attach("observer", 80, 24);
    let input = |text: &str| {
        p.request(json!({ "type": "input", "protocol_version": PROTOCOL_VERSION, "text": text }))
    };
    assert_eq!(input("x5\r"), json!({ "type": "input" }));
    c.output_until("in-x5");
    input("\r");
    p.request(status(true));
    let refused = input("late\r");
    assert_eq!(
        (&refused["type"], &refused["code"]),
        (&json!("error"), &json!("exited")),
        "{refused}"
    );
}

#[test]
fn foreground_names_the_shell_at_the_prompt_and_the_command_while_it_runs() {
    let p = start();
    let shell = p.record().shell_pid as i64;
    let foreground =
        || p.request(json!({ "type": "foreground", "protocol_version": PROTOCOL_VERSION }));
    let until = |pred: &dyn Fn(&Value) -> bool| {
        let deadline = Instant::now() + WAIT;
        loop {
            let fg = foreground();
            if pred(&fg) {
                return fg;
            }
            assert!(
                Instant::now() < deadline,
                "foreground 가 바뀌지 않았다: {fg}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    until(&|fg| fg["pid"] == shell && fg["name"].is_string());

    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("sleep 30\n");
    // fork 한 뒤 exec 하기 전에는 그룹 리더의 이름이 아직 셸의 것이다.
    until(&|fg| fg["pid"] != shell && fg["name"] == "sleep");
}

#[test]
fn capture_unwrap_joins_a_wrapped_line() {
    let p = start_keep("printf '%0100d\\n' 0");
    p.request(status(true));
    let line = "0".repeat(100);
    let joined = p.request(json!({
        "type": "capture", "protocol_version": PROTOCOL_VERSION, "unwrap": true,
    }));
    assert!(
        joined["text"].as_str().unwrap().lines().any(|l| l == line),
        "{joined}"
    );
    let cut = p.request(json!({ "type": "capture", "protocol_version": PROTOCOL_VERSION }));
    let cut = cut["text"].as_str().unwrap();
    assert!(
        !cut.contains(&line) && cut.lines().any(|l| l == "0".repeat(80)),
        "{cut:?}"
    );
}

#[test]
fn a_command_that_fails_at_once_still_ends_the_process_with_zero() {
    let tmp = tmpdir();
    let dir = tmp.path().join("s");
    let args = ["--", "/bin/sh", "-c", "exit 5"];
    let args: Vec<&std::ffi::OsStr> = args.iter().map(|a| a.as_ref()).collect();
    let mut child = spawn_with(&dir, "pty-test", &args);
    let status = child.wait().unwrap();
    assert!(status.success(), "{status:?}: {}", stderr(&mut child));
}

#[test]
fn the_process_ends_even_if_a_background_job_keeps_the_tty_open() {
    let mut p = start();
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("nohup sleep 30 >/dev/null 2>&1 & echo \"bg=$!=\"; echo done-$((1+1))\n");
    c.output_until("done-2");
    let cap = p.request(json!({ "type": "capture", "protocol_version": PROTOCOL_VERSION }));
    // 되돌려 보인 입력 줄은 80열에서 꺾여 `bg=` 가 쪼개지기도 해서 숫자가 바로 붙은 것만 찾는다.
    let text = cap["text"].as_str().unwrap();
    let job: u32 = text
        .match_indices("bg=")
        .find_map(|(i, _)| {
            let rest = &text[i + 3..];
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            (digits > 0 && rest[digits..].starts_with('=')).then(|| rest[..digits].parse().unwrap())
        })
        .unwrap_or_else(|| panic!("작업 pid 를 못 찾았다: {text:?}"));

    let started = Instant::now();
    c.input("exit 0\n");
    assert_eq!(c.next_text()["type"], "exit");
    assert!(p.wait().success());
    let job_survived = alive(job);
    let _ = kill(pid(job), Signal::SIGKILL);
    assert!(
        job_survived,
        "SIGHUP 을 무시하는 작업이 없어서 이 테스트가 아무것도 재지 않았다"
    );
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
}

#[test]
fn a_second_process_does_not_take_over_a_live_socket() {
    let p = start();
    let mut second = spawn(&p.dir, &p.id);
    let status = second.wait().unwrap();
    assert!(!status.success());
    let err = stderr(&mut second);
    assert!(err.contains("already listening"), "{err}");

    assert_eq!(p.request(json!({ "type": "version" }))["type"], "version");
    assert_eq!(p.record().pid, p.child.id());
}

#[test]
fn an_overlong_socket_path_fails_before_spawning_a_shell() {
    let tmp = tmpdir();
    let dir = tmp.path().join("x".repeat(100));
    let mut child = spawn(&dir, "pty-test");
    assert!(!child.wait().unwrap().success());
    let err = stderr(&mut child);
    assert!(err.contains("shorten"), "{err}");
    assert!(!dir.exists(), "검사에 실패했는데 디렉토리를 만들었다");
}

#[test]
fn the_shell_is_a_login_shell_with_term_and_cwd_set() {
    let tmp = tmpdir();
    let cwd = std::fs::canonicalize(tmp.path()).unwrap();
    let p = start_in(tmp, &["--cwd".as_ref(), cwd.as_os_str()]);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("echo \"a0=[$0]\" \"T=[$TERM]\" \"D=[$(pwd -P)]\"; echo end-$((5+5))\n");
    c.output_until("end-10");
    let cap = p.request(json!({ "type": "capture", "protocol_version": PROTOCOL_VERSION }));
    let text = cap["text"].as_str().unwrap();
    // 셸이 되돌려 보인 입력 줄엔 `$0` 같은 변수 이름이 그대로라, 이 값들은 출력에만 있다.
    assert!(text.contains("a0=[-sh]"), "{text}");
    assert!(text.contains("T=[xterm-256color]"), "{text}");
    assert!(text.contains(&format!("D=[{}]", cwd.display())), "{text}");
}

#[test]
fn a_command_after_the_options_runs_in_the_shell_with_its_arguments_intact() {
    let script = r#"read line; printf '[%s]' "$@"; echo; exit 4"#;
    let args = ["--", "/bin/sh", "-c", script, "sh", "a b", "c'd", "-x", ""];
    let args: Vec<&std::ffi::OsStr> = args.iter().map(|a| a.as_ref()).collect();
    let mut p = start_in(tmpdir(), &args);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("\n");
    c.output_until("[a b][c'd][-x][]");
    let exit = c.next_text();
    assert_eq!(exit, json!({ "type": "exit", "code": 4, "signal": null }));
    assert!(p.wait().success());
}

#[test]
fn a_command_finds_what_the_interactive_rc_defines() {
    let tmp = tmpdir();
    let rc = tmp.path().join("rc");
    std::fs::write(&rc, "from_rc() { read line; echo \"rc-$((2+3))\"; }\n").unwrap();
    // 대화형 sh 는 $ENV 의 파일을 읽는다.
    let mut p = start_env(tmp, &["--".as_ref(), "from_rc".as_ref()], &[("ENV", &rc)]);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("\n");
    c.output_until("rc-5");
    assert_eq!(c.next_text()["type"], "exit");
    assert!(p.wait().success());
}

#[test]
fn a_command_runs_under_sh_when_the_shell_is_not_posix() {
    let tmp = tmpdir();
    // `"$@"` 를 모르는 진짜 fish 대신, 실행되면 늘 실패하는 가짜 `fish` 를 둔다.
    let fish = tmp.path().join("fish");
    std::fs::write(&fish, "#!/bin/sh\necho wrong-shell\nexit 1\n").unwrap();
    std::fs::set_permissions(&fish, std::fs::Permissions::from_mode(0o755)).unwrap();
    let script = r#"read line; printf '[%s]' "$@"; echo; exit 4"#;
    let mut p = start_child(tmp, |dir, id| {
        Command::new(env!("CARGO_BIN_EXE_maru-pty"))
            .args(["--id", id])
            .arg("--dir")
            .arg(dir)
            .arg("--shell")
            .arg(&fish)
            .args(["--", "/bin/sh", "-c", script, "sh", "a b", "-x"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    });
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("\n");
    c.output_until("[a b][-x]");
    assert_eq!(c.next_text()["code"], 4);
    assert!(p.wait().success());
}

fn start_without_shell_flag(
    tmp: tempfile::TempDir,
    shell: Option<&std::ffi::OsStr>,
    extra: &[&std::ffi::OsStr],
) -> Proc {
    start_child(tmp, |dir, id| {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_maru-pty"));
        cmd.args(["--id", id]).arg("--dir").arg(dir).args(extra);
        match shell {
            Some(s) => cmd.env("SHELL", s),
            None => cmd.env_remove("SHELL"),
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    })
}

fn assert_falls_back_to_sh(shell: Option<&std::ffi::OsStr>) {
    let p = start_without_shell_flag(tmpdir(), shell, &[]);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("echo \"a0=[$0]\"\n");
    c.output_until("a0=[-sh]");
}

fn assert_falls_back_to_sh_and_sets_the_variable(shell: &std::ffi::OsStr) {
    let p = start_without_shell_flag(tmpdir(), Some(shell), &[]);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("echo \"a0=[$0] sv=[$SHELL]\"\n");
    c.output_until("a0=[-sh] sv=[/bin/sh]");
}

#[test]
fn without_the_shell_flag_an_empty_shell_variable_falls_back_to_sh() {
    assert_falls_back_to_sh_and_sets_the_variable("".as_ref());
}

#[test]
fn without_the_shell_flag_a_missing_shell_variable_falls_back_to_sh() {
    assert_falls_back_to_sh(None);
}

#[test]
fn without_the_shell_flag_a_shell_variable_naming_a_missing_file_falls_back_to_sh() {
    assert_falls_back_to_sh_and_sets_the_variable("/nonexistent/zsh".as_ref());
}

#[test]
fn without_the_shell_flag_a_shell_variable_naming_a_non_executable_file_falls_back_to_sh() {
    let tmp = tmpdir();
    let file = tmp.path().join("zsh");
    std::fs::write(&file, "#!/bin/sh\necho wrong-shell\n").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_falls_back_to_sh_and_sets_the_variable(file.as_os_str());
}

#[test]
fn without_the_shell_flag_a_shell_variable_naming_a_directory_falls_back_to_sh() {
    let tmp = tmpdir();
    assert_falls_back_to_sh_and_sets_the_variable(tmp.path().as_os_str());
}

#[test]
fn without_the_shell_flag_a_bare_shell_name_is_looked_up_in_path() {
    let p = start_without_shell_flag(tmpdir(), Some("sh".as_ref()), &[]);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("echo \"a0=[$0] sv=[$SHELL]\"\n");
    c.output_until("a0=[-sh] sv=[sh]");
}

#[test]
fn without_the_shell_flag_an_empty_shell_variable_runs_a_command_under_sh() {
    let args = [
        "--",
        "/bin/sh",
        "-c",
        "read line; echo cmd-$((2+3)); exit 4",
    ];
    let args: Vec<&std::ffi::OsStr> = args.iter().map(|a| a.as_ref()).collect();
    let mut p = start_without_shell_flag(tmpdir(), Some("".as_ref()), &args);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("\n");
    c.output_until("cmd-5");
    assert_eq!(c.next_text()["code"], 4);
    assert!(p.wait().success());
}

fn fake_shell(tmp: &tempfile::TempDir) -> PathBuf {
    let shell = tmp.path().join("myshell");
    std::fs::write(
        &shell,
        "#!/bin/sh\nread line\necho \"from-myshell sv=[$SHELL]\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    shell
}

#[test]
fn without_the_shell_flag_the_shell_variable_names_the_shell() {
    let tmp = tmpdir();
    let shell = fake_shell(&tmp);
    let mut p = start_without_shell_flag(tmp, Some(shell.as_os_str()), &[]);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("\n");
    c.output_until(&format!("from-myshell sv=[{}]", shell.display()));
    assert!(p.wait().success());
}

#[test]
fn the_shell_flag_wins_over_the_shell_variable() {
    let tmp = tmpdir();
    let shell = fake_shell(&tmp);
    let p = start_env(tmp, &[], &[("SHELL", &shell)]);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("echo \"a0=[$0]\"\n");
    c.output_until("a0=[-sh]");
}

#[test]
fn the_shell_flag_leaves_an_empty_shell_variable_to_the_shell() {
    let p = start_env(tmpdir(), &[], &[("SHELL", Path::new(""))]);
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("echo \"a0=[$0] sv=[$SHELL]\"\n");
    c.output_until("a0=[-sh] sv=[]");
}

#[test]
fn a_shell_flag_naming_a_missing_file_fails() {
    let tmp = tmpdir();
    let mut child = Command::new(env!("CARGO_BIN_EXE_maru-pty"))
        .args(["--id", "pty-test", "--shell", "/nonexistent/zsh"])
        .arg("--dir")
        .arg(tmp.path().join("s"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    assert!(!child.wait().unwrap().success());
    let err = stderr(&mut child);
    assert!(err.contains("cannot spawn /nonexistent/zsh"), "{err}");
}

#[test]
fn files_left_by_a_crash_are_replaced() {
    let mut p = start();
    let shell = p.record().shell_pid;
    kill(pid(p.child.id()), Signal::SIGKILL).unwrap();
    p.child.wait().unwrap();
    let _ = killpg(pid(shell), Signal::SIGKILL);
    assert!(
        p.socket().exists() && p.record_path().exists(),
        "선행조건: 정리 없이 죽어 소켓·레코드가 남았다"
    );

    p.child = spawn(&p.dir, &p.id);
    p.wait_ready();
    assert_eq!(p.request(json!({ "type": "version" }))["type"], "version");
    assert_eq!(p.record().pid, p.child.id());
}

#[test]
fn malformed_requests_get_an_error_instead_of_a_hang() {
    let p = start();
    let json = |v: Value| v.to_string().into_bytes();
    let cases = [
        ("bad_request", TAG_BINARY, b"binary first".to_vec()),
        ("bad_request", TAG_TEXT, b"not json".to_vec()),
        (
            "unknown_request",
            TAG_TEXT,
            json(json!({ "type": "nope", "protocol_version": PROTOCOL_VERSION })),
        ),
        (
            "unknown_role",
            TAG_TEXT,
            json(json!({ "type": "attach", "protocol_version": PROTOCOL_VERSION, "role": "boss" })),
        ),
    ];
    for (code, tag, payload) in cases {
        let mut c = p.connect();
        c.send(tag, &payload);
        let r = c.text();
        assert_eq!(
            (r["type"].as_str(), r["code"].as_str()),
            (Some("error"), Some(code)),
            "{r}"
        );
    }
    assert_eq!(p.request(json!({ "type": "version" }))["type"], "version");
}

#[test]
fn nobody_sets_the_size_after_the_primary_leaves() {
    let p = start();
    let (mut primary, h, _) = p.attach("primary", 100, 30);
    assert_eq!(h["role"], "primary");
    // observer 의 입력은 셸에 가지 않으므로 떠나기 전에 걸어 둔다.
    primary.input("echo go-$((1+1)); sleep 1; stty size; echo sz-$((1+2))\n");
    primary.output_until("go-2");
    drop(primary);

    let (mut obs, h, _) = p.attach("observer", 80, 24);
    assert_eq!(h["role"], "observer");
    obs.send_text(json!({ "type": "resize", "cols": 50, "rows": 10 }));
    obs.output_until("sz-3");
    let cap = p.request(json!({ "type": "capture", "protocol_version": PROTOCOL_VERSION }));
    assert!(cap["text"].as_str().unwrap().contains("30 100"), "{cap}");
}

#[test]
fn a_client_that_falls_behind_is_resynced() {
    let p = start();
    let (mut slow, _, _) = p.attach("observer", 80, 24);
    let (mut fast, _, _) = p.attach("primary", 80, 24);
    fast.input("yes 0123456789 | head -n 1000000; echo flood-$((6*7))\n");
    let texts = fast.output_until("flood-42");
    assert!(
        texts.is_empty(),
        "계속 읽는 클라이언트까지 밀렸다: {texts:?}"
    );

    loop {
        let (tag, payload) = slow.frame().expect("resync 전에 끊겼다");
        if tag != TAG_TEXT {
            continue;
        }
        let v: Value = serde_json::from_slice(&payload).unwrap();
        if v["type"] == "error" {
            assert_eq!(v["code"], "resync_limit_exceeded", "{v}");
            panic!("resync 없이 바로 한도 에러가 왔다");
        }
        assert_eq!(v["type"], "resync", "{v}");
        assert!(v["cursor_x"].is_u64(), "{v}");
        break;
    }
    slow.expect_resync_replay();
}

#[test]
fn a_client_that_keeps_falling_behind_is_cut_off_after_five_resyncs() {
    // `OUTPUT_BACKLOG`(4MiB, `pty.rs`)의 두 배보다 1MiB 큰 양이다. 서버가 큐에서 꺼내 소켓에 쓰다 막힌 청크는
    // 큐 크기에 세지 않고 그 크기는 한도 이하이므로, 그 청크와 소켓 버퍼를 빼도 큐가 한도를 넘는다.
    const FLOOD: usize = 9 * 1024 * 1024;
    let p = start();
    let (mut slow, _, _) = p.attach("observer", 80, 24);

    // 서버는 출력을 모든 클라이언트 큐에 같은 순서로 넣는다. 그래서 `fast` 가 끝 표지를 받았으면 그 앞의 출력은
    // 읽지 않은 `slow` 의 큐에도 들어가 있으므로, `slow` 가 밀리는지는 출력 속도에 따라 달라지지 않는다. 출력이
    // 유한하고 읽기마다 `WAIT` 시간 제한이 걸리므로, 밀리지 않으면 테스트가 멈추지 않고 실패한다. 출력은 VT 가
    // 무시하는 NUL 로 채운다. 줄을 그리고 스크롤하는 데 드는 시간을 없애기 때문이다.
    for round in 1..=6 {
        // `fast` 도 부하로 읽기가 늦어지면 밀릴 수 있다. 서버가 resync 횟수를 연결마다 세므로, 판마다 `fast` 를
        // 새로 붙여 여러 판의 resync 가 한 연결에 쌓여 `fast` 가 끊기는 일을 막는다.
        let (mut fast, _, _) = p.attach("primary", 80, 24);
        fast.input(&format!(
            "head -c {FLOOD} /dev/zero; echo flood-$(({round}*7))\n"
        ));
        fast.output_until(&format!("flood-{}", round * 7));
        let v = slow.next_text();
        if round <= 5 {
            assert_eq!(v["type"], "resync", "{round}번째: {v}");
            slow.expect_resync_replay();
        } else {
            assert_eq!(v["code"], "resync_limit_exceeded", "{v}");
        }
    }
    assert!(slow.frame().is_none(), "한도 에러 뒤에도 연결이 남았다");
    assert_eq!(p.request(json!({ "type": "kill" }))["type"], "killed");
}

#[test]
fn concurrent_kills_all_get_an_answer() {
    let mut p = start();
    let mut a = p.connect();
    let mut b = p.connect();
    // accept 는 들어온 순서대로라, 뒤에 붙은 연결이 답을 받았으면 a·b 도 이미 받아들여졌다.
    assert_eq!(p.request(json!({ "type": "version" }))["type"], "version");
    a.send_text(json!({ "type": "kill" }));
    b.send_text(json!({ "type": "kill" }));
    assert_eq!(a.text()["type"], "killed");
    assert_eq!(b.text()["type"], "killed");
    assert!(p.wait().success());
}

#[test]
fn a_failed_bind_removes_the_record_it_wrote() {
    let tmp = tmpdir();
    let dir = tmp.path().join("s");
    let paths = Paths::new(&dir, "pty-test").unwrap();
    std::fs::create_dir_all(&paths.socket).unwrap();
    let mut child = spawn(&dir, "pty-test");
    assert!(!child.wait().unwrap().success());
    let err = stderr(&mut child);
    assert!(err.contains("bind"), "{err}");
    assert!(!paths.record.exists(), "죽은 pid 의 레코드가 남았다");
}

#[test]
fn sizes_beyond_the_limit_are_refused() {
    let p = start();
    for (cols, rows) in [(4097, 24), (80, 4097), (65535, 1)] {
        let (_c, h, _) = p.attach("primary", cols, rows);
        assert_eq!(
            (h["cols"].as_u64(), h["rows"].as_u64()),
            (Some(80), Some(24)),
            "{cols}x{rows}"
        );
    }
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.send_text(json!({ "type": "resize", "cols": 4097, "rows": 24 }));
    c.input("stty size; echo sz-$((2+2))\n");
    c.output_until("sz-4");
    let cap = p.request(json!({ "type": "capture", "protocol_version": PROTOCOL_VERSION }));
    assert!(cap["text"].as_str().unwrap().contains("24 80"), "{cap}");

    let tmp = tmpdir();
    let dir = tmp.path().join("s");
    let mut child = Command::new(env!("CARGO_BIN_EXE_maru-pty"))
        .args(["--id", "pty-test", "--shell", "/bin/sh", "--cols", "4097"])
        .arg("--dir")
        .arg(&dir)
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    assert!(!child.wait().unwrap().success());
    let err = stderr(&mut child);
    assert!(err.contains("4097"), "{err}");
    assert!(!Paths::new(&dir, "pty-test").unwrap().record.exists());
}

fn cpu_seconds(pid: u32) -> f64 {
    let out = Command::new("ps")
        .args(["-o", "time=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    // macOS 는 `M:SS.ss`, Linux 는 `HH:MM:SS` 로 찍는다.
    String::from_utf8(out.stdout)
        .unwrap()
        .trim()
        .split(':')
        .fold(0.0, |acc, part| acc * 60.0 + part.parse::<f64>().unwrap())
}

fn start_with_few_fds(stderr: Stdio) -> Proc {
    start_child(tmpdir(), |dir, id| {
        Command::new("/bin/sh")
            .args(["-c", "ulimit -n 64 && exec \"$0\" \"$@\""])
            .arg(env!("CARGO_BIN_EXE_maru-pty"))
            .args(["--id", id, "--shell", "/bin/sh"])
            .arg("--dir")
            .arg(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(stderr)
            .spawn()
            .unwrap()
    })
}

fn exhaust_fds(p: &Proc) -> Vec<UnixStream> {
    let conns = (0..100)
        .map(|_| UnixStream::connect(p.socket()).unwrap())
        .collect();
    std::thread::sleep(Duration::from_millis(200));
    conns
}

fn wait_until_answering(p: &Proc) {
    let deadline = Instant::now() + WAIT;
    loop {
        let mut c = p.connect();
        c.send_text(json!({ "type": "version" }));
        if c.frame().is_some() {
            return;
        }
        assert!(Instant::now() < deadline, "fd 가 풀린 뒤에도 받지 못한다");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn running_out_of_fds_does_not_spin_the_accept_loop() {
    let p = start_with_few_fds(Stdio::null());

    let conns = exhaust_fds(&p);
    let before = cpu_seconds(p.child.id());
    std::thread::sleep(Duration::from_secs(2));
    let used = cpu_seconds(p.child.id()) - before;
    assert!(used < 0.5, "fd 가 바닥난 2초 동안 CPU 를 {used}초 썼다");

    drop(conns);
    wait_until_answering(&p);
}

#[test]
fn a_closed_stderr_does_not_end_the_process() {
    let (reader, writer) = std::io::pipe().unwrap();
    drop(reader);
    let mut p = start_with_few_fds(writer.into());

    let conns = exhaust_fds(&p);
    assert!(
        p.child.try_wait().unwrap().is_none(),
        "accept 실패를 로그로 남기다 끝났다"
    );

    drop(conns);
    wait_until_answering(&p);
    let r = p.request(json!({ "type": "kill" }));
    assert_eq!(r["type"], "killed");
    assert!(!p.socket().exists() && !p.record_path().exists());
    assert!(p.wait().success());
}

#[test]
fn input_from_an_observer_does_not_reach_the_shell() {
    let p = start();
    let (mut primary, _, _) = p.attach("primary", 80, 24);
    let (mut obs, _, _) = p.attach("observer", 80, 24);
    obs.input("echo obs-$((1+1))\n");
    // 두 연결의 입력은 순서가 정해져 있지 않아, observer 의 입력이 먼저 처리될 틈을 둔다.
    primary.input("sleep 0.5; echo pri-$((2+2))\n");
    primary.output_until("pri-4");
    let cap = p.request(json!({ "type": "capture", "protocol_version": PROTOCOL_VERSION }));
    assert!(!cap["text"].as_str().unwrap().contains("obs-2"), "{cap}");
}

#[test]
fn other_clients_learn_the_size_the_primary_sets() {
    let p = start();
    let (mut primary, _, _) = p.attach("primary", 80, 24);
    let (mut obs, _, _) = p.attach("observer", 80, 24);
    primary.send_text(json!({ "type": "resize", "cols": 100, "rows": 30 }));
    primary.input("echo mid-$((1+2))\n");
    let texts = obs.output_until("mid-3");
    assert_eq!(texts, [json!({ "type": "size", "cols": 100, "rows": 30 })]);
    let own = primary.output_until("mid-3");
    assert!(own.is_empty(), "자기가 바꾼 크기를 돌려받았다: {own:?}");

    primary.send_text(json!({ "type": "resize", "cols": 100, "rows": 30 }));
    primary.input("echo after-$((3+4))\n");
    let texts = obs.output_until("after-7");
    assert!(texts.is_empty(), "같은 크기를 다시 알렸다: {texts:?}");
}

#[test]
fn attaching_on_the_alternate_screen_replays_the_primary_screen_first() {
    let p = start();
    let (mut primary, _, _) = p.attach("primary", 80, 24);
    primary.input("echo main-$((1+1)); printf '\\033[?1049h\\033[Halt-%s' $((2+2))\n");
    primary.output_until("alt-4");
    let (_obs, _, replay) = p.attach("observer", 80, 24);
    let replay = String::from_utf8_lossy(&replay);
    let main = replay.find("main-2").expect("일반 화면이 없다");
    let enter = replay.rfind("\x1b[?1049h").expect("대체 화면 진입이 없다");
    let alt = replay.rfind("alt-4").expect("대체 화면이 없다");
    assert!(main < enter && enter < alt, "{replay:?}");
}

#[test]
fn protocol_version_prints_the_version_without_dir_or_id() {
    let out = Command::new(env!("CARGO_BIN_EXE_maru-pty"))
        .arg("--protocol-version")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        format!("{PROTOCOL_VERSION}\n")
    );
}

#[test]
fn without_arguments_it_fails_without_printing() {
    let out = Command::new(env!("CARGO_BIN_EXE_maru-pty"))
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
}

#[test]
fn the_protocol_version_flag_does_not_combine() {
    let tmp = tmpdir();
    let out = Command::new(env!("CARGO_BIN_EXE_maru-pty"))
        .arg("--protocol-version")
        .args(["--id", "pty-test", "--dir"])
        .arg(tmp.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
}

#[test]
fn help_is_in_english_and_describes_every_option_but_the_size() {
    let out = Command::new(env!("CARGO_BIN_EXE_maru-pty"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(out.status.success());
    let help = String::from_utf8(out.stdout).unwrap();
    let hangul: String = help
        .chars()
        .filter(|c| ('\u{AC00}'..='\u{D7A3}').contains(c))
        .collect();
    assert!(hangul.is_empty(), "{help}");
    for flag in [
        "[COMMAND]...",
        "--dir <DIR>",
        "--id <ID>",
        "--shell <SHELL>",
        "--cwd <CWD>",
        "--keep",
    ] {
        let line = help
            .lines()
            .map(str::trim_start)
            .find(|l| l.starts_with(flag))
            .unwrap_or_else(|| panic!("{flag} is missing:\n{help}"));
        assert!(
            !line[flag.len()..].trim().is_empty(),
            "{flag} has no description:\n{help}"
        );
    }
}

// `app` 을 붙이면 foreground 리더가 바뀔 때 지워지므로, 그 규칙을 재지 않는 테스트는 `app` 없이 보낸다.
const OSC_WORKING: &str = r"printf '\033]7501;state=working:msg=aGk=\033\\'";
const OSC_WORKING_APP: &str = r"printf '\033]7501;state=working:app=x:msg=aGk=\033\\'";
const OSC_ASK: &str = r"printf '\033]7501;state=blocked:id=ask:kind=question\033\\'";
const OSC_CLEAR: &str = r"printf '\033]7501;state=clear\033\\'";

/// `uri` 의 `%` 는 printf 의 형식 문자가 되지 않게 `%%` 로 바꿔 넣는다.
fn osc7(uri: &str) -> String {
    let uri = uri.replace('%', "%%");
    format!(r"printf '\033]7;{uri}\007'")
}

const OSC7_PWD: &str = r#"printf '\033]7;file://%s\007' "$PWD""#;

#[test]
fn subscribing_sends_the_current_state_first_and_nothing_from_the_screen() {
    let p = start();
    let (mut s, first) = p.subscribe();
    assert_eq!(
        first,
        json!({
            "type": "state", "cwd": null, "cwd_reports": 0, "title": null,
            "foreground_cwd": null, "command": null, "records": [],
        })
    );
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input("echo plain-$((1))\n");
    a.output_until("plain-1");
    let texts = s.texts_for(Duration::from_millis(500));
    assert!(texts.is_empty(), "상태가 바뀌지 않았는데 왔다: {texts:?}");
}

#[test]
fn osc_7_0_2_and_7501_reach_every_subscriber() {
    let p = start();
    let (mut s1, _) = p.subscribe();
    let (mut s2, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let tmp = tmpdir();
    let dir = std::fs::canonicalize(tmp.path()).unwrap();
    a.input(&format!(
        "{}; printf '\\033]2;my title\\007'; {OSC_WORKING_APP}; echo done-$((1))\n",
        osc7(&format!("file://{}/a%20b", dir.display()))
    ));
    a.output_until("done-1");
    let want_cwd = format!("{}/a b", dir.display());
    for s in [&mut s1, &mut s2] {
        let st = s.state_until(|v| v["records"] != json!([]));
        assert_eq!(st["cwd"], want_cwd.as_str(), "{st}");
        assert_eq!(st["cwd_reports"], 1, "{st}");
        assert_eq!(st["title"], "my title", "{st}");
        assert_eq!(st["records"][0]["id"], "");
        assert_eq!(st["records"][0]["state"], "working");
        assert_eq!(st["records"][0]["app"], "x");
        assert_eq!(st["records"][0]["message"], "hi");
    }

    a.input("printf '\\033]0;both\\007'; echo done-$((2))\n");
    a.output_until("done-2");
    s1.state_until(|v| v["title"] == "both");
}

fn notifications(texts: &[Value]) -> Vec<&Value> {
    texts
        .iter()
        .filter(|v| v["type"] == "notification")
        .collect()
}

#[test]
fn osc_9_and_777_notifications_reach_every_subscriber_in_order() {
    let p = start();
    let (mut s1, _) = p.subscribe();
    let (mut s2, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input(concat!(
        "printf '\\033]777;notify;Tests;3 failed; see log\\033\\\\'; ",
        "printf '\\033]9;4;1;50\\007'; ",
        "printf '\\033]9;build \\001done\\007'; ",
        "printf '\\033]777;notify; ;\\007'; ",
        "echo done-$((1))\n"
    ));
    a.output_until("done-1");
    for s in [&mut s1, &mut s2] {
        let texts = s.texts_for(Duration::from_millis(500));
        assert_eq!(
            notifications(&texts),
            vec![
                &json!({ "type": "notification", "title": "Tests", "body": "3 failed; see log" }),
                &json!({ "type": "notification", "title": "", "body": "build done" }),
            ],
            "{texts:?}"
        );
    }
}

#[test]
fn a_subscriber_gets_only_the_notifications_sent_after_it_subscribed() {
    let p = start();
    let (mut early, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input("printf '\\033]9;first\\007'; echo done-$((1))\n");
    a.output_until("done-1");
    assert_eq!(
        notifications(&early.texts_for(Duration::from_millis(500))).len(),
        1
    );

    let (mut late, _) = p.subscribe();
    a.input("printf '\\033]9;second\\007'; echo done-$((2))\n");
    a.output_until("done-2");
    let texts = late.texts_for(Duration::from_millis(500));
    assert_eq!(
        notifications(&texts),
        vec![&json!({ "type": "notification", "title": "", "body": "second" })],
        "{texts:?}"
    );
}

#[test]
fn a_repeated_osc_7_is_counted_and_a_rejected_one_keeps_the_last_path() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input(&format!("{}\n", osc7("file:///first")));
    s.state_until(|v| v["cwd"] == "/first" && v["cwd_reports"] == 1);
    a.input(&format!("{}\n", osc7("file:///first")));
    s.state_until(|v| v["cwd"] == "/first" && v["cwd_reports"] == 2);

    a.input(&format!(
        "{}; {}; {}\n",
        osc7("file://remote.example/elsewhere"),
        osc7("file:///bad%zz"),
        osc7("file:///next")
    ));
    let st = s.state_until(|v| v["cwd"] != "/first");
    assert_eq!(st["cwd"], "/next", "{st}");
    assert_eq!(st["cwd_reports"], 3, "{st}");
}

#[test]
fn an_empty_osc_7_clears_the_cwd_and_a_full_reset_clears_everything() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input(&format!("{}\n", osc7("file:///a")));
    s.state_until(|v| v["cwd"] == "/a");
    a.input(&format!("{}\n", osc7("")));
    let st = s.state_until(|v| v["cwd"].is_null());
    assert_eq!(st["cwd_reports"], 2, "{st}");

    a.input(&format!(
        "{}; printf '\\033]2;t\\007'; {OSC_WORKING}\n",
        osc7("file:///b")
    ));
    s.state_until(|v| v["cwd"] == "/b" && v["title"] == "t" && v["records"] != json!([]));
    a.input("printf '\\033c'\n");
    let st = s.state_until(|v| v["cwd"].is_null());
    assert_eq!(st["title"], Value::Null, "{st}");
    assert_eq!(st["records"], json!([]), "{st}");
    assert_eq!(st["foreground_cwd"], Value::Null, "{st}");
}

/// `/bin/sh` 는 OSC 133 을 찍지 않으므로 셸 통합 대신 `printf` 로 찍는다.
fn osc133(body: &str) -> String {
    let body = body.replace('%', "%%");
    format!(r"printf '\033]133;{body}\007'")
}

#[test]
fn osc_133_runs_and_ends_a_command_and_a_full_reset_keeps_it() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let before = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    a.input(&format!("{}\n", osc133("A")));
    let st = s.state_until(|v| !v["command"].is_null());
    assert_eq!(
        st["command"],
        json!({ "running": false, "text": null, "exit_code": null, "started_at": null })
    );

    a.input(&format!(
        "{}; printf '\\033]2;t\\007'\n",
        osc133("C;cmdline_url=npm%20run%20dev")
    ));
    let st = s.state_until(|v| v["command"]["running"] == true && v["title"] == "t");
    assert_eq!(st["command"]["text"], "npm run dev", "{st}");
    assert!(
        st["command"]["started_at"].as_u64().unwrap() >= before,
        "{st}"
    );

    a.input("printf '\\033c'\n");
    let st = s.state_until(|v| v["title"].is_null());
    assert_eq!(
        st["command"]["running"], true,
        "RIS 는 명령 상태를 두어야 한다: {st}"
    );

    a.input(&format!("{}; {}\n", osc133("D;101"), osc133("A")));
    let st = s.state_until(|v| v["command"]["running"] == false);
    assert_eq!(st["command"]["exit_code"], 101, "{st}");
    assert_eq!(st["command"]["text"], "npm run dev", "{st}");
}

#[test]
fn a_prompt_without_an_end_stops_the_command_with_no_exit_code() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input(&format!("{}\n", osc133("C;cmdline_url=vim")));
    s.state_until(|v| v["command"]["running"] == true);
    a.input(&format!("{}\n", osc133("A")));
    let st = s.state_until(|v| v["command"]["running"] == false);
    assert_eq!(st["command"]["exit_code"], Value::Null, "{st}");
    assert_eq!(st["command"]["text"], "vim", "{st}");
}

#[test]
fn a_command_pane_runs_its_command_from_the_start_and_ignores_osc_133() {
    let script = format!("{}; {}; sleep 30", osc133("D;1"), osc133("A"));
    let args = ["--", "/bin/sh", "-c", &script];
    let args: Vec<&std::ffi::OsStr> = args.iter().map(|a| a.as_ref()).collect();
    let p = start_in(tmpdir(), &args);
    let (mut s, first) = p.subscribe();
    let want = json!({
        "running": true,
        "text": format!("/bin/sh -c {script}"),
        "exit_code": null,
    });
    let check = |v: &Value| {
        assert_eq!(v["command"]["running"], want["running"], "{v}");
        assert_eq!(v["command"]["text"], want["text"], "{v}");
        assert_eq!(v["command"]["exit_code"], want["exit_code"], "{v}");
        assert!(v["command"]["started_at"].as_u64().is_some(), "{v}");
    };
    check(&first);
    // 명령이 찍은 133 은 상태를 바꾸지 않으므로 새 상태가 오지 않거나, 와도 같다.
    for v in s.texts_for(Duration::from_millis(500)) {
        check(&v);
    }
}

#[test]
fn a_kept_command_pane_reports_the_exit_code_once_its_command_ends() {
    let p = start_keep("read x; exit 3");
    let (mut s, first) = p.subscribe();
    assert_eq!(first["command"]["running"], true, "{first}");
    let (mut c, _, _) = p.attach("primary", 80, 24);
    c.input("go\n");
    let st = s.state_until(|v| v["command"]["running"] == false);
    assert_eq!(st["command"]["exit_code"], 3, "{st}");
    assert_eq!(st["command"]["text"], "/bin/sh -c read x; exit 3", "{st}");
    assert_eq!(p.subscribe().1["command"], st["command"]);
}

#[test]
fn osc_9_9_and_1337_paths_are_not_taken_but_an_empty_osc_9_9_clears_like_osc_7() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input(&format!("{}\n", osc7("file:///a")));
    s.state_until(|v| v["cwd"] == "/a");
    a.input(
        "printf '\\033]9;9;/elsewhere\\007\\033]1337;CurrentDir=/other\\007'; echo done-$((9))\n",
    );
    a.output_until("done-9");
    let texts = s.texts_for(Duration::from_millis(500));
    assert!(
        texts.is_empty(),
        "경로가 아닌 보고로 상태가 바뀌었다: {texts:?}"
    );
    a.input("printf '\\033]9;9;\\007'\n");
    let st = s.state_until(|v| v["cwd"].is_null());
    assert_eq!(st["cwd_reports"], 2, "{st}");
}

#[test]
fn a_later_subscriber_gets_the_state_reported_before_it_subscribed() {
    let p = start();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let (mut early, _) = p.subscribe();
    a.input(&format!(
        "{}; printf '\\033]2;kept\\007'; {OSC_WORKING}\n",
        osc7("file:///kept")
    ));
    let want = early.state_until(|v| {
        v["cwd"] == "/kept" && v["title"] == "kept" && !v["foreground_cwd"].is_null()
    });
    let (_, first) = p.subscribe();
    assert_eq!(first, want);
}

#[test]
fn clearing_the_records_empties_them_and_the_foreground_cwd() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input(&format!("{OSC_WORKING}\n"));
    s.state_until(|v| !v["foreground_cwd"].is_null() && v["records"] != json!([]));
    a.input(&format!("{OSC_CLEAR}\n"));
    let st = s.state_until(|v| v["records"] == json!([]));
    assert_eq!(st["foreground_cwd"], Value::Null, "{st}");
}

fn run_program(a: &mut Conn, s: &mut Conn, script: &str) -> tempfile::TempDir {
    let tmp = tmpdir();
    let path = tmp.path().join("program.sh");
    std::fs::write(&path, script).unwrap();
    a.input(&format!("sh {}; echo back-$((4))\n", path.display()));
    s.state_until(|v| v["records"] != json!([]));
    tmp
}

#[test]
fn records_with_an_app_go_once_the_program_that_sent_them_ends() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let _program = run_program(
        &mut a,
        &mut s,
        &format!("{OSC_WORKING_APP}; {OSC_ASK}; sleep 1.5"),
    );
    let st = s.state_until(|v| v["records"].as_array().is_some_and(|r| r.len() == 2));
    assert_eq!(st["records"][0]["app"], "x", "{st}");
    a.output_until("back-4");
    let ended = Instant::now();
    let st = s.state_until(|v| v["records"] == json!([]));
    assert!(
        ended.elapsed() < Duration::from_millis(1500),
        "프로그램이 끝나고 늦게 지웠다: {:?}",
        ended.elapsed()
    );
    assert_eq!(st["foreground_cwd"], Value::Null, "{st}");
}

#[test]
fn records_without_an_app_stay_after_the_program_ends() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let _program = run_program(&mut a, &mut s, &format!("{OSC_WORKING}; sleep 0.5"));
    a.output_until("back-4");
    let texts = s.texts_for(Duration::from_secs(2));
    assert!(
        texts.iter().all(|t| t["records"] != json!([])),
        "app 없는 레코드를 지웠다: {texts:?}"
    );
}

#[test]
fn records_stay_while_the_program_execs_into_another() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let _program = run_program(
        &mut a,
        &mut s,
        &format!("{OSC_WORKING_APP}; exec sleep 2.5"),
    );
    let texts = s.texts_for(Duration::from_secs(2));
    assert!(
        texts.iter().all(|t| t["records"] != json!([])),
        "exec 로 바뀐 프로그램이 도는 중에 지웠다: {texts:?}"
    );
    a.output_until("back-4");
    s.state_until(|v| v["records"] == json!([]));
}

#[test]
fn records_with_an_app_go_once_the_program_that_sent_them_is_stopped() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let _program = run_program(
        &mut a,
        &mut s,
        &format!("{OSC_WORKING_APP}; sleep 0.5; kill -TSTP $$; sleep 1"),
    );
    s.state_until(|v| v["records"] == json!([]));
    a.input("fg\n");
    a.output_until("back-4");
}

fn records_after_keep_command(report: &str) -> Value {
    let p = start_keep(&format!("{report}; sleep 1"));
    let (mut s, first) = p.subscribe();
    if first["records"] == json!([]) {
        s.state_until(|v| v["records"] != json!([]));
    }
    s.state_until(|v| v["command"]["running"] == false)["records"].clone()
}

#[test]
fn records_with_an_app_go_when_the_command_that_sent_them_ends_under_keep() {
    assert_eq!(records_after_keep_command(OSC_WORKING_APP), json!([]));
}

#[test]
fn records_without_an_app_stay_when_the_command_ends_under_keep() {
    assert_ne!(records_after_keep_command(OSC_WORKING), json!([]));
}

#[test]
fn the_attach_stream_carries_no_state() {
    let p = start();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    a.input(&format!(
        "{}; printf '\\033]2;t\\007'; {OSC_WORKING}; sleep 1.5; echo done-$((3))\n",
        osc7("file:///x")
    ));
    let texts = a.output_until("done-3");
    assert!(texts.is_empty(), "attach 로 상태가 왔다: {texts:?}");

    let (mut b, _, _) = p.attach("observer", 80, 24);
    let texts = b.texts_for(Duration::from_millis(500));
    assert!(texts.is_empty(), "붙을 때 상태가 왔다: {texts:?}");
}

#[test]
fn the_support_query_is_answered_but_other_queries_are_not() {
    let p = start();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    // 응답은 셸 입력으로 들어가 echo 되므로 출력에서 보인다.
    a.input("printf '\\033]7501;?\\033\\\\'; sleep 1; echo q-$((7501))\n");
    let out = a.bytes_until("q-7501");
    let out = String::from_utf8_lossy(&out);
    assert!(
        out.contains("7501;?:states=idle,working,done,blocked,error"),
        "{out:?}"
    );

    a.input("printf '\\033[6n'; sleep 1; echo q-$((6))\n");
    let out = a.bytes_until("q-6");
    let out = String::from_utf8_lossy(&out);
    let after = out
        .find("[6n'")
        .map(|i| &out[i + 4..])
        .expect("echo 된 입력이 없다");
    assert!(
        !after.contains(";1R") && !after.contains(";2R"),
        "DSR 응답이 셸 입력으로 들어갔다: {after:?}"
    );
}

#[test]
fn the_foreground_cwd_is_measured_only_while_records_exist() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let tmp = tmpdir();
    let path = std::fs::canonicalize(tmp.path()).unwrap();
    let path_str = path.to_str().unwrap();
    let start_dir = std::fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
    let start_dir = start_dir.to_str().unwrap();

    a.input(&format!("(cd {path_str}; sleep 2)\n"));
    let texts = s.texts_for(Duration::from_secs(3));
    assert!(
        texts.iter().all(|t| t["foreground_cwd"].is_null()),
        "레코드가 없는데 foreground cwd 를 쟀다: {texts:?}"
    );
    a.input("echo back-$((1))\n");
    a.output_until("back-1");

    let started = Instant::now();
    a.input(&format!(
        "{OSC_WORKING}; sleep 1.5; (cd {path_str}; sleep 3); echo back-$((2))\n"
    ));
    let st = s.state_until(|v| !v["foreground_cwd"].is_null());
    assert!(
        started.elapsed() < Duration::from_millis(900),
        "처음 재기가 늦었다: {:?}",
        started.elapsed()
    );
    assert_eq!(st["foreground_cwd"], start_dir, "{st}");
    let st = s.state_until(|v| v["foreground_cwd"] == path_str);
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "옮긴 cwd 가 늦게 왔다: {:?}",
        started.elapsed()
    );
    assert_eq!(st["records"][0]["state"], "working");
    a.output_until("back-2");
    s.state_until(|v| v["foreground_cwd"] == start_dir);

    // 리더가 먼저 끝난 파이프라인은 cwd 를 못 읽는다 — 옮긴 것이 아니므로 값을 둔다.
    a.input("sleep 0.1 | sleep 2\n");
    let texts = s.texts_for(Duration::from_secs(3));
    assert!(
        texts.is_empty(),
        "cwd 를 못 읽은 것을 바뀐 것으로 보냈다: {texts:?}"
    );
}

#[test]
fn the_foreground_cwd_keeps_the_shells_symlinked_path_for_the_same_directory() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let tmp = tmpdir();
    let real = std::fs::canonicalize(tmp.path()).unwrap();
    std::fs::create_dir(real.join("d")).unwrap();
    std::os::unix::fs::symlink(real.join("d"), real.join("link")).unwrap();
    let link = real.join("link");
    let link = link.to_str().unwrap();

    a.input(&format!("cd {link}; {OSC7_PWD}; {OSC_WORKING}\n"));
    let st = s.state_until(|v| !v["foreground_cwd"].is_null() && v["cwd"] == link);
    assert_eq!(st["foreground_cwd"], link, "{st}");
}

#[test]
fn without_a_shell_cwd_the_foreground_cwd_keeps_the_symlinked_start_dir() {
    let work = tmpdir();
    let real = std::fs::canonicalize(work.path()).unwrap();
    std::fs::create_dir(real.join("d")).unwrap();
    std::os::unix::fs::symlink(real.join("d"), real.join("link")).unwrap();
    let link = real.join("link");
    let link = link.to_str().unwrap();
    let go = real.join("go");
    let script = format!(
        "{OSC_WORKING}; while [ ! -e {} ]; do sleep 0.1; done; cd /; sleep 3",
        go.display()
    );
    let args = ["--cwd", link, "--", "/bin/sh", "-c", &script];
    let args: Vec<&std::ffi::OsStr> = args.iter().map(|a| a.as_ref()).collect();
    let p = start_in(tmpdir(), &args);
    let (mut s, first) = p.subscribe();

    let st = if first["foreground_cwd"].is_null() {
        s.state_until(|v| !v["foreground_cwd"].is_null())
    } else {
        first
    };
    assert_eq!(st["cwd"], Value::Null, "{st}");
    assert_eq!(st["foreground_cwd"], link, "{st}");
    std::fs::write(&go, "").unwrap();
    let st = s.state_until(|v| v["foreground_cwd"] != link);
    assert_eq!(
        st["foreground_cwd"], "/",
        "다른 디렉토리면 foreground 경로다: {st}"
    );
}

#[test]
fn an_osc_7_while_records_exist_measures_the_foreground_cwd_at_once() {
    let p = start();
    let (mut s, _) = p.subscribe();
    let (mut a, _, _) = p.attach("primary", 80, 24);
    let tmp = tmpdir();
    let path = std::fs::canonicalize(tmp.path()).unwrap();
    let path = path.to_str().unwrap();

    a.input(&format!("{OSC_WORKING}\n"));
    // 레코드가 생겨 막 잰 때라, 다음 정기 재기까지 1초에 가깝게 남는다.
    s.state_until(|v| !v["foreground_cwd"].is_null());
    a.input(&format!("cd {path}; {OSC7_PWD}\n"));
    // 셸이 늦게 돌아도 테스트가 실패하지 않도록, 시간은 셸 cwd 가 실린 상태를 받은 때부터 잰다. 구독은 바뀐 상태 가운데
    // 마지막 것만 보내므로(`lib.rs` 모듈 doc) `cwd` 와 `foreground_cwd` 가 한 상태에 같이 올 수 있다.
    let st = s.state_until(|v| v["cwd"] == path);
    let reported = Instant::now();
    if st["foreground_cwd"] != path {
        s.state_until(|v| v["foreground_cwd"] == path);
    }
    assert!(
        reported.elapsed() < Duration::from_millis(500),
        "OSC 7 뒤 foreground cwd 가 늦게 왔다: {:?}",
        reported.elapsed()
    );
}

#[test]
fn the_subscription_outlives_the_shell_under_keep_and_closes_on_kill() {
    let p = start_keep(&format!(
        "{}; printf '\\033]2;job\\007'; sleep 1; exit 3",
        osc7("file:///job")
    ));
    let (mut s, first) = p.subscribe();
    if first["title"] != "job" {
        s.state_until(|v| v["title"] == "job" && v["cwd"] == "/job");
    }
    let mut c = p.connect();
    c.send_text(status(true));
    assert_eq!(c.text()["exit"]["code"], 3);
    let texts = s.texts_for(Duration::from_millis(500));
    assert_eq!(texts.len(), 1, "{texts:?}");
    assert_eq!(texts[0]["command"]["running"], false, "{texts:?}");
    assert_eq!(texts[0]["title"], "job", "{texts:?}");
    let (_, again) = p.subscribe();
    assert_eq!(
        again["title"], "job",
        "셸이 끝난 뒤에도 상태가 남는다: {again}"
    );

    assert_eq!(p.request(json!({ "type": "kill" }))["type"], "killed");
    assert!(s.frame().is_none(), "kill 뒤에도 구독이 남았다");
}
