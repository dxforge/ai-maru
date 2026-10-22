use clap::{CommandFactory, Parser};
use maru_session::server::{self, Options};
use std::io::Write;
use std::process::ExitCode;

/// Session process that holds one terminal.
#[derive(Parser)]
#[command(version)]
struct Args {
    /// Print the session protocol version and exit.
    #[arg(long, exclusive = true)]
    protocol_version: bool,
    #[command(flatten)]
    opts: Option<Options>,
}

fn main() -> ExitCode {
    let args = Args::parse();
    if args.protocol_version {
        let _ = writeln!(std::io::stdout(), "{}", maru_session::PROTOCOL_VERSION);
        return ExitCode::SUCCESS;
    }
    let Some(opts) = args.opts else {
        Args::command()
            .error(
                clap::error::ErrorKind::MissingRequiredArgument,
                "--dir and --id are required",
            )
            .exit()
    };

    let _ = nix::unistd::setsid();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("cannot create the tokio runtime");
    match runtime.block_on(server::run(opts)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let _ = writeln!(std::io::stderr(), "maru-session: {e:#}");
            ExitCode::FAILURE
        }
    }
}
