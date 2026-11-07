use std::collections::HashMap;
use std::process::ExitCode;

use lanhub_core::HubConfig;

const USAGE: &str = "Dùng: lanhub-cli --root <thư mục dự án> [--port 8200] [--host 0.0.0.0] [--project TÊN] [--token BÍ_MẬT] [--history DIR] [--allow-file FILE] [--exclude \"a,b\"] [--name TÊN_HUB] [--log-format json] [--stop-on-stdin-close] [--discovery-port 8201] [--no-discovery]";

/// `parseArgs` of `hub/hub.js`: `--key=value`, `--key value`, or `--key` alone (followed by another
/// `--flag` or nothing) meaning true. Anything else is ignored.
fn parse_args(argv: &[String]) -> HashMap<String, Option<String>> {
    let mut out = HashMap::new();
    let mut i = 0;
    while i < argv.len() {
        if let Some(flag) = argv[i].strip_prefix("--").filter(|f| !f.is_empty()) {
            match flag.split_once('=') {
                Some((k, v)) => {
                    out.insert(k.to_owned(), Some(v.to_owned()));
                }
                None => match argv.get(i + 1) {
                    Some(next) if !next.starts_with("--") => {
                        out.insert(flag.to_owned(), Some(next.clone()));
                        i += 1;
                    }
                    _ => {
                        out.insert(flag.to_owned(), None);
                    }
                },
            }
        }
        i += 1;
    }
    out
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if matches!(argv.as_slice(), [flag] if flag == "--version" || flag == "-V") {
        println!("lanhub-cli {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    let a = parse_args(&argv);
    let value = |k: &str| a.get(k).cloned().flatten().filter(|v| !v.is_empty());
    let Some(root) = value("root") else {
        eprintln!("{USAGE}");
        return ExitCode::from(1);
    };
    let port = match value("port") {
        None => 8200,
        Some(p) => match p.parse::<u16>() {
            Ok(p) => p,
            Err(_) => {
                eprintln!("Không mở được hub: cổng không hợp lệ \"{p}\"");
                return ExitCode::from(1);
            }
        },
    };
    let cfg = HubConfig {
        root: root.into(),
        port,
        host: value("host").unwrap_or_default(),
        project: value("project"),
        token: value("token")
            .or_else(|| std::env::var("LAN_COLLAB_TOKEN").ok())
            .unwrap_or_default(),
        allow_file: value("allow-file").map(Into::into),
        history: value("history").map(Into::into),
        exclude: value("exclude")
            .map(|e| e.split(',').map(str::to_owned).collect())
            .unwrap_or_default(),
        name: value("name"),
        panic_path: None,
    };
    let json_log = value("log-format").as_deref() == Some("json");
    let stop_on_stdin_close = a.contains_key("stop-on-stdin-close");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime starts");
    runtime.block_on(async move {
        let hub = match lanhub_core::start(cfg).await {
            Ok(hub) => hub,
            Err(e) => {
                eprintln!("Không mở được hub: {e}");
                return ExitCode::from(1);
            }
        };
        if json_log {
            println!("{{\"event\":\"listening\",\"port\":{}}}", hub.port);
        }
        wait_for_stop(stop_on_stdin_close).await;
        hub.stop().await;
        ExitCode::SUCCESS
    })
}

/// Ctrl+C, Ctrl+Break, closing the console, SIGTERM, or (with `--stop-on-stdin-close`) the end of stdin.
/// On Windows a parent process cannot send a catchable SIGINT, so closing stdin is the graceful stop for tests.
async fn wait_for_stop(stdin: bool) {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);
    if stdin {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut sink = std::io::sink();
            let _ = std::io::copy(&mut std::io::stdin().lock(), &mut sink);
            let _ = tx.blocking_send(());
        });
    }
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(windows)]
    {
        use tokio::signal::windows;
        let (mut brk, mut close) = (windows::ctrl_break().ok(), windows::ctrl_close().ok());
        tokio::select! {
            _ = ctrl_c => {}
            _ = rx.recv() => {}
            Some(_) = async { match brk.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
            Some(_) = async { match close.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
        }
    }
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate()).ok();
        let mut hup = signal(SignalKind::hangup()).ok();
        tokio::select! {
            _ = ctrl_c => {}
            _ = rx.recv() => {}
            Some(_) = async { match term.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
            Some(_) = async { match hup.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
        }
    }
}
