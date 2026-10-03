mod ffi;

use anyhow::{Result, bail};
use std::ffi::c_void;
use std::ptr;

const SCROLLBACK_MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_DIM: u16 = 4096;

fn check_size(cols: u16, rows: u16) -> Result<()> {
    if !(1..=MAX_DIM).contains(&cols) || !(1..=MAX_DIM).contains(&rows) {
        bail!("cols/rows 는 1~{MAX_DIM} 이어야 한다 ({cols}x{rows})");
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VtFormat {
    Plain,
    Vt,
}

pub struct VtTerminal {
    raw: ffi::GhosttyTerminal,
}

// SAFETY: 헤더가 요구하는 건 접근 직렬화뿐이고(스레드 affinity 없음) 기본 할당자는 다른 스레드의
// free 를 허용한다. 직렬화는 `Sync` 를 구현하지 않는 것으로 맡긴다.
unsafe impl Send for VtTerminal {}

impl VtTerminal {
    pub fn new(cols: u16, rows: u16) -> Result<Self> {
        check_size(cols, rows)?;
        let mut raw: ffi::GhosttyTerminal = ptr::null_mut();
        // SAFETY: NULL allocator 는 기본 할당자다. out 은 지역 포인터다.
        let rc = unsafe { ffi::ghostty_terminal_new(ptr::null(), &mut raw, cols, rows) };
        if rc != ffi::GHOSTTY_SUCCESS || raw.is_null() {
            bail!("ghostty_terminal_new rc={rc}");
        }
        let t = VtTerminal { raw };
        // SAFETY: 이 옵션의 입력 타입은 `size_t*` 다. 포인터는 호출 동안만 읽힌다.
        let rc = unsafe {
            ffi::ghostty_terminal_set(
                t.raw,
                ffi::GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES,
                &SCROLLBACK_MAX_BYTES as *const usize as *const c_void,
            )
        };
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_terminal_set(SCROLLBACK_MAX_BYTES) rc={rc}");
        }
        Ok(t)
    }

    pub fn write(&mut self, bytes: &[u8]) {
        // SAFETY: (ptr, len) 은 빌린 슬라이스 그대로이고 `&mut self` 가 접근을 직렬화한다.
        unsafe { ffi::ghostty_terminal_vt_write(self.raw, bytes.as_ptr(), bytes.len()) };
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        check_size(cols, rows)?;
        // SAFETY: 인자는 모두 스칼라다. 헤드리스라 셀 픽셀 크기는 0 이다.
        let rc = unsafe { ffi::ghostty_terminal_resize(self.raw, cols, rows, 0, 0) };
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_terminal_resize rc={rc}");
        }
        Ok(())
    }

    pub fn cursor(&self) -> Result<(u16, u16)> {
        let mut x: u16 = 0;
        let mut y: u16 = 0;
        for (data, out) in [
            (ffi::GHOSTTY_TERMINAL_DATA_CURSOR_X, &mut x),
            (ffi::GHOSTTY_TERMINAL_DATA_CURSOR_Y, &mut y),
        ] {
            // SAFETY: 두 데이터의 출력 타입은 `uint16_t*` 다.
            let rc = unsafe {
                ffi::ghostty_terminal_get(self.raw, data, out as *mut u16 as *mut c_void)
            };
            if rc != ffi::GHOSTTY_SUCCESS {
                bail!("ghostty_terminal_get(data={data}) rc={rc}");
            }
        }
        Ok((x, y))
    }

    fn scrollbar(&self) -> Result<ffi::GhosttyTerminalScrollbar> {
        let mut bar = ffi::GhosttyTerminalScrollbar::default();
        // SAFETY: 이 데이터의 출력 타입은 `GhosttyTerminalScrollbar*` 다.
        let rc = unsafe {
            ffi::ghostty_terminal_get(
                self.raw,
                ffi::GHOSTTY_TERMINAL_DATA_SCROLLBAR,
                &mut bar as *mut _ as *mut c_void,
            )
        };
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_terminal_get(SCROLLBAR) rc={rc}");
        }
        Ok(bar)
    }

    /// 클라이언트가 이만큼 빈 행을 더해야 뷰포트 원점이 서버와 같아진다.
    /// 개행으로 행을 세는 건 `unwrap: false` 라 그리드 행 하나가 페이로드 줄 하나여서다.
    /// 활성 영역 높이가 하한인 건 클라이언트 그리드가 늘 `rows` 행이어서다.
    pub fn trailing_blank_rows(&self, payload: &[u8]) -> Result<u64> {
        let emitted = if payload.is_empty() {
            0
        } else {
            payload.iter().filter(|b| **b == b'\n').count() as u64 + 1
        };
        let bar = self.scrollbar()?;
        Ok(bar.total.saturating_sub(emitted.max(bar.len)))
    }

    pub fn format(&self, fmt: VtFormat) -> Result<Vec<u8>> {
        let zero_ref = ffi::GhosttyGridRef {
            size: size_of::<ffi::GhosttyGridRef>(),
            node: ptr::null_mut(),
            x: 0,
            y: 0,
        };
        let mut sel = ffi::GhosttySelection {
            size: size_of::<ffi::GhosttySelection>(),
            start: zero_ref,
            end: zero_ref,
            rectangle: false,
        };
        // 내용이 있는지만 묻는다. 이 범위를 포맷에 넘기면 머리의 빈 행과 선행 공백이 빠져
        // 커서와 어긋난다.
        // SAFETY: out 은 `size` 를 채운 지역 sized struct 다.
        let rc = unsafe { ffi::ghostty_terminal_select_all(self.raw, &mut sel) };
        if rc == ffi::GHOSTTY_NO_VALUE {
            return Ok(Vec::new());
        }
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_terminal_select_all rc={rc}");
        }

        let vt = fmt == VtFormat::Vt;
        let opts = ffi::GhosttyFormatterTerminalOptions {
            size: size_of::<ffi::GhosttyFormatterTerminalOptions>(),
            emit: if vt {
                ffi::GHOSTTY_FORMATTER_FORMAT_VT
            } else {
                ffi::GHOSTTY_FORMATTER_FORMAT_PLAIN
            },
            unwrap: false,
            trim: true,
            extra: ffi::GhosttyFormatterTerminalExtra {
                size: size_of::<ffi::GhosttyFormatterTerminalExtra>(),
                // palette 는 바꾼 슬롯이 없어도 OSC 4 를 256 개 싣는다.
                // tabstops 는 커서를 옮겨 가며 세워서 뒤 내용이 첫 행 중간부터 찍힌다.
                // pwd·keyboard·kitty_keyboard 는 실행 중인 프로그램이 소유할 입력 상태다.
                scrolling_region: vt,
                modes: vt,
                screen: ffi::GhosttyFormatterScreenExtra {
                    size: size_of::<ffi::GhosttyFormatterScreenExtra>(),
                    cursor: vt,
                    style: vt,
                    hyperlink: vt,
                    protection: vt,
                    charsets: vt,
                    ..Default::default()
                },
                ..Default::default()
            },
            selection: ptr::null(),
        };

        let mut raw_fmt: ffi::GhosttyFormatter = ptr::null_mut();
        // SAFETY: `opts` 와 그 안의 sized struct 는 각자 `size` 를 채웠다. selection 은 NULL(화면 전체)이다.
        let rc = unsafe {
            ffi::ghostty_formatter_terminal_new(ptr::null(), &mut raw_fmt, self.raw, opts)
        };
        if rc != ffi::GHOSTTY_SUCCESS || raw_fmt.is_null() {
            bail!("ghostty_formatter_terminal_new rc={rc}");
        }
        let formatter = FormatterHandle(raw_fmt);

        let mut out_ptr: *mut u8 = ptr::null_mut();
        let mut out_len: usize = 0;
        // SAFETY: 빌린 터미널이 formatter 보다 오래 산다.
        let rc = unsafe {
            ffi::ghostty_formatter_format_alloc(
                formatter.0,
                ptr::null(),
                &mut out_ptr,
                &mut out_len,
            )
        };
        if rc == ffi::GHOSTTY_NO_VALUE {
            return Ok(Vec::new());
        }
        if rc != ffi::GHOSTTY_SUCCESS || out_ptr.is_null() {
            bail!("ghostty_formatter_format_alloc rc={rc}");
        }
        // SAFETY: 성공 시 (out_ptr, out_len) 은 유효하다. 복사한 뒤 같은 할당자·길이로 해제한다.
        let raw = unsafe { std::slice::from_raw_parts(out_ptr, out_len) };
        let mut bytes = if vt {
            keep_replayable_modes(raw)
        } else {
            raw.to_vec()
        };
        unsafe { ffi::ghostty_free(ptr::null(), out_ptr, out_len) };
        if !vt {
            return Ok(bytes);
        }

        // ghostty 가 DECSTBM 을 커서 CUP 뒤에 내보내는데 DECSTBM 은 커서를 홈으로 보낸다.
        if !bytes.is_empty() {
            let (x, y) = self.cursor()?;
            bytes.extend_from_slice(format!("\x1b[{};{}H", y + 1, x + 1).as_bytes());
        }
        Ok(bytes)
    }
}

