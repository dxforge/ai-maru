use clap::Parser;
use maru_session::server::{self, Options};
use std::process::ExitCode;

/// 터미널 하나를 들고 있는 세션 프로세스.
///
/// 소켓 `<dir>/<id>.sock` 과 레코드 `<dir>/<id>.json` 을 만든다. 소켓이 connect 를 받기
/// 시작하면 준비된 것이다. 셸이 끝나거나, kill 요청이나 SIGTERM·SIGINT·SIGHUP 을 받으면
/// 셸을 정리하고 두 파일을 지운 뒤 끝난다.
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
            eprintln!("maru-session: {e:#}");
            ExitCode::FAILURE
        }
    }
}
