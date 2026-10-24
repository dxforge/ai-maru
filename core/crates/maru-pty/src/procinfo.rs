use std::path::PathBuf;

/// 프로세스가 끝났거나 다른 사용자의 것이면 None 이다.
#[cfg(target_os = "macos")]
pub fn cwd(pid: i32) -> Option<PathBuf> {
    use std::ffi::{CStr, OsStr, c_void};
    use std::os::unix::ffi::OsStrExt;

    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
    // SAFETY: 버퍼는 size 바이트짜리 proc_vnodepathinfo 이고 커널은 그 안에만 쓴다.
    let n = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut _ as *mut c_void,
            size,
        )
    };
    if n != size {
        return None;
    }
    // SAFETY: 커널이 vip_path 를 NUL 로 끝나는 경로로 채운다.
    let path = unsafe { CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr().cast()) };
    Some(PathBuf::from(OsStr::from_bytes(path.to_bytes())))
}

#[cfg(target_os = "linux")]
pub fn cwd(pid: i32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_this_process_cwd() {
        let want = std::env::current_dir().unwrap();
        assert_eq!(cwd(std::process::id() as i32), Some(want));
    }

    #[test]
    fn an_absent_process_has_no_cwd() {
        // pid 0 은 커널이고 proc_pidinfo·/proc 둘 다 cwd 를 주지 않는다.
        assert_eq!(cwd(0), None);
    }
}
