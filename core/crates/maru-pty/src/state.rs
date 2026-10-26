//! pane 상태(셸 cwd·제목·foreground cwd·OSC 7501 레코드)와 그것을 받는 `subscribe` 연결.
//! 메시지 모양은 모듈 doc(`lib.rs`)의 `subscribe` 에 있다.

use crate::frame::{TAG_TEXT, write_frame};
use crate::program_status::Records;
use crate::pty::Pty;
use crate::vt::{CwdEvent, osc7_path};
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

/// 상태 가운데 VT 와 레코드 밖에서 드는 것. 제목은 VT 가, 레코드는 `Records` 가 든다.
#[derive(Debug, Default)]
pub struct PaneState {
    /// 받아들인 마지막 OSC 7 의 경로. ghostty 는 버린 보고로도 pwd 를 덮으므로 따로 든다.
    pub cwd: Option<String>,
    /// 받아들인 OSC 7 보고 수. 같은 경로를 다시 보고해도 는다.
    pub cwd_reports: u64,
    pub foreground_cwd: Option<String>,
}

impl PaneState {
    /// 상태가 바뀌었으면 true 다.
    pub fn apply(&mut self, event: &CwdEvent) -> bool {
        let before = (self.cwd_reports, self.cwd.is_some());
        match event {
            CwdEvent::Report(raw) if raw.is_empty() => {
                self.cwd = None;
                self.cwd_reports += 1;
            }
            CwdEvent::Report(raw) => {
                if let Some(path) = osc7_path(raw) {
                    self.cwd = Some(path);
                    self.cwd_reports += 1;
                }
            }
            CwdEvent::Reset => self.cwd = None,
        }
        before != (self.cwd_reports, self.cwd.is_some())
    }

    pub fn message(&self, title: Option<String>, records: &Records) -> String {
        serde_json::json!({
            "type": "state",
            "cwd": self.cwd,
            "cwd_reports": self.cwd_reports,
            "title": title,
            "foreground_cwd": self.foreground_cwd,
            "records": records.to_json(),
        })
        .to_string()
    }
}

/// foreground 는 실제 경로를 주고 셸의 OSC 7 은 `$PWD` 를 주므로, 셸이 심볼릭 링크 경로에 있으면 같은 디렉토리라도
/// 두 경로가 다르다. 같은 디렉토리면 셸의 경로를 돌려준다.
pub fn same_dir_as(foreground: &Path, shell: Option<&str>) -> String {
    let real = |p: &Path| std::fs::canonicalize(p).ok();
    if let Some(shell) = shell
        && let Some(a) = real(Path::new(shell))
        && real(foreground).as_ref() == Some(&a)
    {
        return shell.to_string();
    }
    foreground.to_string_lossy().into_owned()
}

/// 상태는 매번 전체라 watch 채널로 마지막 것 하나만 보낸다 — 느린 구독자도 큐가 자라지 않는다. 채널이 닫혀도
/// 아직 보내지 않은 상태는 보낸 뒤 끝난다.
pub async fn run(stream: UnixStream, pty: Arc<Pty>) {
    let (mut rd, mut wr) = stream.into_split();
    let mut rx = pty.subscribe_state();
    // 클라이언트가 보내는 것은 읽어 버린다. 끊긴 것을 알려고 읽는다.
    let mut probe = [0u8; 256];
    loop {
        tokio::select! {
            changed = rx.changed() => {
                if changed.is_err() {
                    break;
                }
                let m = rx.borrow_and_update().clone();
                if write_frame(&mut wr, TAG_TEXT, m.as_bytes()).await.is_err() {
                    break;
                }
            },
            n = rd.read(&mut probe) => {
                if matches!(n, Ok(0) | Err(_)) {
                    break;
                }
            }
        }
    }
    let _ = wr.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(raw: &str) -> CwdEvent {
        CwdEvent::Report(raw.as_bytes().to_vec())
    }

    #[test]
    fn a_rejected_report_keeps_the_last_path_and_is_not_counted() {
        let mut s = PaneState::default();
        assert!(s.apply(&report("file:///a")));
        assert!(s.apply(&report("file:///a")), "같은 경로도 보고 수가 는다");
        assert_eq!((s.cwd.as_deref(), s.cwd_reports), (Some("/a"), 2));
        assert!(!s.apply(&report("file://other/b")));
        assert_eq!((s.cwd.as_deref(), s.cwd_reports), (Some("/a"), 2));
        assert!(s.apply(&CwdEvent::Reset));
        assert!(!s.apply(&CwdEvent::Reset));
    }

    #[test]
    fn an_empty_report_and_a_reset_clear_the_path() {
        let mut s = PaneState::default();
        s.apply(&report("file:///a"));
        s.apply(&report(""));
        assert_eq!((s.cwd.as_deref(), s.cwd_reports), (None, 2));
        s.apply(&report("file:///b"));
        s.apply(&CwdEvent::Reset);
        assert_eq!((s.cwd.as_deref(), s.cwd_reports), (None, 3));
    }

    #[test]
    fn the_message_carries_every_field_with_nulls() {
        let s = PaneState::default();
        let m: serde_json::Value =
            serde_json::from_str(&s.message(None, &Records::default())).unwrap();
        assert_eq!(
            m,
            serde_json::json!({
                "type": "state", "cwd": null, "cwd_reports": 0, "title": null,
                "foreground_cwd": null, "records": [],
            })
        );
    }

    #[test]
    fn a_symlinked_shell_path_is_kept_for_the_same_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let real = std::fs::canonicalize(tmp.path()).unwrap();
        std::fs::create_dir(real.join("d")).unwrap();
        std::os::unix::fs::symlink(real.join("d"), real.join("link")).unwrap();
        let link = real.join("link");
        let link = link.to_str().unwrap();
        assert_eq!(same_dir_as(&real.join("d"), Some(link)), link);
        assert_eq!(
            same_dir_as(&real, Some(link)),
            real.to_string_lossy(),
            "다른 디렉토리면 foreground 경로다"
        );
        assert_eq!(same_dir_as(&real, None), real.to_string_lossy());
    }
}
