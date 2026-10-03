use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct Record {
    pub protocol_version: u32,
    pub id: String,
    pub pid: u32,
    pub shell_pid: u32,
    pub tty: String,
    pub created_at_ms: u64,
}

/// 제자리 truncate 로 쓰면 그 사이 스캔이 깨진 JSON 을 읽는다.
pub fn write(path: &Path, rec: &Record) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(rec)?)
        .with_context(|| format!("{} 를 쓸 수 없다", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("{} 로 옮길 수 없다", path.display()))
}

pub fn read(path: &Path) -> Result<Record> {
    let body =
        std::fs::read(path).with_context(|| format!("{} 를 읽을 수 없다", path.display()))?;
    Ok(serde_json::from_slice(&body)?)
}
