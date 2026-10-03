use anyhow::{Context, Result, bail, ensure};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// macOS `sockaddr_un.sun_path` 는 NUL 포함 104 바이트다. Linux(108)도 짧은 쪽에 맞춘다.
const MAX_SOCKET_PATH: usize = 103;

fn validate_id(id: &str) -> Result<()> {
    ensure!(
        !id.is_empty()
            && id.len() <= 64
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        "세션 id 는 1~64 자의 영숫자·'-'·'_' 여야 한다: {id:?}"
    );
    Ok(())
}

pub struct Paths {
    pub socket: PathBuf,
    pub record: PathBuf,
}

impl Paths {
    pub fn new(dir: &Path, id: &str) -> Result<Self> {
        validate_id(id)?;
        let socket = dir.join(format!("{id}.sock"));
        let len = socket.as_os_str().as_bytes().len();
        // bind 실패로는 무엇을 줄여야 하는지 알 수 없다.
        if len > MAX_SOCKET_PATH {
            bail!(
                "소켓 경로가 {len} 바이트로 한도 {MAX_SOCKET_PATH} 를 {} 바이트 넘는다 — 디렉토리를 그만큼 줄여야 한다: {}",
                len - MAX_SOCKET_PATH,
                socket.display()
            );
        }
        Ok(Paths {
            socket,
            record: dir.join(format!("{id}.json")),
        })
    }
}

pub fn prepare_dir(dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir).with_context(|| format!("{} 를 만들 수 없다", dir.display()))?;
    let meta = std::fs::symlink_metadata(dir)?;
    ensure!(
        meta.is_dir(),
        "{} 가 디렉토리가 아니다(심볼릭 링크 포함)",
        dir.display()
    );
    ensure!(
        meta.uid() == nix::unistd::geteuid().as_raw(),
        "{} 의 소유자가 이 사용자가 아니다",
        dir.display()
    );
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
        .with_context(|| format!("{} 의 권한을 0700 으로 맞출 수 없다", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_outside_the_allowed_charset_are_rejected() {
        for bad in ["", "a/b", "../x", ".hidden", "a b", "a\0b", &"x".repeat(65)] {
            assert!(validate_id(bad).is_err(), "{bad:?}");
        }
        assert!(validate_id("sess-78e45dbf").is_ok());
    }

    #[test]
    fn an_overlong_socket_path_says_how_much_to_cut() {
        let dir = PathBuf::from(format!("/{}", "x".repeat(100)));
        let err = Paths::new(&dir, "sess-1").err().unwrap().to_string();
        assert!(err.contains("줄여야"), "{err}");
    }

    #[test]
    fn prepare_dir_tightens_an_existing_dir_to_0700() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("s");
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        prepare_dir(&dir).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }

    #[test]
    fn prepare_dir_refuses_a_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(prepare_dir(&link).is_err());
    }
}
