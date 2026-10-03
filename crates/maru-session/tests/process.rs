use maru_session::PROTOCOL_VERSION;
use maru_session::frame::{TAG_BINARY, TAG_TEXT, decode_header, encode};
use maru_session::paths::Paths;
use maru_session::record::{self, Record};
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
    Command::new(env!("CARGO_BIN_EXE_maru-session"))
        .args([
            "--id", id, "--shell", "/bin/sh", "--cols", "80", "--rows", "24",
        ])
        .arg("--dir")
        .arg(dir)
        .args(extra)
        // 셸의 TERM 이 상속값이 아니라 세션 프로세스가 정한 값인지 보려고 일부러 다르게 둔다.
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
    let dir = tmp.path().join("s");
    let id = "sess-test".to_string();
    let mut p = Proc {
        child: spawn_with(&dir, &id, extra),
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
                "세션 프로세스가 준비 전에 끝났다"
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

    fn wait(&mut self) -> ExitStatus {
        let deadline = Instant::now() + WAIT;
        loop {
            if let Some(s) = self.child.try_wait().unwrap() {
                return s;
            }
            assert!(Instant::now() < deadline, "세션 프로세스가 끝나지 않았다");
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
        let mut head = [0u8; 5];
        match self.0.read_exact(&mut head) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return None,
            Err(e) => panic!("프레임을 읽지 못했다: {e}"),
        }
        let (tag, len) = decode_header(&head).unwrap();
        let mut payload = vec![0u8; len];
        self.0.read_exact(&mut payload).unwrap();
        Some((tag, payload))
    }

    fn text(&mut self) -> Value {
        let (tag, payload) = self.frame().expect("응답 없이 끊겼다");
        assert_eq!(tag, TAG_TEXT);
        serde_json::from_slice(&payload).unwrap()
    }

    fn output_until(&mut self, want: &str) -> Vec<Value> {
        let want = want.as_bytes();
        let mut out = Vec::new();
        let mut texts = Vec::new();
        loop {
            let Some((tag, payload)) = self.frame() else {
                let tail = &out[out.len().saturating_sub(2000)..];
                panic!(
                    "{:?} 가 나오기 전에 끊겼다. 마지막 출력: {:?}, Text: {texts:?}",
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
                return texts;
            }
        }
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
    for k in ["cursor_x", "cursor_y", "trailing_blank_rows"] {
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
    b.input("echo both-$((1+1))\n");
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
    assert_eq!(
        first.next_text(),
        json!({ "type": "role", "role": "observer" })
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
        let paths = Paths::new(&dir, "sess-test").unwrap();
        let mut child = spawn(&dir, "sess-test");
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
    assert!(err.contains("살아 있는"), "{err}");

    assert_eq!(p.request(json!({ "type": "version" }))["type"], "version");
    assert_eq!(p.record().pid, p.child.id());
}

#[test]
fn an_overlong_socket_path_fails_before_spawning_a_shell() {
    let tmp = tmpdir();
    let dir = tmp.path().join("x".repeat(100));
    let mut child = spawn(&dir, "sess-test");
    assert!(!child.wait().unwrap().success());
    let err = stderr(&mut child);
    assert!(err.contains("줄여야"), "{err}");
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
    let (primary, h, _) = p.attach("primary", 100, 30);
    assert_eq!(h["role"], "primary");
    drop(primary);

    let (mut obs, h, _) = p.attach("observer", 80, 24);
    assert_eq!(h["role"], "observer");
    obs.send_text(json!({ "type": "resize", "cols": 50, "rows": 10 }));
    obs.input("stty size; echo sz-$((1+2))\n");
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
        assert!(
            v["cursor_x"].is_u64() && v["trailing_blank_rows"].is_u64(),
            "{v}"
        );
        break;
    }
    let (tag, replay) = slow.frame().unwrap();
    assert_eq!(tag, TAG_BINARY);
    assert!(
        replay.starts_with(b"\x1b[H\x1b[2J\x1b[3J"),
        "리셋으로 시작하지 않는다"
    );
}
