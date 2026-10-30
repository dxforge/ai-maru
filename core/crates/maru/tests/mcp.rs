use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const PTY: &str = "p-test";

fn tmpdir() -> tempfile::TempDir {
    // macOS 의 기본 temp 디렉토리는 길어서 소켓 경로 한도에 가까워진다.
    tempfile::Builder::new()
        .prefix("mm")
        .tempdir_in("/tmp")
        .unwrap()
}

fn sock_in(tmp: &tempfile::TempDir) -> PathBuf {
    tmp.path().join("app.sock")
}

type Reply = Box<dyn Fn(&Value) -> Option<String> + Send>;

fn serve(sock: &Path, n: usize, reply: Reply) -> JoinHandle<Vec<Value>> {
    let listener = UnixListener::bind(sock).unwrap();
    std::thread::spawn(move || {
        (0..n)
            .map(|_| {
                let stream = accept_within(&listener);
                let mut line = String::new();
                BufReader::new(&stream).read_line(&mut line).unwrap();
                let req: Value = serde_json::from_str(&line).unwrap();
                if let Some(out) = reply(&req) {
                    writeln!(&stream, "{out}").unwrap();
                }
                req
            })
            .collect()
    })
}

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
                assert!(Instant::now() < deadline, "maru mcp 가 연결하지 않았다");
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => panic!("{e}"),
        }
    }
}

fn echo() -> Reply {
    Box::new(|req| {
        let msg = &req["params"]["message"];
        let result = if msg.get("id").is_some() {
            json!({ "message": { "jsonrpc": "2.0", "id": msg["id"], "result": { "echo": msg } } })
        } else {
            Value::Null
        };
        Some(json!({ "jsonrpc": "2.0", "id": req["id"], "result": result }).to_string())
    })
}

struct Mcp {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<String>,
}

impl Mcp {
    fn spawn(sock: Option<&Path>, cwd: &Path) -> Self {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_maru"));
        cmd.arg("mcp")
            .current_dir(cwd)
            .env_remove("MARU_SOCKET")
            .env_remove("MARU_PTY_ID")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(sock) = sock {
            cmd.env("MARU_SOCKET", sock).env("MARU_PTY_ID", PTY);
        }
        let mut child = cmd.spawn().unwrap();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Mcp {
            child,
            stdin,
            lines,
        }
    }

    fn send_line(&mut self, line: &str) {
        let stdin = self.stdin.as_mut().unwrap();
        writeln!(stdin, "{line}").unwrap();
        stdin.flush().unwrap();
    }

    fn send(&mut self, msg: &Value) {
        self.send_line(&msg.to_string());
    }

    fn next(&self, within: Duration) -> Value {
        let line = self
            .lines
            .recv_timeout(within)
            .expect("maru mcp 가 답을 쓰지 않았다");
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("JSON 이 아닌 줄: {line}"))
    }

    fn close(mut self) -> (ExitStatus, Vec<Value>) {
        drop(self.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(15);
        let status = loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() > deadline {
                let _ = self.child.kill();
                panic!("maru mcp 가 stdin 을 닫아도 끝나지 않았다");
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let rest = self
            .lines
            .iter()
            .map(|l| serde_json::from_str(&l).unwrap())
            .collect();
        (status, rest)
    }
}

fn request(id: i64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

fn canvas_put(id: i64, args: Value) -> Value {
    request(
        id,
        "tools/call",
        json!({ "name": "canvas_put", "arguments": args }),
    )
}

fn tool_error_text(reply: &Value) -> &str {
    assert_eq!(reply["result"]["isError"], true, "{reply}");
    reply["result"]["content"][0]["text"].as_str().unwrap()
}

const SHORT: Duration = Duration::from_secs(5);

#[test]
fn relays_each_message_as_an_mcp_message_request_and_writes_the_reply() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let app = serve(&sock, 3, echo());
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    let init = request(0, "initialize", json!({ "protocolVersion": "2025-11-25" }));
    mcp.send(&init);
    mcp.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    mcp.send(&request(1, "tools/list", json!({})));

    let (status, out) = mcp.close();
    let reqs = app.join().unwrap();

    assert!(status.success());
    assert_eq!(out.len(), 2, "알림에는 답하지 않는다: {out:?}");
    assert_eq!(out[0]["id"], 0);
    assert_eq!(out[0]["result"]["echo"], init);
    assert_eq!(out[1]["id"], 1);
    for req in &reqs {
        assert_eq!(req["method"], "mcp.message");
        assert_eq!(req["params"]["protocol_version"], 1);
        assert_eq!(req["params"]["pty"], PTY);
    }
    assert_eq!(reqs[0]["params"]["message"], init);
    assert_eq!(
        reqs[1]["params"]["message"]["method"],
        "notifications/initialized"
    );
}

#[test]
fn reads_a_relative_file_into_text() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    std::fs::write(tmp.path().join("note.md"), "\u{feff}# Note\n").unwrap();
    let app = serve(&sock, 1, echo());
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    mcp.send(&canvas_put(2, json!({ "file": "note.md", "id": "n" })));

    let (status, out) = mcp.close();
    let reqs = app.join().unwrap();

    assert!(status.success());
    assert_eq!(out.len(), 1);
    assert_eq!(
        reqs[0]["params"]["message"]["params"]["arguments"],
        json!({ "text": "# Note\n", "id": "n" })
    );
}

