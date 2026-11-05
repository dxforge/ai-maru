//! `input` 요청의 `paste` 가 pty 에 쓰는 바이트.

const START: &[u8] = b"\x1b[200~";
const END: &[u8] = b"\x1b[201~";

pub fn paste_bytes(text: &str, bracketed: bool) -> Vec<u8> {
    let body = text.trim_end_matches('\r');
    let key = body.is_empty()
        || body
            .bytes()
            .any(|b| b.is_ascii_control() && b != b'\n' && b != b'\t');
    if key || !bracketed {
        return text.as_bytes().to_vec();
    }
    let mut out = Vec::with_capacity(text.len() + START.len() + END.len());
    out.extend_from_slice(START);
    out.extend_from_slice(body.as_bytes());
    out.extend_from_slice(END);
    out.extend_from_slice(&text.as_bytes()[body.len()..]);
    out
}

#[cfg(test)]
mod tests {
    use super::paste_bytes;

    fn wrapped(body: &str, tail: &str) -> Vec<u8> {
        format!("\x1b[200~{body}\x1b[201~{tail}").into_bytes()
    }

    #[test]
    fn the_body_is_wrapped_and_the_trailing_carriage_returns_follow_it() {
        assert_eq!(paste_bytes("ls", true), wrapped("ls", ""));
        assert_eq!(paste_bytes("ls\r", true), wrapped("ls", "\r"));
        assert_eq!(paste_bytes("ls\r\r", true), wrapped("ls", "\r\r"));
        assert_eq!(paste_bytes("한글 a\r", true), wrapped("한글 a", "\r"));
    }

    #[test]
    fn newlines_and_tabs_stay_in_the_body() {
        assert_eq!(paste_bytes("a\nb\tc\r", true), wrapped("a\nb\tc", "\r"));
    }

    #[test]
    fn keys_and_text_mixed_with_keys_are_written_as_they_are() {
        for text in [
            "\r", "\r\r", "\x1b", "\x1b[A", "\x03", "a\x7f", "x\x1b\r", "\x00a", "a\rb\r",
        ] {
            assert_eq!(paste_bytes(text, true), text.as_bytes(), "{text:?}");
        }
    }

    #[test]
    fn without_bracketed_paste_the_text_is_written_as_it_is() {
        for text in ["ls", "ls\r", "a\nb\r\r", "\x03"] {
            assert_eq!(paste_bytes(text, false), text.as_bytes(), "{text:?}");
        }
    }

    #[test]
    fn empty_text_is_empty() {
        assert_eq!(paste_bytes("", true), b"");
    }
}
