use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
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
    maru_with(sock, args, Stdio::null())
        .wait_with_output()
        .unwrap()
}

fn maru_cmd(sock: Option<&Path>, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_maru"));
    cmd.args(args)
        .env_remove("MARU_SOCKET")
        .env_remove("MARU_SESSION_ID")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(sock) = sock {
        cmd.env("MARU_SOCKET", sock).env("MARU_SESSION_ID", SESSION);
    }
    cmd
}

fn maru_with(sock: Option<&Path>, args: &[&str], stdin: Stdio) -> Child {
    maru_cmd(sock, args).stdin(stdin).spawn().unwrap()
}

fn maru_input(sock: Option<&Path>, args: &[&str], input: &[u8]) -> Output {
    run_with_input(maru_cmd(sock, args), input)
}

fn run_with_input(mut cmd: Command, input: &[u8]) -> Output {
    let mut child = cmd.stdin(Stdio::piped()).spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let input = input.to_vec();
    // CLI 가 다 읽기 전에 끝나면 쓰기가 EPIPE 로 실패한다.
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(&input);
    });
    let out = wait_within(child);
    writer.join().unwrap();
    out
}

/// CLI 가 stdin 을 기다리며 멈춰도 테스트가 멈추지 않게.
fn wait_within(mut child: Child) -> Output {
    let deadline = Instant::now() + Duration::from_secs(15);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() > deadline {
            let _ = child.kill();
            panic!("CLI 가 끝나지 않았다");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    child.wait_with_output().unwrap()
}

fn assert_fails_with(out: &Output, expected: &str) {
    assert_eq!(out.status.code(), Some(1), "{}", stderr(out));
    assert!(stderr(out).contains(expected), "{}", stderr(out));
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

#[test]
fn canvas_put_sends_stdin_unchanged_and_prints_the_id() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, json!({ "id": "doc-1" })));
    let text = "# 제목\r\n\nbody\n\n";

    let out = maru_input(Some(&sock), &["canvas", "put"], text.as_bytes());
    let req = server.join().unwrap();

    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(stdout(&out), "doc-1\n");
    assert_eq!(req["method"], "canvas.put");
    assert_eq!(req["params"]["protocol_version"], 1);
    assert_eq!(req["params"]["session"], SESSION);
    assert_eq!(req["params"]["text"], text);
    assert!(req["params"].get("id").is_none(), "{req}");
    assert!(req["params"].get("title").is_none(), "{req}");
}

#[test]
fn canvas_put_passes_id_and_title() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| {
        result(req, json!({ "id": req["params"]["id"] }))
    });

    let args = ["canvas", "put", "--id", "plan", "--title", "Plan"];
    let out = maru_input(Some(&sock), &args, b"x");
    let req = server.join().unwrap();

    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(stdout(&out), "plan\n");
    assert_eq!(req["params"]["id"], "plan");
    assert_eq!(req["params"]["title"], "Plan");
}

#[test]
fn canvas_put_reads_a_file_and_ignores_stdin() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let note = tmp.path().join("note.md");
    std::fs::write(&note, "# from file\n").unwrap();
    let server = serve_once(&sock, |req| result(req, json!({ "id": "f" })));

    let args = ["canvas", "put", note.to_str().unwrap()];
    let out = maru_input(Some(&sock), &args, b"# from stdin");
    let req = server.join().unwrap();

    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(req["params"]["text"], "# from file\n");
}

#[test]
fn canvas_put_dash_reads_stdin() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, json!({ "id": "s" })));

    let out = maru_input(Some(&sock), &["canvas", "put", "-"], b"# from stdin");
    let req = server.join().unwrap();

    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(req["params"]["text"], "# from stdin");
}

#[test]
fn canvas_put_drops_one_leading_bom() {
    let files = tmpdir();
    let note = files.path().join("bom.md");
    std::fs::write(&note, "\u{feff}\u{feff}# 제목\n").unwrap();
    let from_file = ["canvas", "put", note.to_str().unwrap()];
    let from_stdin = ["canvas", "put"];
    for args in [&from_file[..], &from_stdin[..]] {
        let tmp = tmpdir();
        let sock = sock_in(&tmp);
        let server = serve_once(&sock, |req| result(req, json!({ "id": "b" })));
        let out = maru_input(Some(&sock), args, "\u{feff}\u{feff}# 제목\n".as_bytes());
        let req = server.join().unwrap();

        assert!(out.status.success(), "{args:?}: {}", stderr(&out));
        assert_eq!(req["params"]["text"], "\u{feff}# 제목\n", "{args:?}");
    }
}