#[test]
fn sends_text_and_file_together_unchanged_for_the_app_to_refuse() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let app = serve(&sock, 1, echo());
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    let call = canvas_put(3, json!({ "text": "# T", "file": "missing.md" }));
    mcp.send(&call);

    mcp.close();
    let reqs = app.join().unwrap();

    assert_eq!(reqs[0]["params"]["message"], call);
}

#[test]
fn a_file_it_cannot_read_is_a_tool_error_and_is_not_sent() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    std::fs::write(tmp.path().join("blank.md"), " \n").unwrap();
    std::fs::write(tmp.path().join("latin1.md"), b"caf\xe9").unwrap();
    // 앱은 연결을 하나만 받는다. 읽지 못한 `canvas_put` 은 보내지 않고 뒤의 `ping` 만 보내기 때문이다.
    let app = serve(&sock, 1, echo());
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    for (id, file) in [(1, "missing.md"), (2, "blank.md"), (3, "latin1.md")] {
        mcp.send(&canvas_put(id, json!({ "file": file })));
    }
    // 알림으로 부른 `canvas_put` 은 파일을 읽지 못해도 답이 없다. 실패를 알릴 곳이 없기 때문이다.
    mcp.send(&json!({
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": { "name": "canvas_put", "arguments": { "file": "missing.md" } },
    }));
    mcp.send(&request(4, "ping", json!({})));

    let (status, out) = mcp.close();
    let reqs = app.join().unwrap();

    assert!(status.success());
    assert_eq!(out.len(), 4, "{out:?}");
    assert!(
        tool_error_text(&out[0]).contains("missing.md"),
        "{}",
        out[0]
    );
    assert!(
        tool_error_text(&out[1]).contains("blank.md is empty"),
        "{}",
        out[1]
    );
    assert!(tool_error_text(&out[2]).contains("not UTF-8"), "{}", out[2]);
    for (i, reply) in out.iter().enumerate() {
        assert_eq!(reply["id"], i as i64 + 1);
    }
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0]["params"]["message"]["method"], "ping");
}

#[test]
fn lines_that_are_not_messages_get_json_rpc_errors_without_reaching_the_app() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let app = serve(&sock, 1, echo());
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    mcp.send_line("{not json");
    mcp.send_line(r#"[{"jsonrpc":"2.0","id":1,"method":"ping"}]"#);
    mcp.send_line("");
    mcp.send(&request(5, "ping", json!({})));

    let (status, out) = mcp.close();
    let reqs = app.join().unwrap();

    assert!(status.success());
    assert_eq!(out.len(), 3, "빈 줄에는 답하지 않는다: {out:?}");
    assert_eq!(out[0]["error"]["code"], -32700);
    assert_eq!(out[0]["id"], Value::Null);
    assert_eq!(out[1]["error"]["code"], -32600);
    assert_eq!(out[2]["id"], 5);
    assert_eq!(reqs.len(), 1);
}

#[test]
fn an_error_from_the_app_becomes_a_tool_error_or_a_json_rpc_error() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let mismatch: Reply = Box::new(|req| {
        Some(
            json!({
                "jsonrpc": "2.0",
                "id": req["id"],
                "error": {
                    "code": -32000,
                    "message": "protocol version mismatch",
                    "data": { "code": "protocol_mismatch", "protocol_version": 2 },
                },
            })
            .to_string(),
        )
    });
    let app = serve(&sock, 3, mismatch);
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    mcp.send(&canvas_put(1, json!({ "text": "# T" })));
    mcp.send(&request(2, "initialize", json!({})));
    mcp.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));

    let (status, out) = mcp.close();
    app.join().unwrap();

    assert!(status.success());
    assert_eq!(out.len(), 2, "알림의 실패는 쓰지 않는다: {out:?}");
    assert!(
        tool_error_text(&out[0]).contains("protocol v2"),
        "{}",
        out[0]
    );
    assert_eq!(out[1]["id"], 2);
    assert_eq!(out[1]["error"]["code"], -32603);
    assert!(
        out[1]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("protocol v2"),
        "{}",
        out[1]
    );
}

#[test]
fn a_connection_closed_without_an_answer_fails_at_once_and_is_not_retried() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let app = serve(&sock, 1, Box::new(|_| None));
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    let started = Instant::now();
    mcp.send(&canvas_put(1, json!({ "text": "# T" })));

    let reply = mcp.next(SHORT);
    // 다시 보냈다면 가짜 앱이 더 받지 않아 연결을 기다리느라 답이 10초 늦는다.
    assert!(started.elapsed() < SHORT);
    assert!(
        tool_error_text(&reply).contains("closed the connection"),
        "{reply}"
    );
    let reqs = app.join().unwrap();
    assert_eq!(reqs.len(), 1);
    let (status, out) = mcp.close();
    assert!(status.success());
    assert!(out.is_empty(), "{out:?}");
}

