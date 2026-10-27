//! pane 상태(셸 cwd·제목·foreground cwd·명령·OSC 7501 레코드)와 그것을 받는 `subscribe` 연결.
//! 메시지 모양은 모듈 doc(`lib.rs`)의 `subscribe` 에 있다.

use crate::frame::{TAG_TEXT, write_frame};
use crate::program_status::Records;
use crate::pty::Pty;
use crate::vt::{CommandEvent, CwdEvent, command_text, osc7_path};
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

/// 셸의 명령 실행 상태. `text`·`started_at` 은 명령이 끝난 뒤에도 남는다 — 실패한 명령을 보이는 데 쓴다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CommandState {
    pub running: bool,
    pub text: Option<String>,
    pub exit_code: Option<i32>,
    /// epoch 밀리초
    pub started_at: Option<u64>,
}

/// 상태 가운데 VT 와 레코드 밖에서 드는 것. 제목은 VT 가, 레코드는 `Records` 가 든다.
#[derive(Debug, Default)]
pub struct PaneState {
    /// 받아들인 마지막 OSC 7 의 경로. ghostty 는 버린 보고로도 pwd 를 덮으므로 따로 든다.
    pub cwd: Option<String>,
    /// 받아들인 OSC 7 보고 수. 같은 경로를 다시 보고해도 는다.
    pub cwd_reports: u64,
    pub foreground_cwd: Option<String>,
    /// OSC 133 을 받은 적이 없는 셸이면 None 이다.
    pub command: Option<CommandState>,
    /// 명령 pane 이다. 명령이 스스로 찍은 OSC 133 이 띄울 때 채운 상태를 덮지 않게 한다.
    command_fixed: bool,
}

impl PaneState {
    /// 명령을 띄운 pane. 명령이 끝나면 pane 도 끝나므로 늘 도는 중으로 둔다. `--keep` 이면 끝난 뒤에도 이 값이 남는다.
    pub fn for_command(argv: &[String], started_at: u64) -> Self {
        PaneState {
            command: Some(CommandState {
                running: true,
                text: command_text(argv.join(" ").as_bytes()),
                exit_code: None,
                started_at: Some(started_at),
            }),
            command_fixed: true,
            ..Default::default()
        }
    }

    /// 상태가 바뀌었으면 true 다. `now` 는 epoch 밀리초다.
    pub fn apply_command(&mut self, event: &CommandEvent, now: u64) -> bool {
        if self.command_fixed {
            return false;
        }
        let running = self.command.as_ref().is_some_and(|c| c.running);
        let next = match event {
            CommandEvent::Start(text) => CommandState {
                running: true,
                text: text.clone(),
                exit_code: None,
                started_at: Some(now),
            },
            // 끝이 오지 않은 채 다음 프롬프트가 떴다(훅이 빠짐 등). 종료 코드는 모른다.
            CommandEvent::PromptStart if running => CommandState {
                running: false,
                exit_code: None,
                ..self.command.clone().unwrap()
            },
            CommandEvent::PromptStart if self.command.is_none() => CommandState {
                running: false,
                text: None,
                exit_code: None,
                started_at: None,
            },
            CommandEvent::End(code) if running => CommandState {
                running: false,
                exit_code: *code,
                ..self.command.clone().unwrap()
            },
            CommandEvent::PromptStart | CommandEvent::End(_) => return false,
        };
        let changed = self.command.as_ref() != Some(&next);
        self.command = Some(next);
        changed
    }

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
            "command": self.command,
            "records": records.to_json(),
        })
        .to_string()
    }
}