#[test]
fn canvas_put_rejects_bad_input_without_reaching_the_app() {
    let tmp = tmpdir();
    // 소켓이 없어서, 연결을 시도했다면 "cannot reach the app" 이 나온다.
    let sock = sock_in(&tmp);
    let cases: [(&[&str], &[u8], &str); 5] = [
        (&["canvas", "put"], b"", "stdin is empty"),
        (&["canvas", "put"], b" \n\t\r\n", "stdin is empty"),
        (
            &["canvas", "put"],
            "\u{feff}\n".as_bytes(),
            "stdin is empty",
        ),
        (
            &["canvas", "put"],
            &[0x23, 0x20, 0xff, 0xfe],
            "stdin is not UTF-8",
        ),
        (
            &["canvas", "put", "--id", ""],
            b"# x",
            "--id must not be empty",
        ),
    ];
    for (args, input, expected) in cases {
        assert_fails_with(&maru_input(Some(&sock), args, input), expected);
    }
}

#[test]
fn canvas_put_rejects_unreadable_files_without_reaching_the_app() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let empty = tmp.path().join("empty.md");
    std::fs::write(&empty, "\n").unwrap();
    let binary = tmp.path().join("shot.png");
    std::fs::write(&binary, [0x89, 0x50, 0x4e, 0x47, 0xff]).unwrap();
    let missing = tmp.path().join("missing.md");
    let cases = [
        (
            missing.clone(),
            format!("cannot read {}", missing.display()),
        ),
        (
            tmp.path().to_path_buf(),
            format!("cannot read {}", tmp.path().display()),
        ),
        (empty.clone(), format!("{} is empty", empty.display())),
        (binary.clone(), format!("{} is not UTF-8", binary.display())),
    ];
    for (path, expected) in cases {
        let args = ["canvas", "put", path.to_str().unwrap()];
        assert_fails_with(&maru_input(Some(&sock), &args, b""), &expected);
    }
}

#[test]
fn canvas_put_with_terminal_stdin_fails_without_waiting() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    for args in [&["canvas", "put"][..], &["canvas", "put", "-"]] {
        let pty = nix::pty::openpty(None, None).unwrap();
        let child = maru_with(Some(&sock), args, Stdio::from(pty.slave));
        let out = wait_within(child);
        drop(pty.master);
        assert_fails_with(&out, "pipe markdown into stdin");
    }
}

fn endless() -> (Child, Stdio) {
    let mut yes = Command::new("yes").stdout(Stdio::piped()).spawn().unwrap();
    let out = Stdio::from(yes.stdout.take().unwrap());
    (yes, out)
}

#[test]
fn canvas_put_stops_reading_past_what_the_app_accepts() {
    let tmp = tmpdir();
    // 소켓이 없어서, 연결을 시도했다면 "cannot reach the app" 이 나온다.
    let sock = sock_in(&tmp);
    let (mut yes, input) = endless();
    let out = wait_within(maru_with(Some(&sock), &["canvas", "put"], input));
    let _ = yes.kill();
    let _ = yes.wait();
    assert_fails_with(&out, "stdin is larger than the 16 MiB the app accepts");

    let big = tmp.path().join("big.md");
    std::fs::write(&big, vec![b'a'; 16 * 1024 * 1024 + 1]).unwrap();
    let args = ["canvas", "put", big.to_str().unwrap()];
    let out = maru_input(Some(&sock), &args, b"");
    assert_fails_with(&out, "is larger than the 16 MiB the app accepts");
}

#[test]
fn canvas_put_outside_an_app_terminal_fails_before_reading() {
    let (mut yes, input) = endless();
    let out = wait_within(maru_with(None, &["canvas", "put"], input));
    let _ = yes.kill();
    let _ = yes.wait();
    assert_fails_with(&out, "not inside an AI Maru terminal");
}

#[test]
fn canvas_put_shows_the_apps_reason() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| {
        error(
            req,
            -32600,
            "request line exceeds 16777216 bytes",
            json!({ "code": "too_large" }),
        )
    });
    let out = maru_input(Some(&sock), &["canvas", "put"], b"x");
    server.join().unwrap();
    assert_fails_with(&out, "request line exceeds");
}

#[test]
fn canvas_put_needs_an_id_in_the_answer() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, json!({})));
    let out = maru_input(Some(&sock), &["canvas", "put"], b"x");
    server.join().unwrap();
    assert_fails_with(&out, "without a document id");
}

fn maru_claude(sock: &Path, args: &[&str], input: &[u8], vars: &[(&str, &str)]) -> Output {
    let mut cmd = maru_cmd(Some(sock), args);
    cmd.current_dir(sock.parent().unwrap())
        .env("HOME", "/h")
        .env_remove("CLAUDE_CONFIG_DIR");
    for (k, v) in vars {
        cmd.env(k, v);
    }
    run_with_input(cmd, input)
}

