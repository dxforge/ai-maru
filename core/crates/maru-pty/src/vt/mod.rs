mod ffi;

use anyhow::{Result, bail};
use std::ffi::c_void;
use std::ptr;

const SCROLLBACK_MAX_BYTES: usize = 4 * 1024 * 1024;
/// 끝나지 않은 시퀀스를 이만큼 들고 있어야 그 사이에도 스냅샷을 뜰 수 있다.
const CONTINUATION_MAX_BYTES: usize = 64 * 1024;
const MAX_DIM: u16 = 4096;

fn check_size(cols: u16, rows: u16) -> Result<()> {
    if !(1..=MAX_DIM).contains(&cols) || !(1..=MAX_DIM).contains(&rows) {
        bail!("cols/rows must be 1-{MAX_DIM} ({cols}x{rows})");
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VtFormat {
    Plain,
    PlainUnwrapped,
    Vt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgramStatusState {
    Idle,
    Working,
    Done,
    Blocked,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgramStatusKind {
    Permission,
    Question,
    Auth,
}

/// OSC 7501 보고 하나. `clear` 이면 `state` 는 뜻이 없다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramStatusReport {
    pub clear: bool,
    pub state: ProgramStatusState,
    pub kind: Option<ProgramStatusKind>,
    pub progress: Option<u8>,
    pub id: String,
    pub app: String,
    pub title: String,
    pub message: String,
}

/// 셸 cwd 를 바꾸는 것. 한 `write` 에 OSC 7 과 RIS 가 섞여 와도 온 순서대로 반영하려고 한 목록에 둔다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CwdEvent {
    /// OSC 7 의 내용. ghostty 가 저장한 해석하지 않은 바이트 그대로이고, 빈 OSC 7 이면 비어 있다.
    Report(Vec<u8>),
    /// RIS. ghostty 는 pwd 를 지우고 pwd 콜백은 부르지 않는다.
    Reset,
}

/// 셸이 OSC 133 으로 알린 명령의 단계. 입력 시작(B) 같은 나머지 단계는 쓰지 않아 싣지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandEvent {
    /// A — 프롬프트를 그리기 시작했다. 같은 프롬프트를 다시 그릴 때도 온다.
    PromptStart,
    /// C — 명령이 돌기 시작했다. 셸이 명령 텍스트를 싣지 않았거나 지우고 나니 비었으면 None 이다.
    Start(Option<String>),
    /// D — 명령이 끝났다. 셸이 종료 코드를 싣지 않았으면 None 이다.
    End(Option<i32>),
}

/// ghostty 콜백이 `write` 동안 쌓은 것. 콜백은 screen 락 안에서 동기로 불리므로 여기에 넣기만
/// 하고, 처리는 `take_events` 로 꺼낸 쪽이 한다.
#[derive(Debug, Default)]
pub struct VtEvents {
    pub reports: Vec<ProgramStatusReport>,
    pub pty_replies: Vec<Vec<u8>>,
    pub cwd: Vec<CwdEvent>,
    pub commands: Vec<CommandEvent>,
    /// OSC 0/2 나 RIS 로 제목이 바뀌었을 수 있다. 값은 `VtTerminal::title` 로 읽는다.
    pub title_changed: bool,
}

/// OSC 7 의 `file:///path` 에서 경로를 꺼내 percent 디코딩한다. 호스트가 실린 것은 ssh 로 붙은 다른 머신의
/// 셸이 보냈을 수 있어 버린다. 이 머신의 호스트 이름과 견주지 않는 것은, 셸이 뜬 뒤 호스트 이름이 바뀌면 이
/// 머신의 것까지 버리게 되어서다. `%` 뒤가 16진수 두 자리가 아니거나 디코딩한 결과가 UTF-8 이 아니면 버린다.
pub fn osc7_path(raw: &[u8]) -> Option<String> {
    let path = raw.strip_prefix(b"file://")?;
    if path.first() != Some(&b'/') {
        return None;
    }
    let mut out = Vec::with_capacity(path.len());
    let mut i = 0;
    while i < path.len() {
        if path[i] != b'%' {
            out.push(path[i]);
            i += 1;
            continue;
        }
        let hex = path.get(i + 1..i + 3)?;
        if !hex.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        out.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
        i += 3;
    }
    String::from_utf8(out).ok()
}

pub struct VtTerminal {
    raw: ffi::GhosttyTerminal,
    /// ghostty 가 userdata 로 들고 있는 주소라 `VtTerminal` 이 옮겨져도 바뀌지 않아야 한다.
    /// `Drop` 이 터미널을 먼저 해제하므로 콜백이 해제된 버퍼를 만지지 않는다.
    events: Box<VtEvents>,
}

unsafe extern "C" fn on_write_pty(
    _terminal: ffi::GhosttyTerminal,
    userdata: *mut c_void,
    data: *const u8,
    len: usize,
) {
    // SAFETY: userdata 는 `new` 가 넣은 `Box<VtEvents>` 의 주소이고, 콜백은 `write` 의 `&mut self`
    // 안에서만 불린다. (data, len) 은 호출 동안 유효하다.
    let events = unsafe { &mut *(userdata as *mut VtEvents) };
    let data = unsafe { std::slice::from_raw_parts(data, len) };
    // DSR·DECRQM·XTGETTCAP 같은 다른 질의는 renderer 의 xterm.js 가 이미 답한다. 둘이 답하면 셸
    // 입력이 깨진다.
    if data.starts_with(b"\x1b]7501;") {
        events.pty_replies.push(data.to_vec());
    }
}

unsafe extern "C" fn on_program_status(
    _terminal: ffi::GhosttyTerminal,
    userdata: *mut c_void,
    report: *const ffi::GhosttyTerminalProgramStatus,
) {
    // SAFETY: userdata 는 `on_write_pty` 와 같다. report 와 그 문자열은 호출 동안 유효하다.
    let events = unsafe { &mut *(userdata as *mut VtEvents) };
    let report = unsafe { &*report };
    if report.size < size_of::<ffi::GhosttyTerminalProgramStatus>() {
        return;
    }
    let text = |s: ffi::GhosttyString| -> String {
        // SAFETY: 라이브러리가 만든 빈 문자열도 NULL 이 아닌 포인터를 가진다(`types.h`).
        let bytes = unsafe { std::slice::from_raw_parts(s.ptr, s.len) };
        String::from_utf8_lossy(bytes).into_owned()
    };
    let (clear, state) = match report.state {
        s if s == ffi::GHOSTTY_PROGRAM_STATUS_STATE_IDLE => (false, ProgramStatusState::Idle),
        s if s == ffi::GHOSTTY_PROGRAM_STATUS_STATE_WORKING => (false, ProgramStatusState::Working),
        s if s == ffi::GHOSTTY_PROGRAM_STATUS_STATE_DONE => (false, ProgramStatusState::Done),
        s if s == ffi::GHOSTTY_PROGRAM_STATUS_STATE_BLOCKED => (false, ProgramStatusState::Blocked),
        s if s == ffi::GHOSTTY_PROGRAM_STATUS_STATE_ERROR => (false, ProgramStatusState::Error),
        s if s == ffi::GHOSTTY_PROGRAM_STATUS_STATE_CLEAR => (true, ProgramStatusState::Idle),
        _ => return,
    };
    let kind = match report.kind {
        k if k == ffi::GHOSTTY_PROGRAM_STATUS_KIND_PERMISSION => {
            Some(ProgramStatusKind::Permission)
        }
        k if k == ffi::GHOSTTY_PROGRAM_STATUS_KIND_QUESTION => Some(ProgramStatusKind::Question),
        k if k == ffi::GHOSTTY_PROGRAM_STATUS_KIND_AUTH => Some(ProgramStatusKind::Auth),
        _ => None,
    };
    events.reports.push(ProgramStatusReport {
        clear,
        state,
        kind,
        progress: u8::try_from(report.progress).ok().filter(|p| *p <= 100),
        id: text(report.id),
        app: text(report.app),
        title: text(report.title),
        message: text(report.message),
    });
}

unsafe extern "C" fn on_semantic_prompt(
    _terminal: ffi::GhosttyTerminal,
    userdata: *mut c_void,
    event: *const ffi::GhosttyTerminalSemanticPrompt,
) {
    // SAFETY: userdata 는 `on_write_pty` 와 같다. event 와 그 문자열은 호출 동안 유효하다.
    let events = unsafe { &mut *(userdata as *mut VtEvents) };
    let event = unsafe { &*event };
    if event.size < size_of::<ffi::GhosttyTerminalSemanticPrompt>() {
        return;
    }
    let command = match event.kind {
        k if k == ffi::GHOSTTY_SEMANTIC_PROMPT_PROMPT_START => CommandEvent::PromptStart,
        k if k == ffi::GHOSTTY_SEMANTIC_PROMPT_OUTPUT_START => {
            // SAFETY: 라이브러리가 만든 빈 문자열도 NULL 이 아닌 포인터를 가진다(`types.h`).
            let bytes = unsafe { std::slice::from_raw_parts(event.command.ptr, event.command.len) };
            CommandEvent::Start(command_text(bytes))
        }
        k if k == ffi::GHOSTTY_SEMANTIC_PROMPT_COMMAND_END => {
            CommandEvent::End(event.has_exit_code.then_some(event.exit_code))
        }
        _ => return,
    };
    events.commands.push(command);
}

/// libghostty-vt 는 `cmdline_url` 의 `%XX` 를 푼 바이트를 UTF-8 인지도, 제어 문자가 섞였는지도 보지 않고 넘긴다.
/// 이 텍스트는 사이드바·헤더·확인 창에 한 줄로 쓰이므로 제어 문자(C0·DEL·C1)는 지운다. 줄바꿈·탭은 공백으로
/// 바꾼다 — 지우면 여러 줄로 친 명령의 앞뒤 줄이 붙는다.
pub fn command_text(bytes: &[u8]) -> Option<String> {
    let text: String = String::from_utf8_lossy(bytes)
        .chars()
        .filter_map(|c| match c {
            '\n' | '\t' => Some(' '),
            c if c.is_control() => None,
            c => Some(c),
        })
        .collect();
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

unsafe extern "C" fn on_title_changed(_terminal: ffi::GhosttyTerminal, userdata: *mut c_void) {
    // SAFETY: userdata 는 `on_write_pty` 와 같다.
    let events = unsafe { &mut *(userdata as *mut VtEvents) };
    events.title_changed = true;
}

unsafe extern "C" fn on_pwd_changed(terminal: ffi::GhosttyTerminal, userdata: *mut c_void) {
    // SAFETY: userdata 는 `on_write_pty` 와 같다. 헤더는 이 콜백 안에서 `DATA_PWD` 를 읽으라고 한다.
    let events = unsafe { &mut *(userdata as *mut VtEvents) };
    let pwd = unsafe { get_string(terminal, ffi::GHOSTTY_TERMINAL_DATA_PWD) };
    events.cwd.push(CwdEvent::Report(pwd));
}

unsafe extern "C" fn on_reset(_terminal: ffi::GhosttyTerminal, userdata: *mut c_void) {
    // SAFETY: userdata 는 `on_write_pty` 와 같다.
    let events = unsafe { &mut *(userdata as *mut VtEvents) };
    events.cwd.push(CwdEvent::Reset);
    events.title_changed = true;
}

/// `DATA_TITLE`·`DATA_PWD` 처럼 `GhosttyString` 을 빌려주는 값을 복사한다. 값이 없으면 비어 있다.
///
/// SAFETY: `raw` 는 살아 있는 터미널이고, 그 터미널을 바꾸는 호출과 겹치지 않아야 한다.
unsafe fn get_string(raw: ffi::GhosttyTerminal, data: i32) -> Vec<u8> {
    let mut s = ffi::GhosttyString {
        ptr: ptr::null(),
        len: 0,
    };
    // SAFETY: 이 데이터의 출력 타입은 `GhosttyString*` 이고, 빌린 문자열은 다음 변경 호출까지 유효하다.
    let rc = unsafe { ffi::ghostty_terminal_get(raw, data, &mut s as *mut _ as *mut c_void) };
    if rc != ffi::GHOSTTY_SUCCESS || s.ptr.is_null() {
        return Vec::new();
    }
    unsafe { std::slice::from_raw_parts(s.ptr, s.len) }.to_vec()
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
        let mut t = VtTerminal {
            raw,
            events: Box::default(),
        };
        let events = &mut *t.events as *mut VtEvents as *const c_void;
        for (opt, value) in [
            (ffi::GHOSTTY_TERMINAL_OPT_USERDATA, events),
            (
                ffi::GHOSTTY_TERMINAL_OPT_WRITE_PTY,
                on_write_pty as ffi::GhosttyTerminalWritePtyFn as *const c_void,
            ),
            (
                ffi::GHOSTTY_TERMINAL_OPT_PROGRAM_STATUS,
                on_program_status as ffi::GhosttyTerminalProgramStatusFn as *const c_void,
            ),
            (
                ffi::GHOSTTY_TERMINAL_OPT_TITLE_CHANGED,
                on_title_changed as ffi::GhosttyTerminalNotifyFn as *const c_void,
            ),
            (
                ffi::GHOSTTY_TERMINAL_OPT_PWD_CHANGED,
                on_pwd_changed as ffi::GhosttyTerminalNotifyFn as *const c_void,
            ),
            (
                ffi::GHOSTTY_TERMINAL_OPT_RESET,
                on_reset as ffi::GhosttyTerminalNotifyFn as *const c_void,
            ),
            (
                ffi::GHOSTTY_TERMINAL_OPT_SEMANTIC_PROMPT,
                on_semantic_prompt as ffi::GhosttyTerminalSemanticPromptFn as *const c_void,
            ),
            (
                ffi::GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES,
                &SCROLLBACK_MAX_BYTES as *const usize as *const c_void,
            ),
            (
                ffi::GHOSTTY_TERMINAL_OPT_CONTINUATION_MAX_BYTES,
                &CONTINUATION_MAX_BYTES as *const usize as *const c_void,
            ),
        ] {
            // SAFETY: 앞 일곱의 입력은 포인터 값 그대로(userdata 와 콜백 함수)이고 뒤 둘은 `size_t*`
            // 로 호출 동안만 읽힌다. userdata 가 가리키는 Box 는 `t` 와 같이 살고 터미널이 먼저
            // 해제된다.
            let rc = unsafe { ffi::ghostty_terminal_set(t.raw, opt, value) };
            if rc != ffi::GHOSTTY_SUCCESS {
                bail!("ghostty_terminal_set(opt={opt}) rc={rc}");
            }
        }
        // 앱의 xterm 과 같은 규칙으로 글자 폭을 센다(`docs/architecture.md` 의 "글자 폭"). 기본값으로 두어야
        // 셸의 `reset`(RIS) 뒤에도 켜져 있다.
        let mode = ffi::GhosttyTerminalModeConfig {
            mode: ffi::GHOSTTY_MODE_GRAPHEME_CLUSTER,
            value: true,
        };
        // SAFETY: 이 옵션의 입력 타입은 `GhosttyTerminalModeConfig*` 다. 포인터는 호출 동안만 읽힌다.
        let rc = unsafe {
            ffi::ghostty_terminal_set(
                t.raw,
                ffi::GHOSTTY_TERMINAL_OPT_MODE_DEFAULT,
                &mode as *const ffi::GhosttyTerminalModeConfig as *const c_void,
            )
        };
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_terminal_set(mode 2027) rc={rc}");
        }
        Ok(t)
    }

    fn alternate_active(&self) -> Result<bool> {
        let mut screen: i32 = 0;
        // SAFETY: 이 데이터의 출력 타입은 int 크기의 `GhosttyTerminalScreen*` 다.
        let rc = unsafe {
            ffi::ghostty_terminal_get(
                self.raw,
                ffi::GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN,
                &mut screen as *mut i32 as *mut c_void,
            )
        };
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_terminal_get(ACTIVE_SCREEN) rc={rc}");
        }
        Ok(screen == ffi::GHOSTTY_TERMINAL_SCREEN_ALTERNATE)
    }

    fn snapshot_copy(&self) -> Result<VtTerminal> {
        let mut out_ptr: *mut u8 = ptr::null_mut();
        let mut out_len: usize = 0;
        // SAFETY: `&self` 동안 다른 쓰기가 없다. out 은 지역 변수다.
        let rc = unsafe {
            ffi::ghostty_snapshot_encode_alloc(self.raw, ptr::null(), &mut out_ptr, &mut out_len)
        };
        if rc != ffi::GHOSTTY_SUCCESS || out_ptr.is_null() {
            bail!("ghostty_snapshot_encode_alloc rc={rc}");
        }
        let mut decoder: ffi::GhosttySnapshotDecoder = ptr::null_mut();
        let mut raw: ffi::GhosttyTerminal = ptr::null_mut();
        // SAFETY: (out_ptr, out_len) 은 decode 가 끝날 때까지 살아 있고, 그 뒤 같은 할당자·길이로
        // 해제한다. decoder 는 decode 뒤 바로 해제하고 터미널의 소유는 호출자에게 남는다.
        let rc = unsafe {
            let mut rc =
                ffi::ghostty_snapshot_decoder_new_buf(ptr::null(), &mut decoder, out_ptr, out_len);
            if rc == ffi::GHOSTTY_SUCCESS {
                rc = ffi::ghostty_snapshot_decoder_decode(decoder, &mut raw);
            }
            ffi::ghostty_snapshot_decoder_free(decoder);
            ffi::ghostty_free(ptr::null(), out_ptr, out_len);
            rc
        };
        if rc != ffi::GHOSTTY_SUCCESS || raw.is_null() {
            bail!("ghostty snapshot decode rc={rc}");
        }
        Ok(VtTerminal {
            raw,
            events: Box::default(),
        })
    }

    /// 붙는 클라이언트에 보낼 재생. 그리드 높이·스크롤 리전·커서까지 이 화면과 같게 맞춰 끝난다.
    ///
    /// 대체 화면이 떠 있으면 일반 화면과 스크롤백을 먼저 싣는다 — 대체 화면만 보내면 그
    /// 프로그램이 끝난 뒤 클라이언트에 빈 화면이 남는다. 포맷은 활성 화면만 내보내므로 복제본을
    /// 일반 화면으로 되돌려 포맷한다.
    pub fn replay(&self) -> Result<Vec<u8>> {
        let active = self.format(VtFormat::Vt)?;
        if !self.alternate_active()? {
            return self.with_trailing_blank_rows(active);
        }
        // 끝나지 않은 시퀀스가 상한을 넘으면 복제할 수 없다.
        let Ok(mut primary) = self.snapshot_copy() else {
            return self.with_trailing_blank_rows(active);
        };
        primary.write(b"\x1b[?1049l\x1b[?1047l\x1b[?47l");
        let mut out = primary.format(VtFormat::Vt)?;
        out = primary.with_trailing_blank_rows(out)?;
        // 대체 화면 포맷은 빈 화면의 홈에서 그리기 시작한다고 보고, `?1049h` 는 커서를 옮기지
        // 않으면서 나갈 때 돌아올 자리로 저장한다.
        out.extend_from_slice(b"\x1b[?1049h\x1b[H");
        out.extend_from_slice(&drop_modes(&active, SCREEN_MODES));
        Ok(out)
    }

    /// 포맷은 꼬리의 빈 행을 잘라 내므로, 그만큼 개행으로 되살려야 뷰포트 원점이 같아진다.
    /// 커서 한 점만 맞추면 그 뒤 프로그램이 자기 좌표로 그리는 것이 모두 어긋난다.
    fn with_trailing_blank_rows(&self, out: Vec<u8>) -> Result<Vec<u8>> {
        let rows = self.scrollbar()?.len;
        let pad = self.trailing_blank_rows(&out)?.min(rows);
        if pad == 0 {
            return Ok(out);
        }
        // 개행은 formatter 가 실은 리전·커서 상태보다 앞에 넣는다. 마지막 행이 리전 밖이면 개행이
        // 스크롤하지 않기 때문이다. 개행을 상태 뒤에 넣고 커서를 CUP 으로 다시 옮기면 formatter 가
        // 되살린 pending wrap 이 지워진다.
        let (body, state) = out.split_at(state_start(&out).unwrap_or(out.len()));
        let mut padded = Vec::with_capacity(out.len() + 16 + pad as usize);
        padded.extend_from_slice(body);
        padded.extend_from_slice(format!("\x1b[r\x1b[{rows};1H").as_bytes());
        padded.extend(std::iter::repeat_n(b'\n', pad as usize));
        padded.extend_from_slice(state);
        Ok(padded)
    }

    pub fn write(&mut self, bytes: &[u8]) {
        // SAFETY: (ptr, len) 은 빌린 슬라이스 그대로이고 `&mut self` 가 접근을 직렬화한다.
        unsafe { ffi::ghostty_terminal_vt_write(self.raw, bytes.as_ptr(), bytes.len()) };
    }

    pub fn take_events(&mut self) -> VtEvents {
        std::mem::take(&mut *self.events)
    }

    /// OSC 0/2 로 받은 제목. 받은 적이 없거나 비었거나 RIS 로 지워졌으면 None 이다.
    pub fn title(&self) -> Option<String> {
        // SAFETY: `&self` 동안 다른 쓰기가 없다.
        let title = unsafe { get_string(self.raw, ffi::GHOSTTY_TERMINAL_DATA_TITLE) };
        (!title.is_empty()).then(|| String::from_utf8_lossy(&title).into_owned())
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        check_size(cols, rows)?;
        // SAFETY: 인자는 모두 스칼라다. 헤드리스라 글자 칸 픽셀 크기는 0 이다.
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

    /// 개행으로 행을 세는 건 `unwrap: false` 라 그리드 행 하나가 페이로드 줄 하나여서다.
    /// 활성 영역 높이가 하한인 건 클라이언트 그리드가 늘 `rows` 행이어서다.
    fn trailing_blank_rows(&self, payload: &[u8]) -> Result<u64> {
        let emitted = if payload.is_empty() {
            0
        } else {
            payload.iter().filter(|b| **b == b'\n').count() as u64 + 1
        };
        let bar = self.scrollbar()?;
        Ok(bar.total.saturating_sub(emitted.max(bar.len)))
    }

    fn mode(&self, mode: u16) -> Result<bool> {
        let mut config = ffi::GhosttyTerminalModeConfig { mode, value: false };
        // SAFETY: 이 데이터의 입출력 타입은 `GhosttyTerminalModeConfig*` 다.
        let rc = unsafe {
            ffi::ghostty_terminal_get(
                self.raw,
                ffi::GHOSTTY_TERMINAL_DATA_MODE,
                &mut config as *mut ffi::GhosttyTerminalModeConfig as *mut c_void,
            )
        };
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_terminal_get(MODE {mode}) rc={rc}");
        }
        Ok(config.value)
    }

    /// 모드 값만 바꾸고 커서는 옮기지 않는다. 시퀀스로 DECOM 을 바꾸면 커서가 홈으로 간다.
    fn set_mode(&self, mode: u16, value: bool) -> Result<()> {
        let config = ffi::GhosttyTerminalModeConfig { mode, value };
        // SAFETY: 이 옵션의 입력 타입은 `GhosttyTerminalModeConfig*` 다. 포인터는 호출 동안만 읽힌다.
        let rc = unsafe {
            ffi::ghostty_terminal_set(
                self.raw,
                ffi::GHOSTTY_TERMINAL_OPT_MODE,
                &config as *const ffi::GhosttyTerminalModeConfig as *const c_void,
            )
        };
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_terminal_set(MODE {mode}) rc={rc}");
        }
        Ok(())
    }

    /// DECOM 이 켜져 있으면 ghostty 는 커서 CUP 을 리전 기준으로 내보낸다. 재생본은 DECOM 을 싣지
    /// 않으므로 커서 CUP 이 화면 기준이어야 한다. 그래서 포맷하는 동안만 DECOM 을 끈다.
    /// `VtTerminal` 이 `Sync` 가 아니므로 그동안 다른 스레드가 이 터미널을 보지 못한다.
    pub fn format(&self, fmt: VtFormat) -> Result<Vec<u8>> {
        let origin = fmt == VtFormat::Vt && self.mode(ffi::GHOSTTY_MODE_ORIGIN)?;
        if !origin {
            return self.format_with_modes_as_set(fmt);
        }
        self.set_mode(ffi::GHOSTTY_MODE_ORIGIN, false)?;
        let out = self.format_with_modes_as_set(fmt);
        self.set_mode(ffi::GHOSTTY_MODE_ORIGIN, true)?;
        out
    }

    /// 내용이 있는 첫 글자 칸부터 마지막 글자 칸까지. 내용이 없으면 None 이다.
    fn select_all(&self) -> Result<Option<ffi::GhosttySelection>> {
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
        // SAFETY: out 은 `size` 를 채운 지역 sized struct 다.
        match unsafe { ffi::ghostty_terminal_select_all(self.raw, &mut sel) } {
            ffi::GHOSTTY_SUCCESS => Ok(Some(sel)),
            ffi::GHOSTTY_NO_VALUE => Ok(None),
            rc => bail!("ghostty_terminal_select_all rc={rc}"),
        }
    }

    fn format_with_modes_as_set(&self, fmt: VtFormat) -> Result<Vec<u8>> {
        // 내용이 있는지만 묻는다. 이 범위를 포맷에 넘기면 머리의 빈 행과 선행 공백이 빠져
        // 커서와 어긋난다.
        let has_content = self.select_all()?.is_some();
        let vt = fmt == VtFormat::Vt;
        // 내용이 없어도 VT 는 모드(대체 화면·커서 숨김·bracketed paste)를 실어야 한다.
        if !has_content && !vt {
            return Ok(Vec::new());
        }

        let opts = ffi::GhosttyFormatterTerminalOptions {
            size: size_of::<ffi::GhosttyFormatterTerminalOptions>(),
            emit: if vt {
                ffi::GHOSTTY_FORMATTER_FORMAT_VT
            } else {
                ffi::GHOSTTY_FORMATTER_FORMAT_PLAIN
            },
            unwrap: fmt == VtFormat::PlainUnwrapped,
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
        if vt {
            self.run_formatter(opts, |raw| drop_modes(raw, UNREPLAYABLE_MODES))
        } else {
            self.run_formatter(opts, <[u8]>::to_vec)
        }
    }

    /// 스크롤백과 커서 행 위의 행을 지워 커서 행을 맨 위로 올리는 시퀀스. ghostty 앱의 `clear_screen`
    /// 이 셸에 알리지 않고 지우는 것과 같다. 이 화면과 클라이언트의 xterm 에 같은 바이트를 쓰므로 두
    /// 터미널이 같은 결과를 내는 시퀀스만 쓴다. 대체 화면이 떠 있으면 None 이다. xterm 은 대체 화면이 떠
    /// 있는 동안 일반 화면의 스크롤백을 지울 수 없기 때문이다.
    pub fn clear_scrollback_sequence(&self) -> Result<Option<Vec<u8>>> {
        if self.alternate_active()? {
            return Ok(None);
        }
        let (_, y) = self.cursor()?;
        // SU 는 스크롤 영역 안에서만 돌므로 영역이 화면 전체일 때만 행을 올린다. ghostty 는 그때 올린
        // 행을 스크롤백에 넣고 xterm 은 버리는데, 뒤의 `3J` 가 스크롤백을 지워 결과가 같다.
        if y == 0 || !self.scroll_region_is_full()? {
            return Ok(Some(b"\x1b[3J".to_vec()));
        }
        Ok(Some(format!("\x1b[{y}S\x1b[3J\x1b[{y}A").into_bytes()))
    }

    /// C API 에 스크롤 영역을 읽는 값이 없어, 기본값이 아닐 때만 영역을 싣는 formatter 로 잰다.
    fn scroll_region_is_full(&self) -> Result<bool> {
        // 영역은 내용과 상관없이 실리므로, 스크롤백까지 포맷하지 않게 내용을 첫 글자 칸 하나로 줄인다.
        let sel = self.select_all()?.map(|sel| ffi::GhosttySelection {
            end: sel.start,
            ..sel
        });
        let selection = sel.as_ref().map_or(ptr::null(), |s| s as *const _);
        let opts = ffi::GhosttyFormatterTerminalOptions {
            size: size_of::<ffi::GhosttyFormatterTerminalOptions>(),
            emit: ffi::GHOSTTY_FORMATTER_FORMAT_VT,
            unwrap: false,
            trim: true,
            extra: ffi::GhosttyFormatterTerminalExtra {
                size: size_of::<ffi::GhosttyFormatterTerminalExtra>(),
                scrolling_region: true,
                screen: ffi::GhosttyFormatterScreenExtra {
                    size: size_of::<ffi::GhosttyFormatterScreenExtra>(),
                    ..Default::default()
                },
                ..Default::default()
            },
            selection,
        };
        // 스타일·모드·커서를 싣지 않으므로 출력의 CSI 는 영역 시퀀스뿐이다.
        self.run_formatter(opts, |out| state_start(out).is_none())
    }

    /// 출력은 ghostty 가 해제하기 전에 `read` 로 넘긴다. 복사본을 따로 만들지 않기 위해서다.
    fn run_formatter<T>(
        &self,
        opts: ffi::GhosttyFormatterTerminalOptions,
        read: impl FnOnce(&[u8]) -> T,
    ) -> Result<T> {
        let mut raw_fmt: ffi::GhosttyFormatter = ptr::null_mut();
        // SAFETY: `opts` 와 그 안의 sized struct 는 각자 `size` 를 채웠다. selection 은 NULL(화면 전체)이거나
        // 이 호출 동안 사는 지역 값이다.
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
        if rc != ffi::GHOSTTY_SUCCESS {
            bail!("ghostty_formatter_format_alloc rc={rc}");
        }
        if out_ptr.is_null() {
            return Ok(read(&[]));
        }
        // SAFETY: 성공 시 (out_ptr, out_len) 은 유효하다. 읽은 뒤 같은 할당자·길이로 해제한다.
        let out = read(unsafe { std::slice::from_raw_parts(out_ptr, out_len) });
        unsafe { ffi::ghostty_free(ptr::null(), out_ptr, out_len) };
        Ok(out)
    }
}

