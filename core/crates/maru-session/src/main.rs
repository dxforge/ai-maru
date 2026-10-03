use clap::Parser;
use maru_session::server::{self, Options};
use std::io::Write;
use std::process::ExitCode;

/// 터미널 하나를 들고 있는 세션 프로세스.
#[derive(Parser)]
#[command(version)]
struct Args {
    #[command(flatten)]
    opts: Options,
}

fn main() -> ExitCode {
    let Args { opts } = Args::parse();

    let _ = nix::unistd::setsid();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio 런타임을 만들 수 없다");
    match runtime.block_on(server::run(opts)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let _ = writeln!(std::io::stderr(), "maru-session: {e:#}");
            ExitCode::FAILURE
        }
    }
}
