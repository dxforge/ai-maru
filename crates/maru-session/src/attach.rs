use crate::frame::{TAG_BINARY, TAG_TEXT, error, read_frame, write_frame, write_json};
use crate::session::{Chunk, Session, wait_exit};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;
use tokio::net::unix::OwnedWriteHalf;
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::{RecvError, TryRecvError};

const VT_RESET: &[u8] = b"\x1b[H\x1b[2J\x1b[3J";
/// 성공해도 되돌리지 않는다 — 못 따라잡는 소비자에게 덤프를 계속 보내며 부하를 키우지 않게.
const MAX_RESYNCS: u32 = 5;
const MAX_BATCH: usize = 64 * 1024;

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
        session.claim_primary(conn);
        // 스냅샷 전에 맞춘다. 뒤에 하면 옛 격자로 뜬 재생을 새 격자로 그리게 된다.
        if let (Some(c @ 1..), Some(r @ 1..)) = (dim(&req["cols"]), dim(&req["rows"]))
            && let Err(e) = session.resize(c, r)
        {
            eprintln!("maru-session: attach resize 실패: {e:#}");
        }
    }

    let Some(mut rx) = replay(&mut wr, &session, conn, false).await else {
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
            chunk = rx.recv() => {
                let chunk = match chunk {
                    Ok(bytes) => Ok(bytes),
                    Err(RecvError::Lagged(_)) => Err(()),
                    Err(RecvError::Closed) => break,
                };
                if !forward(&mut wr, &session, conn, &mut rx, &mut resyncs, chunk).await {
                    break;
                }
            },

            incoming = in_rx.recv() => match incoming {
                Some((TAG_BINARY, bytes)) => {
                    let s = session.clone();
                    let _ = tokio::task::spawn_blocking(move || s.write(&bytes)).await;
                }
                Some((TAG_TEXT, text)) => {
                    if let Ok(v) = serde_json::from_slice::<Value>(&text)
                        && v["type"] == "resize"
                        && session.is_primary(conn)
                        && let (Some(c @ 1..), Some(r @ 1..)) = (dim(&v["cols"]), dim(&v["rows"]))
                    {
                        let _ = session.resize(c, r);
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
                while flushed {
                    let chunk = match rx.try_recv() {
                        Ok(bytes) => Ok(bytes),
                        Err(TryRecvError::Lagged(_)) => Err(()),
                        Err(_) => break,
                    };
                    flushed = forward(&mut wr, &session, conn, &mut rx, &mut resyncs, chunk).await;
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
    rx: &mut Receiver<Chunk>,
    resyncs: &mut u32,
    chunk: Result<Chunk, ()>,
) -> bool {
    match chunk {
        Ok(first) => {
            // 청크마다 프레임을 쓰면 대량 출력에서 쉬지 않고 읽는 클라이언트도 방송 버퍼에서 밀려난다.
            let mut batch = first.to_vec();
            let mut lagged = false;
            while batch.len() < MAX_BATCH {
                match rx.try_recv() {
                    Ok(more) => batch.extend_from_slice(&more),
                    Err(TryRecvError::Lagged(_)) => {
                        lagged = true;
                        break;
                    }
                    Err(_) => break,
                }
            }
            if write_frame(wr, TAG_BINARY, &batch).await.is_err() {
                return false;
            }
            if !lagged {
                return true;
            }
            match resync(wr, session, conn, resyncs).await {
                Some(new_rx) => {
                    *rx = new_rx;
                    true
                }
                None => false,
            }
        }
        Err(()) => match resync(wr, session, conn, resyncs).await {
            Some(new_rx) => {
                *rx = new_rx;
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
) -> Option<Receiver<Chunk>> {
    let (payload, st, rx) = match session.subscribe_with_replay() {
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
    Some(rx)
}

async fn resync(
    wr: &mut OwnedWriteHalf,
    session: &Session,
    conn: u64,
    count: &mut u32,
) -> Option<Receiver<Chunk>> {
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