/// 프로그램은 켠 모드를 다시 그릴 때 다시 보내지 않으므로(vim 의 `?1` 등) 빠진 모드는 프로그램이
/// 다시 켤 때까지 꺼진 채 남는다. 그래서 다 싣고 재생을 망치는 것만 뺀다. `?2026` 은 그리는 도중의
/// 상태라 그 프로그램이 죽었으면 화면이 멈춘다. `?6`(DECOM)은 `VtTerminal::format` 이 꺼 두고 포맷한다.
const UNREPLAYABLE_MODES: &[&[u8]] = &[b"2026"];
/// 이미 들어간 대체 화면에 다시 쓰면 나갈 때 돌아올 커서 자리를 덮는다.
const SCREEN_MODES: &[&[u8]] = &[b"47", b"1047", b"1049"];

fn drop_modes(bytes: &[u8], drop: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match dec_mode_seq(&bytes[i..]) {
            Some((len, params, terminator)) => {
                let kept: Vec<&[u8]> = params.into_iter().filter(|p| !drop.contains(p)).collect();
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

/// formatter 가 내용 뒤에 싣는 리전·커서 상태가 시작하는 위치를 돌려준다. 그 상태는 숫자 두 개
/// 뒤에 `r`(DECSTBM)·`s`(DECSLRM)·`H`(CUP)가 오는 시퀀스로 시작한다. 내용 부분은 이 꼴의
/// 시퀀스를 내지 않는다(SGR 은 `m` 으로 끝난다).
fn state_start(bytes: &[u8]) -> Option<usize> {
    let mut i = 0;
    while let Some(at) = bytes[i..].windows(2).position(|w| w == b"\x1b[") {
        let start = i + at;
        let params = &bytes[start + 2..];
        let len = params
            .iter()
            .take_while(|b| b.is_ascii_digit() || **b == b';')
            .count();
        let body = &params[..len];
        let pair = body.split(|b| *b == b';').filter(|p| !p.is_empty()).count() == 2
            && body.iter().filter(|b| **b == b';').count() == 1;
        if pair && matches!(params.get(len), Some(b'r' | b's' | b'H')) {
            return Some(start);
        }
        i = start + 2;
    }
    None
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
    fn program_status_reports_are_decoded_and_queued() {
        let mut t = term();
        t.write(b"\x1b]7501;state=blocked:kind=permission:app=claude-code:msg=aGk=\x1b\\");
        let ev = t.take_events();
        assert_eq!(ev.reports.len(), 1);
        let r = &ev.reports[0];
        assert!(!r.clear);
        assert_eq!(r.state, ProgramStatusState::Blocked);
        assert_eq!(r.kind, Some(ProgramStatusKind::Permission));
        assert_eq!(
            (r.id.as_str(), r.app.as_str(), r.message.as_str()),
            ("", "claude-code", "hi")
        );
        assert_eq!(r.progress, None);
        assert!(t.take_events().reports.is_empty());
    }

    #[test]
    fn progress_and_title_are_decoded_when_sent() {
        let mut t = term();
        t.write(b"\x1b]7501;state=working:id=build:progress=42:title=QnVpbGQ=\x1b\\");
        let r = t.take_events().reports.remove(0);
        assert_eq!(r.state, ProgramStatusState::Working);
        assert_eq!(r.kind, None);
        assert_eq!(r.progress, Some(42));
        assert_eq!((r.id.as_str(), r.title.as_str()), ("build", "Build"));
    }

    // `maru status put` 이 검사하는 상한이 파서가 받는 값과 같은지 잰다. "QUFB" 는 "AAA" 로 풀린다.
    #[test]
    fn reports_at_the_specification_limits_are_kept() {
        let title = "QUFB".repeat(64);
        let msg = format!("{}QUE=", "QUFB".repeat(682));
        let id = format!(
            "{}/{}/{}/{}",
            "a".repeat(32),
            "b".repeat(32),
            "c".repeat(31),
            "d".repeat(30)
        );
        assert_eq!(id.len(), 128);
        let app = "e".repeat(32);
        let mut t = term();
        t.write(
            format!("\x1b]7501;state=blocked:id={id}:kind=question:progress=100:app={app}:title={title}:msg={msg}\x1b\\")
                .as_bytes(),
        );
        let r = t.take_events().reports.remove(0);
        assert_eq!(r.state, ProgramStatusState::Blocked);
        assert_eq!((r.id.as_str(), r.app.as_str()), (id.as_str(), app.as_str()));
        assert_eq!((r.title.len(), r.message.len()), (192, 2048));

        t.write(format!("\x1b]7501;state=done:title={title}QQ==\x1b\\").as_bytes());
        assert!(t.take_events().reports.is_empty());
    }

    #[test]
    fn a_clear_report_and_a_full_reset_are_queued_as_clear() {
        let mut t = term();
        t.write(b"\x1b]7501;state=clear:id=build\x1b\\\x1bc");
        let ev = t.take_events();
        assert_eq!(
            ev.reports
                .iter()
                .map(|r| (r.clear, r.id.as_str()))
                .collect::<Vec<_>>(),
            vec![(true, "build"), (true, "")]
        );
    }

    #[test]
    fn osc7_reports_and_a_full_reset_are_queued_in_order() {
        let mut t = term();
        t.write(b"\x1b]7;file:///a\x07\x1b]7;\x07\x1bc\x1b]7;file://h/b\x1b\\");
        let ev = t.take_events();
        assert_eq!(
            ev.cwd,
            vec![
                CwdEvent::Report(b"file:///a".to_vec()),
                CwdEvent::Report(Vec::new()),
                CwdEvent::Reset,
                CwdEvent::Report(b"file://h/b".to_vec()),
            ]
        );
        assert!(ev.title_changed, "RIS 는 제목을 지운다");
    }

    #[test]
    fn the_title_follows_osc_0_and_2_and_a_full_reset_clears_it() {
        let mut t = term();
        assert_eq!(t.title(), None);
        t.write(b"\x1b]2;one\x07");
        assert!(t.take_events().title_changed);
        assert_eq!(t.title().as_deref(), Some("one"));
        t.write("\x1b]0;둘\x1b\\".as_bytes());
        assert_eq!(t.title().as_deref(), Some("둘"));
        t.write(b"\x1b]2;\x07");
        assert_eq!(t.title(), None);
        t.write(b"\x1b]2;again\x07");
        t.take_events();
        t.write(b"\x1bc");
        assert!(t.take_events().title_changed);
        assert_eq!(t.title(), None);
    }

    #[test]
    fn osc7_paths_are_taken_only_without_a_host() {
        assert_eq!(osc7_path(b"file:///home/a").as_deref(), Some("/home/a"));
        assert_eq!(
            osc7_path(b"file:///tmp/a%20b/%ED%95%9C").as_deref(),
            Some("/tmp/a b/한")
        );
        assert_eq!(
            osc7_path("file:///raw/한".as_bytes()).as_deref(),
            Some("/raw/한")
        );
        for rejected in [
            &b"file://host/home/a"[..],
            b"file://",
            b"/home/a",
            b"http:///a",
            b"file:///a%2",
            b"file:///a%zz",
            b"file:///a%+1",
            b"file:///a%ff",
        ] {
            assert_eq!(
                osc7_path(rejected),
                None,
                "{:?}",
                String::from_utf8_lossy(rejected)
            );
        }
    }

    #[test]
    fn only_the_support_query_reply_is_written_back() {
        let mut t = term();
        t.write(b"\x1b[6n\x1b]7501;?\x1b\\\x1b]7501;?\x07");
        let ev = t.take_events();
        assert_eq!(ev.pty_replies.len(), 2, "{:?}", ev.pty_replies);
        assert!(
            ev.pty_replies[0].starts_with(b"\x1b]7501;?") && ev.pty_replies[0].ends_with(b"\x1b\\")
        );
        assert!(ev.pty_replies[1].ends_with(b"\x07"));
        assert!(ev.reports.is_empty());
    }

    #[test]
    fn semantic_prompt_steps_are_queued_in_order() {
        let mut t = term();
        t.write(b"\x1b]133;A\x07$ \x1b]133;B\x07\x1b]133;C;cmdline_url=npm%20run%20dev\x07out\r\n");
        t.write(b"\x1b]133;D;1\x07\x1b]133;D\x07\x1b]133;C\x07");
        assert_eq!(
            t.take_events().commands,
            vec![
                CommandEvent::PromptStart,
                CommandEvent::Start(Some("npm run dev".into())),
                CommandEvent::End(Some(1)),
                CommandEvent::End(None),
                CommandEvent::Start(None),
            ]
        );
    }

    #[test]
    fn command_text_keeps_semicolons_percents_and_hangul_but_drops_control_characters() {
        let mut t = term();
        t.write(b"\x1b]133;C;cmdline_url=a%3Bb%25c%20%ED%95%9C\x07");
        t.write(b"\x1b]133;C;cmdline_url=%1B[31mred%7F%C2%9Bx%0D\x07");
        t.write(b"\x1b]133;C;cmdline_url=%07%1B\x07");
        assert_eq!(
            t.take_events().commands,
            vec![
                CommandEvent::Start(Some("a;b%c 한".into())),
                CommandEvent::Start(Some("[31mredx".into())),
                CommandEvent::Start(None),
            ]
        );
    }

    #[test]
    fn command_text_turns_newlines_and_tabs_into_spaces() {
        let mut t = term();
        t.write(b"\x1b]133;C;cmdline_url=for%20i%20in%201%202%3B%20do%0Aprint%20$i%0Adone\x07");
        t.write(b"\x1b]133;C;cmdline_url=echo%20a%3B%5C%0Aecho%09b%0A\x07");
        t.write(b"\x1b]133;C;cmdline_url=%0A%09\x07");
        assert_eq!(
            t.take_events().commands,
            vec![
                CommandEvent::Start(Some("for i in 1 2; do print $i done".into())),
                CommandEvent::Start(Some("echo a;\\ echo b".into())),
                CommandEvent::Start(None),
            ]
        );
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
    fn emoji_sequences_take_the_cells_the_app_counts() {
        for (text, cells) in [
            ("✅", 2),
            ("👍🏽", 2),
            ("👨\u{200d}👩\u{200d}👧", 2),
            ("❤\u{fe0f}", 2),
            ("한", 2),
            ("⏺", 1),
            ("①", 1),
        ] {
            let mut t = term();
            t.write(text.as_bytes());
            assert_eq!(t.cursor().unwrap().0, cells, "{text}");
        }
    }

    #[test]
    fn emoji_sequences_keep_their_cells_after_a_full_reset() {
        let mut t = term();
        t.write("\x1bc👍🏽".as_bytes());
        assert_eq!(t.cursor().unwrap().0, 2);
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
    fn vt_puts_the_cursor_after_the_scroll_region() {
        let mut t = term();
        t.write(b"line1\r\nline2\r\n\x1b[5;20r\x1b[7;4H");
        let s = vt(&t);
        let region = s.find("\x1b[5;20r").expect(&s);
        assert!(s.rfind("\x1b[7;4H").expect(&s) > region, "{s:?}");
        assert_eq!(replayed(&t).cursor().unwrap(), t.cursor().unwrap());
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
    fn short_outputs_report_no_trailing_blanks() {
        let mut t = term();
        assert_eq!(t.trailing_blank_rows(&[]).unwrap(), 0);
        t.write(b"a\r\nb\r\n");
        let out = t.format(VtFormat::Plain).unwrap();
        assert_eq!(t.trailing_blank_rows(&out).unwrap(), 0);
    }

    fn replayed(t: &VtTerminal) -> VtTerminal {
        let payload = t.replay().unwrap();
        let mut c = term();
        c.write(&payload);
        c
    }

    fn assert_replay_keeps_links(t: &VtTerminal, uris: &[&str]) {
        let s = vt(&replayed(t));
        assert_eq!(s, vt(t));
        for uri in uris {
            assert!(s.contains(uri), "{uri}: {s:?}");
        }
    }

    // 닫힌 링크는 커서 상태가 아니라 글자 칸에만 남으므로, 글자 칸마다의 hyperlink 를 싣는지 본다.
    #[test]
    fn replay_carries_the_hyperlinks_of_cells() {
        let mut t = term();
        t.write(b"see \x1b]8;;https://example.com/osc\x1b\\repo#1\x1b]8;;\x1b\\ and ");
        t.write(b"\x1b]8;id=xyz;https://example.com/id\x1b\\same\x1b]8;;\x1b\\ done\r\n$ ");
        assert_replay_keeps_links(
            &t,
            &["https://example.com/osc", "id=xyz;https://example.com/id"],
        );
    }

    #[test]
    fn replay_keeps_links_in_scrollback_and_across_wrapped_rows() {
        let mut t = term();
        t.write(b"\x1b]8;;https://example.com/old\x1b\\old\x1b]8;;\x1b\\\r\n");
        for i in 0..100 {
            t.write(format!("line{i}\r\n").as_bytes());
        }
        t.write("x".repeat(78).as_bytes());
        t.write(b"\x1b]8;;https://example.com/wrap\x1b\\WRAP\x1b]8;;\x1b\\\r\n$ ");
        assert_replay_keeps_links(&t, &["https://example.com/old", "https://example.com/wrap"]);
    }

    #[test]
    fn replay_keeps_links_on_and_behind_the_alternate_screen() {
        let mut t = term();
        t.write(b"\x1b]8;;https://example.com/behind\x1b\\behind\x1b]8;;\x1b\\\r\n$ vim\r\n");
        t.write(b"\x1b[?1049h\x1b[H~ \x1b]8;;https://example.com/on\x1b\\on\x1b]8;;\x1b\\ ~");
        let mut c = replayed(&t);
        assert!(vt(&c).contains("https://example.com/on"), "{:?}", vt(&c));
        c.write(b"\x1b[?1049l");
        assert!(
            vt(&c).contains("https://example.com/behind"),
            "{:?}",
            vt(&c)
        );
    }

    #[test]
    fn blank_screens_format_to_nothing_and_replay_as_themselves() {
        for content in [&b""[..], b"   \r\n\t\r\n\x1b[41m   \x1b[0m"] {
            let mut t = term();
            t.write(content);
            assert_eq!(t.format(VtFormat::Plain).unwrap(), b"", "{content:?}");
            assert_primary_replay_matches(&mut t);
        }
    }

    #[test]
    fn replay_on_the_alternate_screen_leaves_the_primary_screen_behind_it() {
        let mut t = term();
        for i in 0..50 {
            t.write(format!("history{i}\r\n").as_bytes());
        }
        t.write(b"$ vim\r\n\x1b[?1049h\x1b[H~ TUI ~");
        let mut c = replayed(&t);
        assert!(plain(&c).contains("~ TUI ~"));
        c.write(b"\x1b[?1049l");
        let out = plain(&c);
        assert!(out.contains("history0") && out.contains("$ vim"), "{out:?}");
        assert!(!out.contains("~ TUI ~"), "{out:?}");
    }

    #[test]
    fn primary_cursor_and_grid_survive_leaving_the_replayed_alternate_screen() {
        let mut t = term();
        for i in 0..100 {
            t.write(format!("line{i}\r\n").as_bytes());
        }
        t.write(b"$ ");
        t.write(b"\x1b[?1049h\x1b[H~ TUI ~");
        let mut c = replayed(&t);
        c.write(b"\x1b[?1049l");
        t.write(b"\x1b[?1049l");
        assert_eq!(c.cursor().unwrap(), t.cursor().unwrap());
        assert_eq!(c.scrollbar().unwrap().total, t.scrollbar().unwrap().total);
    }

    fn dec_modes(t: &VtTerminal) -> Vec<(String, u8)> {
        let out = t.format(VtFormat::Vt).unwrap();
        let mut modes = Vec::new();
        let mut i = 0;
        while i < out.len() {
            match dec_mode_seq(&out[i..]) {
                Some((len, params, term)) => {
                    for p in params {
                        modes.push((String::from_utf8_lossy(p).into_owned(), term));
                    }
                    i += len;
                }
                None => i += 1,
            }
        }
        modes.sort();
        modes
    }

    fn assert_alternate_replay_matches(t: &mut VtTerminal, leave: &[u8]) {
        let mut c = replayed(t);
        assert!(c.alternate_active().unwrap());
        assert_eq!(plain(&c), plain(t));
        assert_eq!(c.cursor().unwrap(), t.cursor().unwrap());
        t.write(leave);
        c.write(leave);
        t.write(b"MARK");
        c.write(b"MARK");
        assert_eq!(plain(&c), plain(t));
        assert_eq!(c.cursor().unwrap(), t.cursor().unwrap());
        assert_eq!(c.scrollbar().unwrap().total, t.scrollbar().unwrap().total);
    }

    #[test]
    fn alternate_screen_content_keeps_its_rows_when_the_bottom_is_empty() {
        let mut t = term();
        t.write(b"seq\r\n1\r\n2\r\n$ \x1b[?1049h\x1b[H\x1b[2Jtop\x1b[5;5Hxx");
        assert_alternate_replay_matches(&mut t, b"\x1b[?1049l");
    }

    #[test]
    fn alternate_screens_entered_with_47_or_1047_replay_like_1049() {
        for (enter, leave) in [
            (&b"\x1b[?47h"[..], &b"\x1b[?47l"[..]),
            (b"\x1b[?1047h", b"\x1b[?1047l"),
        ] {
            let mut t = term();
            for i in 0..30 {
                t.write(format!("line{i}\r\n").as_bytes());
            }
            t.write(b"$ ");
            t.write(enter);
            t.write(b"\x1b[5;5Hxx");
            assert_alternate_replay_matches(&mut t, leave);
        }
    }

    #[test]
    fn primary_rows_line_up_under_a_scroll_region_set_on_the_alternate_screen() {
        let mut t = term();
        for i in 0..100 {
            t.write(format!("{i}\r\n").as_bytes());
        }
        t.write(b"\x1b[H\x1b[2Jtop\r\n$ \x1b[?1049h\x1b[1;22r\x1b[Hvim");
        assert_alternate_replay_matches(&mut t, b"\x1b[r\x1b[?1049l");
    }

    #[test]
    fn an_unfinished_sequence_too_long_to_copy_still_replays_the_alternate_screen() {
        let mut t = term();
        t.write(b"$ \x1b[?1049h\x1b[Hin-alt\x1b]52;c;");
        t.write(&vec![b'A'; 2 * CONTINUATION_MAX_BYTES]);
        let c = replayed(&t);
        assert!(c.alternate_active().unwrap());
        assert!(plain(&c).contains("in-alt"), "{:?}", plain(&c));
    }

    #[test]
    fn replay_carries_the_input_modes_a_program_set_once() {
        let mut t = term();
        t.write(b"\x1b[?1049h\x1b[?1h\x1b[?66h\x1b[?1002h\x1b[?1006h\x1b[?1004h\x1b[?1007l~ vim ~");
        let want = dec_modes(&t);
        for mode in ["1", "66", "1002", "1006", "1004"] {
            assert!(want.contains(&(mode.to_string(), b'h')), "{want:?}");
        }
        // 기본값이 켜짐이라 끈 것도 실려야 한다.
        assert!(want.contains(&("1007".to_string(), b'l')), "{want:?}");
        assert_eq!(dec_modes(&replayed(&t)), want);
    }

    #[test]
    fn replay_of_an_alternate_screen_with_nothing_drawn_still_carries_its_modes() {
        let mut t = term();
        t.write(b"$ prompt\r\n\x1b[?2004h\x1b[?1049h\x1b[?25l");
        let mut c = replayed(&t);
        assert!(c.alternate_active().unwrap());
        let want = dec_modes(&t);
        for mode in [("1049", b'h'), ("2004", b'h'), ("25", b'l')] {
            assert!(want.contains(&(mode.0.to_string(), mode.1)), "{want:?}");
        }
        assert_eq!(dec_modes(&c), want);
        c.write(b"\x1b[?1049l");
        assert!(plain(&c).contains("$ prompt"));
    }

    #[test]
    fn replay_of_an_empty_primary_screen_still_carries_its_modes() {
        let mut t = term();
        t.write(b"\x1b[?25l");
        let want = dec_modes(&t);
        assert_eq!(want, [("25".to_string(), b'l')]);
        assert_eq!(dec_modes(&replayed(&t)), want);
    }

    #[test]
    fn replay_of_a_primary_screen_filled_to_the_bottom_is_the_plain_vt_format() {
        let mut t = term();
        for i in 0..100 {
            t.write(format!("line{i}\r\n").as_bytes());
        }
        t.write(b"$ ");
        assert_eq!(t.replay().unwrap(), t.format(VtFormat::Vt).unwrap());
    }

    fn assert_primary_replay_matches(t: &mut VtTerminal) {
        let mut c = replayed(t);
        assert_eq!(plain(&c), plain(t));
        assert_eq!(c.cursor().unwrap(), t.cursor().unwrap());
        assert_eq!(c.scrollbar().unwrap().total, t.scrollbar().unwrap().total);
        // 리전 안에서 스크롤할 만큼 이어 써야 리전이 같은지 드러난다.
        for i in 0..30 {
            let line = format!("after{i}\r\n");
            t.write(line.as_bytes());
            c.write(line.as_bytes());
        }
        assert_eq!(plain(&c), plain(t));
        assert_eq!(c.cursor().unwrap(), t.cursor().unwrap());
        assert_eq!(c.scrollbar().unwrap().total, t.scrollbar().unwrap().total);
    }

    #[test]
    fn primary_replay_brings_back_the_blank_rows_below_the_content() {
        for region in [&b""[..], b"\x1b[1;20r", b"\x1b[3;24r"] {
            let mut t = term();
            for i in 0..200 {
                t.write(format!("{i}\r\n").as_bytes());
            }
            t.write(b"\x1b[H\x1b[2J");
            t.write(region);
            t.write(b"top\r\n$ ");
            assert_primary_replay_matches(&mut t);
        }
    }

    fn assert_continuing_after_replay_matches(t: &mut VtTerminal, first: &[u8]) {
        let mut c = replayed(t);
        assert_eq!(plain(&c), plain(t));
        for bytes in [first, b"TAIL", b"\r\nnext"] {
            t.write(bytes);
            c.write(bytes);
            assert_eq!(plain(&c), plain(t));
            assert_eq!(c.cursor().unwrap(), t.cursor().unwrap());
        }
    }

    fn filled() -> VtTerminal {
        let mut t = term();
        for i in 0..24 {
            t.write(format!("{i:0>80}").as_bytes());
            if i < 23 {
                t.write(b"\r\n");
            }
        }
        t
    }

    #[test]
    fn replay_keeps_the_pending_wrap_of_the_cursor() {
        let tails: [&[u8]; 3] = [
            b"\x1b[80GL",
            b"\x1b[79G\xed\x95\x9c",
            b"\x1b[80Gx\x1b7\x1b[X\x1b8",
        ];
        for tail in tails {
            for (name, mut t) in [("short", term()), ("filled", filled())] {
                t.write(b"\x1b[H$ ");
                t.write(tail);
                assert!(t.cursor().unwrap().0 == 79, "{name} {tail:?}");
                assert_continuing_after_replay_matches(&mut t, b"");
            }
        }
    }

    #[test]
    fn replay_keeps_the_pending_wrap_of_the_cursor_under_origin_mode() {
        for tail in [&b"\x1b[3;80HZ"[..], b"\x1b[3;7H"] {
            for mut t in [term(), filled()] {
                t.write(b"\x1b[5;20r\x1b[?6h");
                t.write(tail);
                assert_continuing_after_replay_matches(&mut t, b"");
            }
        }
    }

    #[test]
    fn replay_keeps_the_pending_wrap_on_and_behind_the_alternate_screen() {
        let mut behind = term();
        behind.write(b"$ \x1b[80GL\x1b[?1049h\x1b[Halt");
        assert_continuing_after_replay_matches(&mut behind, b"\x1b[?1049l");
        let mut on = term();
        on.write(b"base\r\n\x1b[?1049h\x1b[H\x1b[80GL");
        assert_continuing_after_replay_matches(&mut on, b"");
        on.write(b"\x1b[?1049l");
        let mut c = replayed(&on);
        c.write(b"\x1b[?1049l");
        assert_eq!(plain(&c), plain(&on));
    }

    #[test]
    fn state_starts_at_the_first_region_or_cursor_position() {
        assert_eq!(
            state_start(b"a\x1b[38;5;1mb\x1b[3X\x1b[1;5r\x1b[3;2H"),
            Some(15)
        );
        assert_eq!(state_start(b"a\x1b[0m\x1b[3;2Hb"), Some(5));
        assert_eq!(state_start(b"a\x1b[2;79s\x1b[3;2H"), Some(1));
        assert_eq!(
            state_start(b"\x1b[?2004h\x1b[r\x1b[H\x1b[;5H\x1b[1;2;3H"),
            None
        );
    }

    #[test]
    fn replay_works_with_an_unfinished_sequence_pending() {
        let mut t = term();
        t.write(b"base\r\n\x1b[?1049h\x1b[Halt\x1b[3");
        let mut c = replayed(&t);
        c.write(b"\x1b[?1049l");
        assert!(plain(&c).contains("base"));
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
    fn vt_drops_origin_mode_and_synchronized_output() {
        let mut t = term();
        t.write(b"\x1b[?6h\x1b[?2026h\x1b[?1h\x1b[?2004h");
        t.write(b"prompt> ");
        let s = vt(&t);
        for mode in ["?6h", "?2026h"] {
            assert!(!s.contains(&format!("\x1b[{mode}")), "{mode}: {s:?}");
        }
        assert!(s.contains("\x1b[?1h") && s.contains("\x1b[?2004h"), "{s:?}");
        assert!(t.mode(ffi::GHOSTTY_MODE_ORIGIN).unwrap());
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
    fn drop_modes_splits_combined_params() {
        assert_eq!(
            drop_modes(b"\x1b[?1;1049;2026h x", UNREPLAYABLE_MODES),
            b"\x1b[?1;1049h x"
        );
        assert_eq!(drop_modes(b"\x1b[?2026h x", UNREPLAYABLE_MODES), b" x");
        assert_eq!(drop_modes(b"\x1b[?h x", UNREPLAYABLE_MODES), b"\x1b[?h x");
        assert_eq!(drop_modes(b"\x1b[6h x", UNREPLAYABLE_MODES), b"\x1b[6h x");
    }

    fn clear(t: &mut VtTerminal) -> Option<Vec<u8>> {
        let seq = t.clear_scrollback_sequence().unwrap();
        if let Some(seq) = &seq {
            t.write(seq);
        }
        seq
    }

    fn filled_with_prompt() -> VtTerminal {
        let mut t = term();
        for i in 0..100 {
            t.write(format!("line{i}\r\n").as_bytes());
        }
        t.write(b"$ ls");
        t
    }

    #[test]
    fn clearing_moves_the_cursor_row_to_the_top_and_drops_the_scrollback() {
        let mut t = filled_with_prompt();
        assert_eq!(t.cursor().unwrap(), (4, 23));
        clear(&mut t).unwrap();
        assert_eq!(t.scrollbar().unwrap().total, 24);
        assert_eq!(t.cursor().unwrap(), (4, 0));
        assert_eq!(plain(&t), "$ ls");
    }

    #[test]
    fn clearing_keeps_the_rows_below_the_cursor() {
        let mut t = filled_with_prompt();
        t.write(b"\r\nbelow\x1b[A\x1b[3G");
        clear(&mut t).unwrap();
        assert_eq!(t.cursor().unwrap(), (2, 0));
        assert_eq!(plain(&t), "$ ls\nbelow");
    }

    #[test]
    fn clearing_on_the_top_row_only_drops_the_scrollback() {
        let mut t = filled_with_prompt();
        t.write(b"\x1b[H");
        assert_eq!(clear(&mut t).unwrap(), b"\x1b[3J");
        assert_eq!(t.scrollbar().unwrap().total, 24);
        assert_eq!(t.cursor().unwrap(), (0, 0));
    }

    #[test]
    fn clearing_under_a_scroll_region_only_drops_the_scrollback() {
        for region in [&b"\x1b[2;20r"[..], b"\x1b[?69h\x1b[1;40s"] {
            let mut t = filled_with_prompt();
            t.write(region);
            t.write(b"\x1b[10;3H");
            let rows = plain(&t);
            assert_eq!(clear(&mut t).unwrap(), b"\x1b[3J", "{region:?}");
            assert_eq!(t.scrollbar().unwrap().total, 24, "{region:?}");
            assert_eq!(t.cursor().unwrap(), (2, 9), "{region:?}");
            assert!(rows.ends_with(&plain(&t)), "{region:?}");
        }
    }

    #[test]
    fn clearing_does_nothing_on_the_alternate_screen() {
        let mut t = filled_with_prompt();
        t.write(b"\x1b[?1049hfull screen");
        assert_eq!(clear(&mut t), None);
        t.write(b"\x1b[?1049l");
        assert!(plain(&t).contains("line0"));
    }
}
