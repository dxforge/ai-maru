use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const SESSION: &str = "s-test";

fn tmpdir() -> tempfile::TempDir {
    // macOS 의 기본 temp 디렉토리는 길어서 소켓 경로 한도에 가까워진다.
    tempfile::Builder::new()
        .prefix("mc")
        .tempdir_in("/tmp")
        .unwrap()
}

/// CLI 가 연결하지 않고 끝나도 테스트가 멈추지 않게.
fn accept_within(listener: &UnixListener) -> UnixStream {
    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false).unwrap();
                return stream;
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(Instant::now() < deadline, "CLI 가 연결하지 않았다");
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => panic!("{e}"),
        }
    }
}

fn serve_once(
    sock: &Path,
    reply: impl FnOnce(&Value) -> Option<String> + Send + 'static,
) -> JoinHandle<Value> {
    let listener = UnixListener::bind(sock).unwrap();
    std::thread::spawn(move || {
        let stream = accept_within(&listener);
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line).unwrap();
        let req: Value = serde_json::from_str(&line).unwrap();
        match reply(&req) {
            Some(out) => writeln!(&stream, "{out}").unwrap(),
            // 답하지 않는 앱 — CLI 가 먼저 끊을 때까지 연결을 쥐고 있는다.
            None => {
                let mut rest = String::new();
                let _ = BufReader::new(&stream).read_line(&mut rest);
            }
        }
        req
    })
}

fn maru(sock: Option<&Path>, args: &[&str]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_maru"));
    cmd.args(args)
        .env_remove("MARU_SOCKET")
        .env_remove("MARU_SESSION_ID");
    if let Some(sock) = sock {
        cmd.env("MARU_SOCKET", sock).env("MARU_SESSION_ID", SESSION);
    }
    cmd.output().unwrap()
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

fn result(req: &Value, result: Value) -> Option<String> {
    Some(json!({ "jsonrpc": "2.0", "id": req["id"], "result": result }).to_string())
}

fn error(req: &Value, code: i64, message: &str, data: Value) -> Option<String> {
    Some(
        json!({
            "jsonrpc": "2.0",
            "id": req["id"],
            "error": { "code": code, "message": message, "data": data },
        })
        .to_string(),
    )
}

fn sock_in(tmp: &tempfile::TempDir) -> PathBuf {
    tmp.path().join("app.sock")
}

#[test]
fn ping_sends_a_versioned_request_and_prints_the_session() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| {
        result(req, json!({ "session": req["params"]["session"] }))
    });

    let out = maru(Some(&sock), &["ping"]);
    let req = server.join().unwrap();

    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(stdout(&out), format!("pong (session {SESSION})\n"));
    assert_eq!(req["jsonrpc"], "2.0");
    assert_eq!(req["method"], "ping");
    assert!(req["id"].is_number() || req["id"].is_string(), "{req}");
    assert_eq!(req["params"]["protocol_version"], 1);
    assert_eq!(req["params"]["session"], SESSION);
}

#[test]
fn outside_an_app_terminal_it_says_so() {
    let out = maru(None, &["ping"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).starts_with("maru: "), "{}", stderr(&out));
    assert!(stderr(&out).contains("MARU_SOCKET"), "{}", stderr(&out));
}

#[test]
fn a_missing_socket_names_the_path() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let out = maru(Some(&sock), &["ping"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr(&out).contains(&sock.display().to_string()),
        "{}",
        stderr(&out)
    );
}

#[test]
fn a_version_mismatch_shows_both_versions() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| {
        error(
            req,
            -32000,
            "protocol version mismatch",
            json!({ "code": "protocol_mismatch", "protocol_version": 7 }),
        )
    });
    let out = maru(Some(&sock), &["ping"]);
    server.join().unwrap();
    assert_eq!(out.status.code(), Some(1));
    let err = stderr(&out);
    assert!(err.contains("v7") && err.contains("v1"), "{err}");
}

#[test]
fn other_app_errors_pass_the_message_through() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| {
        error(
            req,
            -32601,
            "unknown method: ping",
            json!({ "code": "unknown_method" }),
        )
    });
    let out = maru(Some(&sock), &["ping"]);
    server.join().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stderr(&out), "maru: unknown method: ping\n");
}

#[test]
fn an_app_that_hangs_up_without_answering_is_an_error() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let listener = UnixListener::bind(&sock).unwrap();
    let server = std::thread::spawn(move || drop(accept_within(&listener)));
    let out = maru(Some(&sock), &["ping"]);
    server.join().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).starts_with("maru: "), "{}", stderr(&out));
}

#[test]
fn an_app_that_never_answers_times_out() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |_| None);
    let started = Instant::now();
    let out = maru(Some(&sock), &["ping"]);
    server.join().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("did not answer"), "{}", stderr(&out));
    assert!(started.elapsed() < Duration::from_secs(20));
}

fn ping_against(reply: impl FnOnce(&Value) -> Option<String> + Send + 'static) -> Output {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, reply);
    let out = maru(Some(&sock), &["ping"]);
    server.join().unwrap();
    out
}

#[test]
fn malformed_answers_are_errors() {
    type Reply = fn(&Value) -> Option<String>;
    let cases: [(&str, Reply); 3] = [
        ("not json", |_| Some("{nope".into())),
        ("neither result nor error", |req| {
            Some(json!({ "jsonrpc": "2.0", "id": req["id"] }).to_string())
        }),
        ("result without session", |req| result(req, json!({}))),
    ];
    for (name, reply) in cases {
        let out = ping_against(reply);
        assert_eq!(out.status.code(), Some(1), "{name}");
        assert!(
            stderr(&out).starts_with("maru: "),
            "{name}: {}",
            stderr(&out)
        );
        assert!(stdout(&out).is_empty(), "{name}: {}", stdout(&out));
    }
}

#[test]
fn a_mismatch_without_the_app_version_still_reads() {
    let out = ping_against(|req| {
        error(
            req,
            -32000,
            "protocol version mismatch",
            json!({ "code": "protocol_mismatch" }),
        )
    });
    assert_eq!(out.status.code(), Some(1));
    assert!(!stderr(&out).contains("null"), "{}", stderr(&out));
}

#[test]
fn one_missing_or_empty_variable_is_outside_an_app_terminal() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let cases: [(&str, &[(&str, &str)]); 3] = [
        ("socket only", &[("MARU_SOCKET", "/tmp/x.sock")]),
        ("session only", &[("MARU_SESSION_ID", SESSION)]),
        (
            "empty session",
            &[
                ("MARU_SOCKET", sock.to_str().unwrap()),
                ("MARU_SESSION_ID", ""),
            ],
        ),
    ];
    for (name, vars) in cases {
        let out = Command::new(env!("CARGO_BIN_EXE_maru"))
            .arg("ping")
            .env_remove("MARU_SOCKET")
            .env_remove("MARU_SESSION_ID")
            .envs(vars.iter().copied())
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(1), "{name}");
        assert!(
            stderr(&out).contains("MARU_SOCKET"),
            "{name}: {}",
            stderr(&out)
        );
    }
}

#[test]
fn a_usage_error_exits_with_1() {
    let out = maru(None, &["no-such-command"]);
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn version_does_not_need_the_app() {
    let out = maru(None, &["--version"]);
    assert!(out.status.success());
    assert!(stdout(&out).starts_with("maru "), "{}", stdout(&out));
}
