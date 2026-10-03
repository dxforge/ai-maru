//! 태그는 WebSocket 메시지 타입에 1:1 로 대응한다 — 데몬이 태그만 바꿔 WS 로 중계하게.

use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const TAG_TEXT: u8 = 1;
pub const TAG_BINARY: u8 = 2;

/// 손상된 길이 필드가 거대한 할당을 부르지 않게.
const MAX_FRAME_LEN: u32 = 16 * 1024 * 1024;

pub fn encode(tag: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(5 + payload.len());
    out.push(tag);
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

pub async fn write_frame<W: AsyncWrite + Unpin>(
    w: &mut W,
    tag: u8,
    payload: &[u8],
) -> std::io::Result<()> {
    w.write_all(&encode(tag, payload)).await?;
    w.flush().await
}

pub async fn write_json<W: AsyncWrite + Unpin>(w: &mut W, v: &Value) -> std::io::Result<()> {
    write_frame(w, TAG_TEXT, v.to_string().as_bytes()).await
}

pub fn error(code: &str, message: &str) -> Value {
    json!({ "type": "error", "code": code, "message": message })
}

pub fn decode_header(head: &[u8; 5]) -> std::io::Result<(u8, usize)> {
    let len = u32::from_be_bytes([head[1], head[2], head[3], head[4]]);
    if len > MAX_FRAME_LEN {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("프레임 길이 {len} 이 한도 {MAX_FRAME_LEN} 을 넘는다"),
        ));
    }
    Ok((head[0], len as usize))
}

/// 취소 안전하지 않다 — `select!` 에서 지면 읽은 바이트가 사라져 프레임 경계가 어긋난다.
/// 전용 태스크에서 돌릴 것.
pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<Option<(u8, Vec<u8>)>> {
    let mut head = [0u8; 5];
    let mut got = 0;
    while got < head.len() {
        match r.read(&mut head[got..]).await? {
            0 if got == 0 => return Ok(None),
            0 => return Err(std::io::ErrorKind::UnexpectedEof.into()),
            n => got += n,
        }
    }
    let (tag, len) = decode_header(&head)?;
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload).await?;
    Ok(Some((tag, payload)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_frame_split_inside_its_header_is_reassembled() {
        let whole = encode(TAG_BINARY, &[7u8; 300]);
        let (head, tail) = whole.split_at(3);
        let mut r = AsyncReadExt::chain(
            std::io::Cursor::new(head.to_vec()),
            std::io::Cursor::new(tail.to_vec()),
        );
        let (tag, payload) = read_frame(&mut r).await.unwrap().unwrap();
        assert_eq!((tag, payload.len()), (TAG_BINARY, 300));
        assert!(read_frame(&mut r).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn eof_inside_a_frame_is_an_error() {
        let whole = encode(TAG_TEXT, b"{}");
        let mut r = std::io::Cursor::new(whole[..4].to_vec());
        let err = read_frame(&mut r).await.unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::UnexpectedEof);
    }

    #[tokio::test]
    async fn an_oversized_length_is_rejected_before_allocating() {
        let mut buf = vec![TAG_BINARY];
        buf.extend_from_slice(&(MAX_FRAME_LEN + 1).to_be_bytes());
        let err = read_frame(&mut std::io::Cursor::new(buf))
            .await
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }
}
