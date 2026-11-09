use crate::frame::{
    MAX_FRAME_LEN, TAG_BINARY, TAG_TEXT, error, read_frame, write_frame, write_json,
};
use crate::pty::{Output, Pty, Recv, wait_exit};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;
use tokio::net::unix::OwnedWriteHalf;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};

/// RIS. 화면만 지우면 밀린 사이 프로그램이 기본값으로 되돌린 모드(대체 화면·숨긴 커서·스크롤
/// 리전)가 클라이언트에 남는다. 전부 기본값으로 돌린 뒤 재생이 필요한 것만 다시 세운다.
const VT_RESET: &[u8] = b"\x1bc";
/// 성공해도 되돌리지 않는다 — 못 따라잡는 소비자에게 덤프를 계속 보내며 부하를 키우지 않게.
const MAX_RESYNCS: u32 = 5;
/// 재생을 나눠 싣는 Binary 프레임 하나의 크기. 재생은 프레임 한도(`MAX_FRAME_LEN`)를 넘을 수 있다.
const REPLAY_CHUNK: usize = 1024 * 1024;
/// 셸에 아직 쓰지 못한 입력을 연결마다 쌓아 두는 양. 프레임 하나는 늘 들어가야 하므로 프레임 한도와 같다. 차면
/// 소켓을 더 읽지 않는다.
const INPUT_QUEUE: u32 = MAX_FRAME_LEN;

pub async fn run(stream: UnixStream, pty: Arc<Pty>, req: &Value, version: u32) {
    let (mut rd, mut wr) = stream.into_split();

    let mut primary = match req["role"].as_str() {
        None | Some("observer") => false,
        Some("primary") => true,
        Some(_) => {
            let _ = write_json(
                &mut wr,
                &error("unknown_role", "role must be primary or observer"),
            )
            .await;
            return;
        }
    };
    let conn = pty.next_conn_id();
    let mut primary_rx = pty.primary_rx();
    if primary {
        let size = match (dim(&req["cols"]), dim(&req["rows"])) {
            (Some(c @ 1..), Some(r @ 1..)) => Some((c, r)),
            _ => None,
        };
        // 스냅샷 전에 맞춘다. 뒤에 하면 옛 격자로 뜬 재생을 새 격자로 그리게 된다.
        if let Err(e) = pty.claim_primary(conn, size) {
            log!("maru-pty: attach resize failed: {e:#}");
        }
    }

    let Some(mut output) = replay(&mut wr, &pty, conn, Header::Attached(version)).await else {
        pty.release_primary(conn);
        return;
    };

    // 입력은 이 루프를 거치지 않고 쓰기 태스크로 넘긴다. 프로그램이 입력을 읽지 않아 쓰기가 막혀도 이 루프는 출력을
    // 계속 보낸다. Ctrl-C 도 출력을 보내느라 막힌 이 루프를 기다리지 않는다.
    let (text_tx, mut text_rx) = mpsc::channel::<Vec<u8>>(64);
    let (input_tx, input_rx) = mpsc::unbounded_channel();
    tokio::spawn(write_input(pty.clone(), input_rx));
    let reader = tokio::spawn({
        let pty = pty.clone();
        let room = Arc::new(Semaphore::new(INPUT_QUEUE as usize));
        async move {
            while let Ok(Some((tag, payload))) = read_frame(&mut rd).await {
                let sent = match tag {
                    TAG_BINARY if pty.is_primary(conn) => {
                        let room = room.clone().acquire_many_owned(payload.len() as u32).await;
                        room.is_ok_and(|permit| input_tx.send((payload, permit)).is_ok())
                    }
                    TAG_TEXT => text_tx.send(payload).await.is_ok(),
                    _ => true,
                };
                if !sent {
                    break;
                }
            }
        }
    });

    let mut exit_rx = pty.exit_rx();
    let mut resyncs = 0;
    loop {
        tokio::select! {
            r = output.recv() => {
                if !forward(&mut wr, &pty, conn, &mut output, &mut resyncs, r).await {
                    break;
                }
            },

            incoming = text_rx.recv() => match incoming {
                Some(text) => {
                    let v = serde_json::from_slice::<Value>(&text).unwrap_or_default();
                    match v["type"].as_str() {
                        Some("resize") => {
                            if let (Some(c @ 1..), Some(r @ 1..)) =
                                (dim(&v["cols"]), dim(&v["rows"]))
                            {
                                let _ = pty.resize_if_primary(conn, c, r);
                            }
                        }
                        Some("clear_scrollback") => {
                            if let Err(e) = pty.clear_scrollback_if_primary(conn) {
                                log!("maru-pty: clear_scrollback failed: {e:#}");
                            }
                        }
                        _ => {}
                    }
                }
                None => break,
            },

            Ok(_) = primary_rx.changed(), if primary => {
                if !pty.is_primary(conn) {
                    primary = false;
                    if write_json(&mut wr, &json!({ "type": "role", "role": "observer" })).await.is_err() {
                        break;
                    }
                }
            },

            exit = wait_exit(&mut exit_rx) => {
                let Some(exit) = exit else { break };
                // select! 는 준비된 갈래를 무작위로 고르므로 남은 출력을 먼저 내보낸다.
                let mut flushed = true;
                while flushed && let Some(r) = output.try_recv() {
                    flushed = forward(&mut wr, &pty, conn, &mut output, &mut resyncs, r).await;
                }
                if flushed {
                    let mut body = serde_json::to_value(exit).unwrap();
                    body["type"] = json!("exit");
                    let _ = write_json(&mut wr, &body).await;
                }
                break;
            }
        }
    }
    pty.release_primary(conn);
    // 리더 태스크가 읽기 절반을 들고 있어 멈추지 않으면 클라이언트가 조용한 동안 fd 가 안 닫힌다.
    reader.abort();
    let _ = wr.shutdown().await;
}