/// 복원했을 때 터미널이 스스로 pty 로 바이트를 흘리는 모드는 뺀다(`?1004` focus, 마우스).
/// `?2004` 는 아무것도 안 보내고, 꺼 두면 여러 줄 붙여넣기가 첫 줄에서 제출된다.
/// `?6`(DECOM)은 끝의 CUP 을 마진 기준으로 바꾸고, `?5`(반전)는 틀리면 화면이 반전된 채 남아 뺀다.
/// 모르는 모드는 프로그램의 다음 리페인트가 덮으므로 allowlist 다.
fn keep_replayable_modes(bytes: &[u8]) -> Vec<u8> {
    const KEEP: &[&[u8]] = &[b"1049", b"1047", b"47", b"25", b"7", b"2004"];

    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match dec_mode_seq(&bytes[i..]) {
            Some((len, params, terminator)) => {
                let kept: Vec<&[u8]> = params.into_iter().filter(|p| KEEP.contains(p)).collect();
                if !kept.is_empty() {
                    out.extend_from_slice(b"\x1b[?");
                    out.extend_from_slice(&kept.join(&b';'));
                    out.push(terminator);
                }
                i += len;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    out
}

fn dec_mode_seq(bytes: &[u8]) -> Option<(usize, Vec<&[u8]>, u8)> {
    let rest = bytes.strip_prefix(b"\x1b[?")?;
    let body_len = rest
        .iter()
        .take_while(|b| b.is_ascii_digit() || **b == b';')
        .count();
    let terminator = *rest.get(body_len)?;
    if terminator != b'h' && terminator != b'l' {
        return None;
    }
    let params: Vec<&[u8]> = rest[..body_len].split(|b| *b == b';').collect();
    if params.iter().any(|p| p.is_empty()) {
        return None;
    }
    Some((3 + body_len + 1, params, terminator))
}

struct FormatterHandle(ffi::GhosttyFormatter);

impl Drop for FormatterHandle {
    fn drop(&mut self) {
        unsafe { ffi::ghostty_formatter_free(self.0) };
    }
}

impl Drop for VtTerminal {
    fn drop(&mut self) {
        unsafe { ffi::ghostty_terminal_free(self.raw) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn term() -> VtTerminal {
        VtTerminal::new(80, 24).unwrap()
    }

    fn vt(t: &VtTerminal) -> String {
        String::from_utf8_lossy(&t.format(VtFormat::Vt).unwrap()).into_owned()
    }

    fn plain(t: &VtTerminal) -> String {
        String::from_utf8(t.format(VtFormat::Plain).unwrap()).unwrap()
    }

    #[test]
    fn utf8_split_across_writes_is_reassembled() {
        let mut t = term();
        let s = "한글 테스트".as_bytes();
        t.write(&s[..4]);
        t.write(&s[4..]);
        assert!(plain(&t).contains("한글 테스트"));
    }

    #[test]
    fn format_includes_scrollback_beyond_the_viewport() {
        let mut t = term();
        for i in 0..200 {
            t.write(format!("line{i}\r\n").as_bytes());
        }
        let out = plain(&t);
        assert!(out.contains("line0") && out.contains("line199"));
    }

    #[test]
    fn plain_has_no_escapes() {
        let mut t = term();
        t.write(b"\x1b[31mred\x1b[0m\r\n\x1b[2;3H");
        let out = plain(&t);
        assert!(out.contains("red") && !out.contains('\x1b'), "{out:?}");
    }

    #[test]
    fn vt_does_not_carry_the_palette() {
        let mut t = term();
        t.write(b"hello");
        assert!(!vt(&t).contains("\x1b]4;"));
    }

    #[test]
    fn vt_ends_with_the_cursor_even_after_a_scroll_region() {
        let mut t = term();
        t.write(b"line1\r\nline2\r\n\x1b[5;20r\x1b[7;4H");
        let s = vt(&t);
        assert!(s.contains("\x1b[5;20r"), "{s:?}");
        assert!(s.ends_with("\x1b[7;4H"), "{s:?}");
    }

    #[test]
    fn cursor_stays_active_area_relative_after_scrolling() {
        let mut t = term();
        for i in 0..200 {
            t.write(format!("line{i}\r\n").as_bytes());
        }
        t.write(b"\x1b[3;5H");
        assert_eq!(t.cursor().unwrap(), (4, 2));
    }

    #[test]
    fn payload_rows_plus_trailing_blanks_cover_the_grid() {
        for (extra, want_blanks) in [(0usize, 1u64), (1, 2), (3, 4)] {
            let mut t = term();
            for i in 0..100 {
                t.write(format!("line{i}\r\n").as_bytes());
            }
            if extra > 0 {
                t.write("\n".repeat(extra).as_bytes());
                t.write(format!("\x1b[{extra}A").as_bytes());
            }
            let out = t.format(VtFormat::Plain).unwrap();
            let blanks = t.trailing_blank_rows(&out).unwrap();
            assert_eq!(blanks, want_blanks, "extra={extra}");
            let emitted = out.iter().filter(|b| **b == b'\n').count() as u64 + 1;
            assert_eq!(emitted + blanks, t.scrollbar().unwrap().total);
        }
    }

    #[test]
    fn short_sessions_report_no_trailing_blanks() {
        let mut t = term();
        assert_eq!(t.trailing_blank_rows(&[]).unwrap(), 0);
        t.write(b"a\r\nb\r\n");
        let out = t.format(VtFormat::Plain).unwrap();
        assert_eq!(t.trailing_blank_rows(&out).unwrap(), 0);
    }

    #[test]
    fn vt_restores_the_alternate_screen_before_its_content() {
        let mut t = term();
        t.write(b"$ vim\r\n\x1b[?1049h\x1b[H~ TUI ~");
        let s = vt(&t);
        assert!(
            s.starts_with("\x1b[?1049h") && s.contains("~ TUI ~"),
            "{s:?}"
        );
    }

    // 재생본을 다시 포맷해 비교하면 양쪽이 같은 트림을 타서 못 잡는다.
    #[test]
    fn vt_keeps_leading_blank_rows_and_spaces() {
        for lead in [0usize, 1, 3] {
            let mut t = term();
            t.write("\r\n".repeat(lead).as_bytes());
            t.write(b"  HEAD\r\nsecond");
            let s = vt(&t);
            let mut body = s.as_str();
            while let Some((len, _, _)) = dec_mode_seq(body.as_bytes()) {
                body = &body[len..];
            }
            assert!(
                body.starts_with(&format!("{}  HEAD", "\r\n".repeat(lead))),
                "lead={lead}: {s:?}"
            );
        }
    }

    #[test]
    fn vt_drops_modes_that_would_make_the_terminal_send_bytes() {
        let mut t = term();
        t.write(b"\x1b[?1h\x1b[?1000h\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b[?2004h\x1b[?25l");
        t.write(b"prompt> ");
        let s = vt(&t);
        for mode in ["?1h", "?1000h", "?1003h", "?1006h", "?1004h"] {
            assert!(!s.contains(&format!("\x1b[{mode}")), "{mode}: {s:?}");
        }
        assert!(
            s.contains("\x1b[?2004h") && s.contains("\x1b[?25l"),
            "{s:?}"
        );
    }

    #[test]
    fn replaying_the_payload_reproduces_the_cursor_under_origin_mode() {
        let mut t = term();
        t.write(b"\x1b[5;25r\x1b[?6hbody\x1b[7;10H");
        let want = t.cursor().unwrap();
        let mut replayed = term();
        replayed.write(&t.format(VtFormat::Vt).unwrap());
        assert_eq!(replayed.cursor().unwrap(), want);
    }

    #[test]
    fn keep_replayable_modes_splits_combined_params() {
        assert_eq!(
            keep_replayable_modes(b"\x1b[?1;1049;1004h x"),
            b"\x1b[?1049h x"
        );
        assert_eq!(
            keep_replayable_modes(b"\x1b[?1004;1049;2004h x"),
            b"\x1b[?1049;2004h x"
        );
        assert_eq!(keep_replayable_modes(b"\x1b[?1;1004h x"), b" x");
        assert_eq!(keep_replayable_modes(b"\x1b[?h x"), b"\x1b[?h x");
        assert_eq!(keep_replayable_modes(b"\x1b[2004h x"), b"\x1b[2004h x");
    }
}
