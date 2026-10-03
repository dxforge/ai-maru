//! 터미널 하나의 PTY·로그인 셸·화면 상태를 들고, 유닉스 도메인 소켓으로 여러 클라이언트를 받는
//! 세션 프로세스.
//!
//! 띄우거나 붙는 쪽이 알아야 할 것:
//!
//! - 같은 uid 의 프로세스는 누구나 primary 로 붙어 셸에 입력할 수 있다.
//! - 소켓 경로 `<dir>/<id>.sock` 은 103 바이트까지다. 넘으면 셸을 띄우기 전에 실패한다.
//! - 소켓이 connect 를 받으면 레코드 `<dir>/<id>.json` 도 읽힌다. 둘 다 프로세스가 죽어도 남을 수
//!   있어서, 살아 있는지는 connect 로 판정한다.
//! - 소켓이 connect 를 받기 시작하면 준비된 것이다. 셸이 끝나거나, `kill` 요청이나
//!   SIGTERM·SIGINT·SIGHUP 을 받으면 셸을 정리하고 소켓·레코드를 지운 뒤 끝난다.
//! - 같은 id 를 동시에 띄우면 막지 못한다. 띄우는 쪽은 매번 새 id 를 쓴다.
//! - 이 프로세스는 시작할 때 `setsid` 로 띄운 쪽의 세션에서 떨어진다. 프로세스 그룹 리더로 띄우면
//!   이게 실패해 띄운 쪽이 끝날 때 같이 시그널을 받을 수 있다.
//! - `version`·`kill` 은 `protocol_version` 과 상관없이 받고, 이 두 요청과 응답의 모양은 버전을
//!   올려도 바꾸지 않는다. 나머지 요청은 버전이 다르면 `protocol_mismatch` 로 거절한다.
//! - SIGHUP 을 무시한 작업(`nohup … &`)은 이 프로세스가 끝난 뒤에도 남는다.
//! - 크기는 `role: "primary"` 로 붙은 연결 하나가 정한다. 나중에 붙은 primary 가 자리를 가져가고,
//!   primary 가 떨어져도 다른 연결을 승격하지 않는다. `cols`·`rows` 는 1~4096 이고, 벗어난 크기는
//!   attach·resize 에서는 무시되고 `--cols`·`--rows` 로 넘기면 셸을 띄우기 전에 실패한다.
//! - 재생은 스크롤백을 포함한 화면·스타일·스크롤 리전·커서와 DEC 모드까지다. DEC 모드 가운데
//!   `?6`(DECOM)·`?2026`(동기 출력)은 싣지 않는다. 대체 화면이 떠 있으면 일반 화면과 스크롤백을
//!   먼저 싣고 그 뒤에 대체 화면을 싣는다. kitty 키보드 플래그 같은 입력 상태는 싣지 않으므로 완전
//!   복원이 아니다.
//!
//! # 프로토콜
//!
//! 프레임은 `[tag 1B][길이 u32 BE][페이로드]` 이다. tag 1 은 JSON(Text), 2 는 바이트(Binary)다.
//! 연결의 첫 프레임은 `type`·`protocol_version` 이 든 JSON 요청이다. 실패는
//! `{"type":"error","code":…}` 로 돌아온다.
//!
//! | 요청 | 응답 |
//! |---|---|
//! | `version` | `{"type":"version","protocol_version":…}` |
//! | `kill` | 셸을 끝내고 소켓·레코드를 지운 뒤 `{"type":"killed"}` |
//! | `capture` | `{"type":"capture","text":…}` |
//! | `attach` (`role`: `primary`·`observer`, primary 면 `cols`·`rows`) | 아래 |
//!
//! `attach` 의 응답은 헤더 `{"type":"attached","protocol_version","tty","role","cols","rows",
//! "cursor_x","cursor_y","trailing_blank_rows"}` 와 재생(Binary, 비어 있어도 보낸다)이고, 그 뒤로
//! PTY 출력이 Binary 로 이어진다. primary 가 보내는 Binary 는 셸 입력이고 observer 가 보내는 것은
//! 버린다 — 터미널 질의(`ESC[6n` 등)에 primary 만 답하게. primary 는 `{"type":"resize","cols",
//! "rows"}` 를 보낼 수 있다. 서버는 그 밖에 다음을 보낸다.
//!
//! - `{"type":"role","role":"observer"}` — 다른 연결이 primary 를 가져갔다.
//! - `{"type":"size","cols","rows"}` — primary 가 크기를 바꿨다. 이 뒤의 출력은 새 크기로 나온
//!   것이다. 바꾼 연결에는 보내지 않는다.
//! - `{"type":"resync",…}` + RIS(`ESC c`)로 시작하는 재생 — 출력을 못 따라잡아 건너뛴 것이 있다.
//!   한 연결에 다섯 번을 넘으면 `resync_limit_exceeded` 로 끊는다.
//! - `{"type":"exit","code","signal"}` — 셸이 끝났다. 남은 출력을 다 보낸 뒤에 온다.

// 띄운 쪽이 stderr 를 닫고 먼저 끝나면 쓰기가 EPIPE 로 실패하는데, `eprintln!` 은 거기서 패닉한다.
macro_rules! log {
    ($($arg:tt)*) => {{
        use std::io::Write as _;
        let _ = writeln!(std::io::stderr(), $($arg)*);
    }};
}

mod attach;
pub mod frame;
pub mod paths;
mod pty;
pub mod record;
pub mod server;
mod session;
mod vt;

pub const PROTOCOL_VERSION: u32 = 1;