#[test]
fn without_the_app_it_waits_ten_seconds_then_fails_that_message_and_keeps_running() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    let started = Instant::now();
    mcp.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    mcp.send(&canvas_put(1, json!({ "text": "# T" })));
    mcp.send(&request(2, "initialize", json!({})));

    let first = mcp.next(Duration::from_secs(30));
    let waited = started.elapsed();
    // 알림도 10초를 기다리므로 `canvas_put` 의 답은 두 번의 대기(20초쯤) 뒤에 나온다.
    assert!(waited >= Duration::from_secs(19), "{waited:?}");
    assert_eq!(first["id"], 1);
    assert!(
        tool_error_text(&first).starts_with("AI Maru app is not running"),
        "{first}"
    );
    let second = mcp.next(Duration::from_secs(15));
    assert_eq!(second["id"], 2);
    assert_eq!(second["error"]["code"], -32603);

    let app = serve(&sock, 1, echo());
    mcp.send(&request(3, "ping", json!({})));
    assert_eq!(mcp.next(SHORT)["id"], 3);
    let (status, _) = mcp.close();
    assert!(status.success());
    app.join().unwrap();
}

#[test]
fn waits_for_a_stale_socket_to_be_replaced_by_a_new_app() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    // 앱이 끝나며 남긴 소켓 파일 — connect 를 거절한다.
    drop(UnixListener::bind(&sock).unwrap());
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    let started = Instant::now();
    mcp.send(&canvas_put(1, json!({ "text": "# T" })));

    std::thread::sleep(Duration::from_secs(2));
    // 앱처럼 다른 이름으로 듣기 시작한 뒤 옮긴다.
    let listening = tmp.path().join(".sock");
    let app = serve(&listening, 1, echo());
    std::fs::rename(&listening, &sock).unwrap();

    let reply = mcp.next(Duration::from_secs(15));
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_eq!(reply["id"], 1);
    assert!(reply["result"].get("isError").is_none(), "{reply}");
    app.join().unwrap();
    let (status, _) = mcp.close();
    assert!(status.success());
}

#[test]
fn outside_an_app_terminal_it_exits_with_an_error() {
    let tmp = tmpdir();
    let mcp = Mcp::spawn(None, tmp.path());
    let output = mcp.child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("not inside an AI Maru terminal"),
        "{stderr}"
    );
}

#[test]
fn an_answer_without_a_message_is_an_error() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let app = serve(
        &sock,
        1,
        Box::new(|req| {
            Some(json!({ "jsonrpc": "2.0", "id": req["id"], "result": {} }).to_string())
        }),
    );
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    mcp.send(&request(1, "tools/list", json!({})));

    let (status, out) = mcp.close();
    app.join().unwrap();

    assert!(status.success());
    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["error"]["code"], -32603);
    assert!(
        out[0]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("without a message"),
        "{}",
        out[0]
    );
}

#[test]
fn an_app_that_does_not_answer_fails_after_the_timeout_without_a_resend() {
    let tmp = tmpdir();
    let sock = sock_in(&tmp);
    let listener = UnixListener::bind(&sock).unwrap();
    // 앱은 요청을 읽고 답하지 않은 채 `maru mcp` 가 연결을 끊을 때까지 연결을 열어 둔다. 끊긴 뒤 1초 안에 다시 붙어
    // 오는지 본다.
    let app = std::thread::spawn(move || {
        let stream = accept_within(&listener);
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let _ = reader.read_line(&mut line);
        listener.set_nonblocking(true).unwrap();
        std::thread::sleep(Duration::from_secs(1));
        listener.accept().is_ok()
    });
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    let started = Instant::now();
    mcp.send(&canvas_put(1, json!({ "text": "# T" })));

    let reply = mcp.next(Duration::from_secs(20));
    let waited = started.elapsed();
    assert!(waited >= Duration::from_secs(9), "{waited:?}");
    assert!(
        tool_error_text(&reply).contains("did not answer"),
        "{reply}"
    );
    assert!(!app.join().unwrap(), "다시 보냈다");
    let (status, _) = mcp.close();
    assert!(status.success());
}

#[test]
fn without_the_socket_directory_it_fails_at_once() {
    let tmp = tmpdir();
    let sock = tmp.path().join("gone").join("app.sock");
    let mut mcp = Mcp::spawn(Some(&sock), tmp.path());
    let started = Instant::now();
    mcp.send(&request(1, "ping", json!({})));

    let reply = mcp.next(SHORT);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(reply["error"]["code"], -32603);
    assert!(
        reply["error"]["message"]
            .as_str()
            .unwrap()
            .starts_with("AI Maru app is not running"),
        "{reply}"
    );
    let (status, _) = mcp.close();
    assert!(status.success());
}
