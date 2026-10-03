use crate::frame::{TAG_BINARY, TAG_TEXT, error, read_frame, write_frame, write_json};
use crate::session::{Output, Recv, Session, wait_exit};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;
use tokio::net::unix::OwnedWriteHalf;

/// RIS. 화면만 지우면 밀린 사이 프로그램이 기본값으로 되돌린 모드(대체 화면·숨긴 커서·스크롤
/// 리전)가 클라이언트에 남는다. 전부 기본값으로 돌린 뒤 재생이 필요한 것만 다시 세운다.
const VT_RESET: &[u8] = b"\x1bc";
/// 성공해도 되돌리지 않는다 — 못 따라잡는 소비자에게 덤프를 계속 보내며 부하를 키우지 않게.
const MAX_RESYNCS: u32 = 5;

pub async fn run(stream: UnixStream, session: Arc<Session>, req: &Value) {
    let (mut rd, mut wr) = stream.into_split();

    let mut primary = match req["role"].as_str() {
        None | Some("observer") => false,
        Some("primary") => true,
        Some(_) => {
            let _ = write_json(
                &mut wr,
                &error("unknown_role", "role 은 primary 나 observer 다"),
            )
            .await;
            return;
        }
    };
    let conn = session.next_conn_id();
    let mut primary_rx = session.primary_rx();
    if primary {
        let size = match (dim(&req["cols"]), dim(&req["rows"])) {
            (Some(c @ 1..), Some(r @ 1..)) => Some((c, r)),
            _ => None,
        };
        // 스냅샷 전에 맞춘다. 뒤에 하면 옛 격자로 뜬 재생을 새 격자로 그리게 된다.
        if let Err(e) = session.claim_primary(conn, size) {
            log!("maru-session: attach resize 실패: {e:#}");
        }
    }

    let Some(mut output) = replay(&mut wr, &session, conn, false).await else {
        session.release_primary(conn);
        return;
    };

    let (in_tx, mut in_rx) = tokio::sync::mpsc::channel::<(u8, Vec<u8>)>(64);
    let reader = tokio::spawn(async move {
        while let Ok(Some(frame)) = read_frame(&mut rd).await {
            if in_tx.send(frame).await.is_err() {
                break;
            }
        }
    });

    let mut exit_rx = session.exit_rx();
    let mut resyncs = 0;
    loop {
        tokio::select! {
            r = output.recv() => {
                if !forward(&mut wr, &session, conn, &mut output, &mut resyncs, r).await {
                    break;
                }
            },

            incoming = in_rx.recv() => match incoming {
                // observer 의 입력을 받으면 질의(`ESC[6n` 등)에 붙은 클라이언트마다 답한다.
                Some((TAG_BINARY, bytes)) if session.is_primary(conn) => {
                    let s = session.clone();
                    let _ = tokio::task::spawn_blocking(move || s.write(&bytes)).await;
                }
                Some((TAG_TEXT, text)) => {
                    if let Ok(v) = serde_json::from_slice::<Value>(&text)
                        && v["type"] == "resize"
                        && let (Some(c @ 1..), Some(r @ 1..)) = (dim(&v["cols"]), dim(&v["rows"]))
                    {
                        let _ = session.resize_if_primary(conn, c, r);
                    }
                }
                Some(_) => {}
                None => break,
            },

            Ok(_) = primary_rx.changed(), if primary => {
                if !session.is_primary(conn) {
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
                    flushed = forward(&mut wr, &session, conn, &mut output, &mut resyncs, r).await;
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
    session.release_primary(conn);
    // 리더 태스크가 읽기 절반을 들고 있어 멈추지 않으면 클라이언트가 조용한 동안 fd 가 안 닫힌다.
    reader.abort();
    let _ = wr.shutdown().await;
}

fn dim(v: &Value) -> Option<u16> {
    v.as_u64().and_then(|n| u16::try_from(n).ok())
}

async fn forward(
    wr: &mut OwnedWriteHalf,
    session: &Session,
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
        Recv::Lagged => match resync(wr, session, conn, resyncs).await {
            Some(new) => {
                *output = new;
                true
            }
            None => false,
        },
    }
}

async fn replay(
    wr: &mut OwnedWriteHalf,
    session: &Session,
    conn: u64,
    resync: bool,
) -> Option<Arc<Output>> {
    let (payload, st, output) = match session.subscribe_with_replay(conn) {
        Ok(v) => v,
        Err(e) => {
            let _ = write_json(wr, &error("capture_failed", &format!("{e:#}"))).await;
            return None;
        }
    };
    let mut header = json!({
        "type": if resync { "resync" } else { "attached" },
        "cols": st.cols,
        "rows": st.rows,
        "cursor_x": st.cursor_x,
        "cursor_y": st.cursor_y,
        "trailing_blank_rows": st.trailing_blank_rows,
    });
    if !resync {
        header["protocol_version"] = json!(crate::PROTOCOL_VERSION);
        header["tty"] = json!(session.tty);
        header["role"] = json!(if session.is_primary(conn) {
            "primary"
        } else {
            "observer"
        });
    }
    write_json(wr, &header).await.ok()?;
    // 첫 attach 의 클라이언트 그리드는 이미 비어 있다.
    let body = if resync {
        [VT_RESET, &payload].concat()
    } else {
        payload
    };
    write_frame(wr, TAG_BINARY, &body).await.ok()?;
    Some(output)
}

async fn resync(
    wr: &mut OwnedWriteHalf,
    session: &Session,
    conn: u64,
    count: &mut u32,
) -> Option<Arc<Output>> {
    *count += 1;
    if *count > MAX_RESYNCS {
        let _ = write_json(
            wr,
            &error("resync_limit_exceeded", "클라이언트가 출력을 못 따라잡는다"),
        )
        .await;
        return None;
    }
    replay(wr, session, conn, true).await
}
