//! 프로그램이 OSC 7501 로 보고한 레코드. 수명 규칙은 프로토콜(ghostty `terminal.h` 의
//! `GhosttyTerminalProgramStatusFn`)대로다. 새 프롬프트·프로그램 종료에 working·blocked 를 지우는
//! 규칙은 이 프로세스가 둘 다 알 수 없어(셸이 OSC 133 을 찍지 않는다) 구현하지 않는다.

use crate::vt::{ProgramStatusKind, ProgramStatusReport, ProgramStatusState};
use std::collections::BTreeMap;
use std::time::Instant;

pub const MAX_RECORDS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
struct Record {
    state: ProgramStatusState,
    kind: Option<ProgramStatusKind>,
    progress: Option<u8>,
    app: String,
    title: String,
    message: String,
}

#[derive(Debug)]
struct Entry {
    record: Record,
    updated: Instant,
}

#[derive(Debug, Default)]
pub struct Records {
    entries: BTreeMap<String, Entry>,
}

impl Records {
    pub fn apply(&mut self, report: &ProgramStatusReport, now: Instant) -> bool {
        if report.clear {
            let before = self.entries.len();
            let id = report.id.as_str();
            self.entries
                .retain(|k, _| !(id.is_empty() || k == id || is_child(k, id)));
            return self.entries.len() != before;
        }
        let record = Record {
            state: report.state,
            kind: report.kind,
            progress: report.progress,
            app: report.app.clone(),
            title: report.title.clone(),
            message: report.message.clone(),
        };
        let changed = self.entries.get(&report.id).map(|e| &e.record) != Some(&record);
        self.entries.insert(
            report.id.clone(),
            Entry {
                record,
                updated: now,
            },
        );
        while self.entries.len() > MAX_RECORDS {
            let oldest = self
                .entries
                .iter()
                .min_by_key(|(_, e)| e.updated)
                .map(|(k, _)| k.clone())
                .expect("entries is not empty");
            self.entries.remove(&oldest);
        }
        changed
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// 레코드 전체를 id 순서로 돌려준다. 상태 메시지의 `records` 다.
    pub fn to_json(&self) -> serde_json::Value {
        #[derive(serde::Serialize)]
        struct Wire<'a> {
            id: &'a str,
            #[serde(flatten)]
            record: &'a Record,
        }
        let records: Vec<Wire> = self
            .entries
            .iter()
            .map(|(id, e)| Wire {
                id,
                record: &e.record,
            })
            .collect();
        serde_json::json!(records)
    }
}

fn is_child(id: &str, parent: &str) -> bool {
    id.strip_prefix(parent)
        .is_some_and(|rest| rest.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn report(id: &str, state: ProgramStatusState, message: &str) -> ProgramStatusReport {
        ProgramStatusReport {
            clear: false,
            state,
            kind: None,
            progress: None,
            id: id.to_string(),
            app: "x".to_string(),
            title: String::new(),
            message: message.to_string(),
        }
    }

    fn clear(id: &str) -> ProgramStatusReport {
        ProgramStatusReport {
            clear: true,
            ..report(id, ProgramStatusState::Idle, "")
        }
    }

    fn ids(r: &Records) -> Vec<String> {
        r.entries.keys().cloned().collect()
    }

    #[test]
    fn a_report_replaces_the_whole_record() {
        let mut r = Records::default();
        let t = Instant::now();
        assert!(r.apply(
            &ProgramStatusReport {
                kind: Some(ProgramStatusKind::Permission),
                ..report("", ProgramStatusState::Blocked, "why")
            },
            t,
        ));
        assert!(r.apply(&report("", ProgramStatusState::Working, ""), t));
        let m = r.to_json();
        assert_eq!(m.as_array().unwrap().len(), 1);
        assert_eq!(m[0]["kind"], serde_json::Value::Null);
        assert_eq!(m[0]["message"], "");
        assert_eq!(m[0]["state"], "working");
    }

    #[test]
    fn an_identical_report_changes_nothing() {
        let mut r = Records::default();
        let t = Instant::now();
        assert!(r.apply(&report("", ProgramStatusState::Working, "hi"), t));
        assert!(!r.apply(
            &report("", ProgramStatusState::Working, "hi"),
            t + Duration::from_secs(1)
        ));
    }

    #[test]
    fn clear_removes_the_record_and_its_children_only() {
        let mut r = Records::default();
        let t = Instant::now();
        for id in ["build", "build/test", "builder", "deploy"] {
            r.apply(&report(id, ProgramStatusState::Working, ""), t);
        }
        assert!(r.apply(&clear("build"), t));
        assert_eq!(ids(&r), ["builder", "deploy"]);
        assert!(!r.apply(&clear("nothing"), t));

        r.apply(&report("build/test", ProgramStatusState::Working, ""), t);
        assert!(r.apply(&clear("build"), t));
        assert_eq!(ids(&r), ["builder", "deploy"]);
    }

    #[test]
    fn clear_without_an_id_removes_everything() {
        let mut r = Records::default();
        let t = Instant::now();
        r.apply(&report("", ProgramStatusState::Done, ""), t);
        r.apply(&report("build", ProgramStatusState::Working, ""), t);
        assert!(r.apply(&clear(""), t));
        assert!(r.is_empty());
        assert_eq!(r.to_json(), serde_json::json!([]));
        assert!(!r.apply(&clear(""), t));
    }

    #[test]
    fn the_oldest_updated_record_goes_when_the_257th_arrives() {
        let mut r = Records::default();
        let t = Instant::now();
        for i in 0..MAX_RECORDS {
            r.apply(
                &report(&i.to_string(), ProgramStatusState::Working, ""),
                t + Duration::from_secs(i as u64),
            );
        }
        r.apply(
            &report("a", ProgramStatusState::Working, ""),
            t + Duration::from_secs(300),
        );
        assert_eq!(r.entries.len(), MAX_RECORDS);
        assert!(!r.entries.contains_key("0"));
        assert!(r.entries.contains_key("1"));

        r.apply(
            &report("1", ProgramStatusState::Done, ""),
            t + Duration::from_secs(400),
        );
        r.apply(
            &report("b", ProgramStatusState::Working, ""),
            t + Duration::from_secs(500),
        );
        assert!(r.entries.contains_key("1"));
        assert!(!r.entries.contains_key("2"));
    }

    #[test]
    fn records_are_serialized_in_id_order_with_nulls() {
        let mut r = Records::default();
        let t = Instant::now();
        r.apply(
            &ProgramStatusReport {
                progress: Some(42),
                ..report("b", ProgramStatusState::Working, "m")
            },
            t,
        );
        r.apply(
            &ProgramStatusReport {
                kind: Some(ProgramStatusKind::Auth),
                title: "T".to_string(),
                ..report("a", ProgramStatusState::Blocked, "")
            },
            t,
        );
        assert_eq!(
            r.to_json(),
            serde_json::json!([
                {"id": "a", "state": "blocked", "kind": "auth", "progress": null,
                 "app": "x", "title": "T", "message": ""},
                {"id": "b", "state": "working", "kind": null, "progress": 42,
                 "app": "x", "title": "", "message": "m"},
            ])
        );
    }
}