const HOOK: &[u8] =
    br#"{"session_id":"c-1","hook_event_name":"UserPromptSubmit","prompt":"hi","cwd":"/x"}"#;

#[test]
fn claude_hook_forwards_the_event_and_session_silently() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, Value::Null));

    let out = maru_claude(&sock, &["claude", "hook"], HOOK, &[]);
    let req = server.join().unwrap();

    assert!(out.status.success(), "{}", stderr(&out));
    // SessionStart·UserPromptSubmit hook 의 stdout 은 claude 의 컨텍스트에 들어간다.
    assert_eq!(stdout(&out), "");
    assert_eq!(req["method"], "claude.hook");
    assert_eq!(req["params"]["protocol_version"], 1);
    assert_eq!(req["params"]["session"], SESSION);
    assert_eq!(req["params"]["event"], "UserPromptSubmit");
    assert_eq!(req["params"]["claude_session"], "c-1");
    assert_eq!(req["params"]["config_dir"], "/h/.claude");
    assert!(req["params"].get("prompt").is_none(), "{req}");
    assert!(req["params"].get("source").is_none(), "{req}");
}

#[test]
fn claude_hook_forwards_the_session_start_source() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, Value::Null));

    let input = br#"{"session_id":"c-1","hook_event_name":"SessionStart","source":"compact"}"#;
    let out = maru_claude(&sock, &["claude", "hook"], input, &[]);

    assert!(out.status.success(), "{}", stderr(&out));
    let req = server.join().unwrap();
    assert_eq!(req["params"]["event"], "SessionStart");
    assert_eq!(req["params"]["source"], "compact");
}

#[test]
fn claude_hook_follows_claude_config_dir() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, Value::Null));

    let vars = [("CLAUDE_CONFIG_DIR", "/cfg")];
    let out = maru_claude(&sock, &["claude", "hook"], HOOK, &vars);

    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(server.join().unwrap()["params"]["config_dir"], "/cfg");
}

#[test]
fn claude_hook_treats_an_empty_config_dir_as_unset() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, Value::Null));

    let vars = [("CLAUDE_CONFIG_DIR", "")];
    let out = maru_claude(&sock, &["claude", "hook"], HOOK, &vars);

    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(server.join().unwrap()["params"]["config_dir"], "/h/.claude");
}

#[test]
fn claude_hook_resolves_a_relative_config_dir() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, Value::Null));

    let vars = [("CLAUDE_CONFIG_DIR", "rel")];
    let out = maru_claude(&sock, &["claude", "hook"], HOOK, &vars);

    assert!(out.status.success(), "{}", stderr(&out));
    let expected = tmp.path().canonicalize().unwrap().join("rel");
    assert_eq!(
        server.join().unwrap()["params"]["config_dir"],
        expected.to_str().unwrap()
    );
}

#[test]
fn claude_hook_rejects_payloads_it_cannot_use_without_reaching_the_app() {
    let tmp = tmpdir();
    // 소켓이 없어서, 연결을 시도했다면 "cannot reach the app" 이 나온다.
    let sock = sock_in(&tmp);
    let cases: [(&[u8], &str); 5] = [
        (b"not json", "stdin is not a hook payload"),
        (
            br#"{"hook_event_name":"Stop","session_id":""}"#,
            "no session_id",
        ),
        (br#"{"session_id":"c-1"}"#, "no hook_event_name"),
        (br#"{"hook_event_name":"Stop"}"#, "no session_id"),
        (
            br#"{"hook_event_name":"Stop","session_id":7}"#,
            "no session_id",
        ),
    ];
    for (input, expected) in cases {
        let out = maru_claude(&sock, &["claude", "hook"], input, &[]);
        assert_fails_with(&out, expected);
    }
}

#[test]
fn claude_hook_outside_an_app_terminal_says_so() {
    let out = maru(None, &["claude", "hook"]);
    assert_fails_with(&out, "not inside an AI Maru terminal");
}

#[test]
fn claude_exit_sends_the_session() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let server = serve_once(&sock, |req| result(req, Value::Null));

    let out = maru_claude(&sock, &["claude", "exit"], b"", &[]);
    let req = server.join().unwrap();

    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(stdout(&out), "");
    assert_eq!(req["method"], "claude.exit");
    assert_eq!(req["params"]["session"], SESSION);
}

#[test]
fn claude_commands_are_hidden_from_help() {
    let out = maru(None, &["--help"]);
    assert!(out.status.success(), "{}", stderr(&out));
    assert!(!stdout(&out).contains("claude"), "{}", stdout(&out));
}
