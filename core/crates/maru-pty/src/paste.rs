//! `input` 요청의 `paste` 가 pty 에 쓰는 바이트.

const START: &[u8] = b"\x1b[200~";
const END: &[u8] = b"\x1b[201~";

/// 본문이 이 길이(바이트) 이상이면 감싼다. claude 2.1.318 은 감싸지 않은 입력이 한 번에 64바이트 이상 오면
/// 붙여넣기로 받는다. 그때 끝의 `\r` 은 Enter 가 아니라 줄바꿈으로 들어간다(실측: 끝의 `\r` 을 합쳐 63바이트는
/// 전송되었고 64바이트는 전송되지 않았다). 그 절반으로 두어, 키(`2`·`:wq`·`\x1b[A`)는 감싸지 않는다.
const LONG: usize = 32;

pub fn paste_bytes(text: &str, bracketed: bool) -> Vec<u8> {
    let body = text.strip_suffix('\r').unwrap_or(text);
    let paste = bracketed && (body.contains('\n') || body.len() >= LONG);
    if !paste {
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
    use super::{LONG, paste_bytes};

    fn wrapped(body: &str, tail: &str) -> Vec<u8> {
        format!("\x1b[200~{body}\x1b[201~{tail}").into_bytes()
    }

    fn long(prefix: &str) -> String {
        let mut s = prefix.to_owned();
        while s.len() < LONG {
            s.push('x');
        }
        s
    }

    #[test]
    fn a_long_body_is_wrapped_and_one_trailing_carriage_return_follows_it() {
        let body = long("ls ");
        assert_eq!(paste_bytes(&body, true), wrapped(&body, ""));
        assert_eq!(
            paste_bytes(&format!("{body}\r"), true),
            wrapped(&body, "\r")
        );
        assert_eq!(
            paste_bytes(&format!("{body}\r\r"), true),
            wrapped(&format!("{body}\r"), "\r")
        );
        let korean = "한글".repeat(LONG / 6 + 1);
        assert_eq!(
            paste_bytes(&format!("{korean}\r"), true),
            wrapped(&korean, "\r")
        );
    }

    #[test]
    fn a_body_with_a_newline_is_wrapped_however_short() {
        assert_eq!(paste_bytes("a\nb\r", true), wrapped("a\nb", "\r"));
        assert_eq!(paste_bytes("a\r\nb\r", true), wrapped("a\r\nb", "\r"));
        assert_eq!(paste_bytes("a\n", true), wrapped("a\n", ""));
    }

    #[test]
    fn a_long_body_with_keys_in_it_is_wrapped() {
        let body = long("a\x1b[A\x03\tb");
        assert_eq!(
            paste_bytes(&format!("{body}\r"), true),
            wrapped(&body, "\r")
        );
    }

    #[test]
    fn a_short_body_without_a_newline_is_written_as_keys() {
        let below = "y".repeat(LONG - 1);
        for text in [
            "2",
            "y",
            ":wq\r",
            "\t",
            "ls\r",
            "\r",
            "\r\r",
            "\x1b",
            "\x1b[A",
            "\x03",
            "a\rb\r",
            &below,
            &format!("{below}\r"),
        ] {
            assert_eq!(paste_bytes(text, true), text.as_bytes(), "{text:?}");
        }
    }

    #[test]
    fn without_bracketed_paste_the_text_is_written_as_it_is() {
        let body = long("ls ");
        for text in ["ls\r", "a\nb\r\r", &format!("{body}\r")] {
            assert_eq!(paste_bytes(text, false), text.as_bytes(), "{text:?}");
        }
    }

    #[test]
    fn empty_text_is_empty() {
        assert_eq!(paste_bytes("", true), b"");
    }
}