/// 받은 순서대로 셸에 쓴다. 연결이 끝나도 받아 둔 입력은 다 쓴다. 클라이언트가 끊기 직전에 보낸 입력도 셸에 닿게
/// 하려는 것이다.
async fn write_input(
    pty: Arc<Pty>,
    mut rx: mpsc::UnboundedReceiver<(Vec<u8>, OwnedSemaphorePermit)>,
) {
    while let Some((bytes, permit)) = rx.recv().await {
        let pty = pty.clone();
        let _ = tokio::task::spawn_blocking(move || pty.write(&bytes)).await;
        drop(permit);
    }
}

fn dim(v: &Value) -> Option<u16> {
    v.as_u64().and_then(|n| u16::try_from(n).ok())
}

async fn forward(
    wr: &mut OwnedWriteHalf,
    pty: &Pty,
    conn: u64,
    output: &mut Arc<Output>,
    resyncs: &mut u32,
    r: Recv,
) -> bool {
    match r {
        Recv::Data(bytes) => write_frame(wr, TAG_BINARY, &bytes).await.is_ok(),
        Recv::Size { cols, rows } => {
            write_json(wr, &json!({ "type": "size", "cols": cols, "rows": rows }))
                .await
                .is_ok()
        }
        Recv::Lagged => match resync(wr, pty, conn, resyncs).await {
            Some(new) => {
                *output = new;
                true
            }
            None => false,
        },
    }
}

enum Header {
    /// 붙을 때의 헤더. 요청의 `protocol_version` 을 싣는다.
    Attached(u32),
    Resync,
}

async fn replay(
    wr: &mut OwnedWriteHalf,
    pty: &Pty,
    conn: u64,
    kind: Header,
) -> Option<Arc<Output>> {
    let (payload, st, output) = match pty.subscribe_with_replay(conn) {
        Ok(v) => v,
        Err(e) => {
            let _ = write_json(wr, &error("capture_failed", &format!("{e:#}"))).await;
            return None;
        }
    };
    let resync = matches!(kind, Header::Resync);
    let mut header = json!({
        "type": if resync { "resync" } else { "attached" },
        "cols": st.cols,
        "rows": st.rows,
        "cursor_x": st.cursor_x,
        "cursor_y": st.cursor_y,
    });
    if let Header::Attached(version) = kind {
        header["protocol_version"] = json!(version);
        header["tty"] = json!(pty.tty);
        header["role"] = json!(if pty.is_primary(conn) {
            "primary"
        } else {
            "observer"
        });
    }
    write_json(wr, &header).await.ok()?;
    // 첫 attach 의 클라이언트 그리드는 이미 비어 있다.
    if resync {
        write_frame(wr, TAG_BINARY, VT_RESET).await.ok()?;
    }
    for chunk in payload.chunks(REPLAY_CHUNK) {
        write_frame(wr, TAG_BINARY, chunk).await.ok()?;
    }
    write_json(wr, &json!({ "type": "replay_end" }))
        .await
        .ok()?;
    Some(output)
}

async fn resync(
    wr: &mut OwnedWriteHalf,
    pty: &Pty,
    conn: u64,
    count: &mut u32,
) -> Option<Arc<Output>> {
    *count += 1;
    if *count > MAX_RESYNCS {
        let _ = write_json(
            wr,
            &error(
                "resync_limit_exceeded",
                "the client cannot keep up with the output",
            ),
        )
        .await;
        return None;
    }
    replay(wr, pty, conn, Header::Resync).await
}
