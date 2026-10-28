use anyhow::{Context, Result, bail};
use nix::fcntl::{FcntlArg, FdFlag, fcntl};
use std::fs::File;
use std::os::fd::{AsRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};

const POSIX_SHELLS: [&str; 5] = ["sh", "bash", "zsh", "ksh", "dash"];

pub struct Master {
    fd: OwnedFd,
}

pub struct Spawned {
    pub master: Master,
    pub tty: String,
    pub child: Child,
    pub reader: File,
    pub writer: File,
}

fn winsize(cols: u16, rows: u16) -> nix::pty::Winsize {
    nix::pty::Winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    }
}

pub fn spawn(
    shell: &Path,
    shell_var: Option<&Path>,
    cwd: Option<&Path>,
    command: &[String],
    cols: u16,
    rows: u16,
) -> Result<Spawned> {
    let ws = winsize(cols, rows);
    let pair = nix::pty::openpty(Some(&ws), None).context("openpty failed")?;
    // openpty 는 CLOEXEC 를 안 건다. 안 걸면 셸과 그 자식들이 master 를 물려받는다.
    for fd in [&pair.master, &pair.slave] {
        fcntl(fd, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC)).context("cannot set FD_CLOEXEC")?;
    }

    let tty_path = nix::unistd::ttyname(&pair.slave).context("cannot get the slave name")?;
    let tty = tty_path
        .to_string_lossy()
        .trim_start_matches("/dev/")
        .to_string();

    // argv[0] 앞의 `-` 가 셸 종류와 상관없이 통하는 로그인 셸 관례다.
    let name = shell
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sh".into());
    // 명령을 `"$@"` 로 넘기면 따옴표를 다시 escape 하지 않아도 된다. 셸 함수도 불린다.
    let run = ["-c", "\"$@\""];
    let mut cmd = if command.is_empty() {
        let mut cmd = Command::new(shell);
        cmd.arg0(format!("-{name}"));
        cmd
    } else if POSIX_SHELLS.contains(&name.as_str()) {
        // `-i` 가 있어야 사용자가 터미널에 칠 때처럼 rc(zsh 의 ~/.zshrc 등)를 읽어, rc 가 PATH 에 넣은 명령을
        // 찾는다.
        let mut cmd = Command::new(shell);
        cmd.arg0(format!("-{name}")).arg("-i").args(run).arg(&name);
        cmd
    } else {
        // tcsh·fish 등은 `"$@"` 를 모른다. rc 는 못 읽어도 명령은 실행한다.
        let mut cmd = Command::new("/bin/sh");
        cmd.args(run).arg("sh");
        cmd
    };
    cmd.args(command)
        .env("TERM", "xterm-256color")
        .stdin(Stdio::from(pair.slave.try_clone()?))
        .stdout(Stdio::from(pair.slave.try_clone()?))
        .stderr(Stdio::from(pair.slave));
    if let Some(v) = shell_var {
        cmd.env("SHELL", v);
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    // SAFETY: fork 와 exec 사이에서 async-signal-safe 한 시스템 콜만 부른다.
    unsafe {
        cmd.pre_exec(|| {
            nix::unistd::setsid()?;
            if libc::ioctl(0, libc::TIOCSCTTY as _, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let child = cmd
        .spawn()
        .with_context(|| format!("cannot spawn {}", shell.display()))?;

    let reader = File::from(pair.master.try_clone()?);
    let writer = File::from(pair.master.try_clone()?);
    Ok(Spawned {
        master: Master { fd: pair.master },
        tty,
        child,
        reader,
        writer,
    })
}

impl Master {
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let ws = winsize(cols, rows);
        // SAFETY: master 는 살아 있고 TIOCSWINSZ 는 winsize 를 읽기만 한다.
        if unsafe { libc::ioctl(self.fd.as_raw_fd(), libc::TIOCSWINSZ, &ws) } == -1 {
            bail!("TIOCSWINSZ failed: {}", std::io::Error::last_os_error());
        }
        Ok(())
    }

    /// foreground 그룹은 master/slave 가 공유하는 터미널 상태라 master 로 읽힌다.
    pub fn foreground_pgid(&self) -> Option<i32> {
        nix::unistd::tcgetpgrp(&self.fd).ok().map(|p| p.as_raw())
    }
}