/// foreground 는 실제 경로를 주고 셸의 OSC 7 은 `$PWD` 를 주므로, 셸이 심볼릭 링크 경로에 있으면 같은 디렉토리라도
/// 두 경로가 다르다. 같은 디렉토리면 `keep`(셸 cwd, 없으면 시작 디렉토리)의 경로를 돌려준다.
pub fn same_dir_as(foreground: &Path, keep: Option<&str>) -> String {
    let real = |p: &Path| std::fs::canonicalize(p).ok();
    if let Some(keep) = keep
        && let Some(a) = real(Path::new(keep))
        && real(foreground).as_ref() == Some(&a)
    {
        return keep.to_string();
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
                "foreground_cwd": null, "command": null, "records": [],
            })
        );
    }

    fn command(s: &PaneState) -> (bool, Option<&str>, Option<i32>, Option<u64>) {
        let c = s.command.as_ref().expect("command");
        (c.running, c.text.as_deref(), c.exit_code, c.started_at)
    }

    fn start(text: &str) -> CommandEvent {
        CommandEvent::Start(Some(text.into()))
    }

    #[test]
    fn a_prompt_turns_an_unknown_shell_into_an_idle_one() {
        let mut s = PaneState::default();
        assert!(s.apply_command(&CommandEvent::PromptStart, 5));
        assert_eq!(command(&s), (false, None, None, None));
        assert!(
            !s.apply_command(&CommandEvent::PromptStart, 6),
            "다시 그린 프롬프트"
        );
    }

    #[test]
    fn a_command_runs_from_start_and_keeps_its_text_after_it_ends() {
        let mut s = PaneState::default();
        s.apply_command(&CommandEvent::PromptStart, 1);
        assert!(s.apply_command(&start("cargo test"), 10));
        assert_eq!(command(&s), (true, Some("cargo test"), None, Some(10)));
        assert!(s.apply_command(&CommandEvent::End(Some(101)), 20));
        assert_eq!(
            command(&s),
            (false, Some("cargo test"), Some(101), Some(10))
        );
        assert!(
            !s.apply_command(&CommandEvent::PromptStart, 21),
            "D 뒤의 A 는 그대로 둔다"
        );
        assert_eq!(
            command(&s),
            (false, Some("cargo test"), Some(101), Some(10))
        );
        assert!(
            s.apply_command(&start("ls"), 30),
            "다음 명령이 실패를 지운다"
        );
        assert_eq!(command(&s), (true, Some("ls"), None, Some(30)));
    }

    #[test]
    fn a_command_pane_spaces_newlines_and_drops_other_control_characters_from_its_argv() {
        let s = PaneState::for_command(
            &["sh".into(), "-c".into(), "echo a\n\x1b[1msleep 9".into()],
            1,
        );
        assert_eq!(command(&s).1, Some("sh -c echo a [1msleep 9"));
        let s = PaneState::for_command(&["\x07".into()], 1);
        assert_eq!(command(&s), (true, None, None, Some(1)));
    }

    #[test]
    fn a_second_start_without_an_end_restarts_the_command() {
        let mut s = PaneState::default();
        s.apply_command(&start("a"), 2);
        assert!(s.apply_command(&start("b"), 5));
        assert_eq!(command(&s), (true, Some("b"), None, Some(5)));
    }

    #[test]
    fn an_end_without_a_running_command_is_dropped() {
        let mut s = PaneState::default();
        assert!(!s.apply_command(&CommandEvent::End(Some(1)), 1));
        assert!(s.command.is_none());
        s.apply_command(&start("a"), 2);
        s.apply_command(&CommandEvent::End(Some(0)), 3);
        assert!(!s.apply_command(&CommandEvent::End(Some(1)), 4));
        assert_eq!(command(&s), (false, Some("a"), Some(0), Some(2)));
    }

    #[test]
    fn a_prompt_without_an_end_stops_the_command_with_no_exit_code() {
        let mut s = PaneState::default();
        s.apply_command(&start("vim"), 2);
        assert!(s.apply_command(&CommandEvent::PromptStart, 3));
        assert_eq!(command(&s), (false, Some("vim"), None, Some(2)));
    }

    #[test]
    fn an_end_without_an_exit_code_stops_the_command_with_none() {
        let mut s = PaneState::default();
        s.apply_command(&start("a"), 2);
        assert!(s.apply_command(&CommandEvent::End(None), 3));
        assert_eq!(command(&s), (false, Some("a"), None, Some(2)));
    }

    #[test]
    fn a_command_pane_runs_from_spawn_and_ignores_osc_133() {
        let mut s = PaneState::for_command(&["npm".into(), "run".into(), "dev".into()], 7);
        for e in [
            CommandEvent::PromptStart,
            CommandEvent::End(Some(1)),
            start("other"),
        ] {
            assert!(!s.apply_command(&e, 9));
        }
        assert_eq!(command(&s), (true, Some("npm run dev"), None, Some(7)));
        let m: serde_json::Value =
            serde_json::from_str(&s.message(None, &Records::default())).unwrap();
        assert_eq!(
            m["command"],
            serde_json::json!({
                "running": true, "text": "npm run dev", "exit_code": null, "started_at": 7,
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
