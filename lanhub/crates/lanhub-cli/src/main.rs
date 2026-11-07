use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use lanhub_core::admin_server::{AdminSource, token_hash};
use lanhub_core::config::{self, ADMIN_TOKEN_MIN, AdminSettings, Config, HubSettings, TlsSettings};
use lanhub_core::config_file::ConfigFile;
use lanhub_core::diagnose::{self, Status};
use lanhub_core::{Hub, HubConfig, identity, logs};

#[cfg(windows)]
mod service;

const USAGE: &str = "Dùng: lanhub-cli [--config lanhub.toml] [--port 8200] [--host 0.0.0.0] [--name TÊN_HUB] [--log-format json] [--stop-on-stdin-close] [--discovery-port 8201] [--no-discovery] [--no-history] [--history-idle-ms N]
  hoặc một dự án: lanhub-cli --root <thư mục dự án> [--project TÊN] [--token BÍ_MẬT] [--history DIR] [--allow-file FILE] [--exclude \"a,b\"] [--tls | --tls-cert CERT.pem --tls-key KEY.pem] cùng các tham số trên
  dịch vụ Windows: thêm --service vào binPath khi tạo dịch vụ bằng sc.exe
  quản trị từ xa: thêm --admin-token TOKEN (hoặc biến môi trường LANHUB_ADMIN_TOKEN); lanhub-cli --hash-admin-token TOKEN in giá trị token_sha256 cho [hub.admin]
  tự kiểm tra (chỉ đọc): lanhub-cli --diagnose [--config lanhub.toml | --root <thư mục>] [--port 8200] [--host 0.0.0.0] [--discovery-port 8201] [--no-discovery] [--tls]";
const WATCH_EVERY: Duration = Duration::from_millis(100);
const DEBOUNCE: Duration = Duration::from_millis(300);

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

/// Hub settings given on the command line. In config mode they win over the file at every apply.
struct Overrides {
    port: Option<u16>,
    host: Option<String>,
    name: Option<String>,
    /// `Some(None)` is `--no-discovery`.
    discovery_port: Option<Option<u16>>,
    /// Debug builds: `LANHUB_DEBUG_CRASH=<project>:<path>` sets that project's crash hook.
    crash: Option<(String, String)>,
    no_history: bool,
    history_idle_ms: Option<u64>,
    /// `--admin-token` or `LANHUB_ADMIN_TOKEN`: remote admin on with this token, whatever `[hub.admin]` says.
    admin: Option<AdminSettings>,
}

impl Overrides {
    fn apply_hub(&self, hub: &mut HubSettings) {
        if let Some(p) = self.port {
            hub.port = p;
        }
        if let Some(h) = &self.host {
            hub.bind = h.clone();
        }
        if let Some(n) = &self.name {
            hub.name = Some(n.clone());
        }
        match self.discovery_port {
            Some(None) => hub.discovery = false,
            Some(Some(p)) => {
                hub.discovery = true;
                hub.discovery_port = p;
            }
            None => {}
        }
        if let Some(a) = &self.admin {
            hub.admin = a.clone();
        }
    }

    fn apply(&self, mut cfg: Config) -> Config {
        self.apply_hub(&mut cfg.hub);
        for p in &mut cfg.projects {
            if self.no_history {
                p.history.enabled = false;
            }
            if self.history_idle_ms.is_some() {
                p.history.idle_ms = self.history_idle_ms;
            }
        }
        if let Some((project, path)) = &self.crash {
            for p in &mut cfg.projects {
                if p.name.to_lowercase() == project.to_lowercase() {
                    p.debug.crash_path = Some(path.clone());
                }
            }
        }
        cfg
    }
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    if argv.iter().any(|a| a == "--service") {
        return service::dispatch(argv);
    }
    run(argv)
}

fn run(argv: Vec<String>) -> ExitCode {
    if matches!(argv.as_slice(), [flag] if flag == "--version" || flag == "-V") {
        println!("lanhub-cli {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    let a = parse_args(&argv);
    let value = |k: &str| a.get(k).cloned().flatten().filter(|v| !v.is_empty());
    if a.contains_key("hash-admin-token") {
        return match value("hash-admin-token") {
            Some(t) if t.chars().count() >= ADMIN_TOKEN_MIN => {
                println!(
                    "token_sha256 = \"{}\"",
                    lanhub_core::util::hex(&token_hash(&t))
                );
                ExitCode::SUCCESS
            }
            _ => {
                eprintln!("Token quản trị cần ít nhất {ADMIN_TOKEN_MIN} ký tự");
                ExitCode::from(1)
            }
        };
    }
    let admin = match value("admin-token").or_else(|| {
        std::env::var("LANHUB_ADMIN_TOKEN")
            .ok()
            .filter(|v| !v.is_empty())
    }) {
        None => None,
        Some(t) if t.chars().count() >= ADMIN_TOKEN_MIN => Some(AdminSettings {
            remote: true,
            token_sha256: Some(token_hash(&t)),
        }),
        Some(_) => {
            eprintln!("Không mở được hub: token quản trị cần ít nhất {ADMIN_TOKEN_MIN} ký tự");
            return ExitCode::from(1);
        }
    };
    let port = match value("port") {
        None => None,
        Some(p) => match p.parse::<u16>() {
            Ok(p) => Some(p),
            Err(_) => {
                eprintln!("Không mở được hub: cổng không hợp lệ \"{p}\"");
                return ExitCode::from(1);
            }
        },
    };
    // `a['no-discovery'] ? null : Number(a['discovery-port'] || 8201)`
    let no_discovery = a
        .get("no-discovery")
        .is_some_and(|v| v.as_deref() != Some(""));
    let discovery_port = if no_discovery {
        Some(None)
    } else {
        match value("discovery-port") {
            None => None,
            Some(p) => match p.parse::<u16>() {
                Ok(p) => Some(Some(p)),
                Err(_) => {
                    eprintln!("Không mở được hub: cổng UDP không hợp lệ \"{p}\"");
                    return ExitCode::from(1);
                }
            },
        }
    };
    // `--tls` alone generates a self-signed certificate; `--tls-cert` with `--tls-key` uses those files.
    let tls = match (value("tls-cert"), value("tls-key")) {
        (Some(c), Some(k)) => TlsSettings {
            enabled: true,
            cert: Some(std::path::absolute(&c).unwrap_or_else(|_| c.into())),
            key: Some(std::path::absolute(&k).unwrap_or_else(|_| k.into())),
        },
        (None, None) => TlsSettings {
            enabled: a.get("tls").is_some_and(|v| v.as_deref() != Some("")),
            ..TlsSettings::default()
        },
        _ => {
            eprintln!("Không mở được hub: --tls-cert và --tls-key phải đi cùng nhau");
            return ExitCode::from(1);
        }
    };
    if a.contains_key("diagnose") {
        return run_diagnose(&a, port, discovery_port, tls);
    }
    let json_log = value("log-format").as_deref() == Some("json");
    let no_history = a.contains_key("no-history");
    let history_idle_ms = match value("history-idle-ms") {
        None => None,
        Some(v) => match v.parse::<u64>() {
            Ok(ms) => Some(ms),
            Err(_) => {
                eprintln!("Không mở được hub: --history-idle-ms không hợp lệ \"{v}\"");
                return ExitCode::from(1);
            }
        },
    };
    let stop_on_stdin_close = a.contains_key("stop-on-stdin-close");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime starts");

    let Some(root) = value("root") else {
        let Some(file) = value("config")
            .map(PathBuf::from)
            .or_else(config::default_path)
        else {
            eprintln!("{USAGE}");
            return ExitCode::from(1);
        };
        if !a.contains_key("config") && !file.exists() {
            eprintln!("Không có file cấu hình {}\n{USAGE}", file.display());
            return ExitCode::from(1);
        }
        let crash = std::env::var("LANHUB_DEBUG_CRASH")
            .ok()
            .filter(|_| cfg!(debug_assertions))
            .and_then(|v| v.split_once(':').map(|(p, f)| (p.to_owned(), f.to_owned())));
        let overrides = Overrides {
            port,
            host: value("host"),
            name: value("name"),
            discovery_port,
            crash,
            no_history,
            history_idle_ms,
            admin,
        };
        return runtime.block_on(serve_config(file, overrides, json_log, stop_on_stdin_close));
    };
    let cfg = HubConfig {
        root: root.into(),
        port: port.unwrap_or(8200),
        host: value("host").unwrap_or_default(),
        project: value("project"),
        token: value("token")
            .or_else(|| std::env::var("LAN_COLLAB_TOKEN").ok())
            .unwrap_or_default(),
        allow_file: value("allow-file").map(Into::into),
        history: value("history").map(Into::into),
        no_history,
        history_idle_ms,
        exclude: value("exclude")
            .map(|e| e.split(',').map(str::to_owned).collect())
            .unwrap_or_default(),
        name: value("name"),
        discovery_port: discovery_port.unwrap_or(Some(lanhub_core::discovery::DEFAULT_PORT)),
        panic_path: None,
        tls,
        admin: admin.unwrap_or_default(),
    };
    runtime.block_on(async move {
        let hub = match lanhub_core::start(cfg).await {
            Ok(hub) => hub,
            Err(e) => {
                eprintln!("Không mở được hub: {e}");
                return ExitCode::from(1);
            }
        };
        if json_log {
            println!("{{\"event\":\"listening\",\"port\":{}}}", hub.port());
        }
        wait_for_stop(stop_on_stdin_close).await;
        hub.stop().await;
        ExitCode::SUCCESS
    })
}

/// `--diagnose`: the read-only checks of `lanhub_core::diagnose`, one line each. Exits 0 when none fails.
fn run_diagnose(
    a: &HashMap<String, Option<String>>,
    port: Option<u16>,
    discovery_port: Option<Option<u16>>,
    tls: TlsSettings,
) -> ExitCode {
    let value = |k: &str| a.get(k).cloned().flatten().filter(|v| !v.is_empty());
    let overrides = Overrides {
        port,
        host: value("host"),
        name: None,
        discovery_port,
        crash: None,
        no_history: false,
        history_idle_ms: None,
        admin: None,
    };
    let source = match value("root") {
        Some(root) => {
            let root = std::path::absolute(&root).unwrap_or_else(|_| root.into());
            diagnose::Source::Flags(HubSettings {
                state_dir: Some(root.join(".lan-collab")),
                tls: tls.clone(),
                ..HubSettings::default()
            })
        }
        None => match value("config")
            .map(PathBuf::from)
            .or_else(config::default_path)
        {
            Some(file) => diagnose::Source::File(file),
            None => diagnose::Source::File(PathBuf::from(config::FILE_NAME)),
        },
    };
    let checks = diagnose::run(source, |hub| {
        overrides.apply_hub(hub);
        if tls.enabled {
            hub.tls = tls.clone();
        }
    });
    for c in &checks {
        println!("{c}");
    }
    if checks.iter().any(|c| c.status == Status::Fail) {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

/// Multi-project mode: serves `file` and re-applies it whenever it changes. A file that does not parse
/// leaves the running config in place.
async fn serve_config(
    file: PathBuf,
    overrides: Overrides,
    json_log: bool,
    stop_on_stdin_close: bool,
) -> ExitCode {
    let file = std::path::absolute(&file).unwrap_or(file);
    // Taken before the read, so an edit saved while the projects load is applied once they run.
    let read_at = stamp(&file);
    let cfg = match config::load(&file) {
        Ok(c) => overrides.apply(c),
        Err(e) => {
            eprintln!("Không mở được hub: {e}");
            return ExitCode::from(1);
        }
    };
    let dir = file.parent().unwrap_or(Path::new("."));
    let instance_id = match identity::load_instance(dir) {
        Ok(id) => id,
        Err(e) => {
            eprintln!(
                "Không mở được hub: {}: {e}",
                dir.join("instance.json").display()
            );
            return ExitCode::from(1);
        }
    };
    logs::prefix_project(true);
    let hub = match Hub::start(cfg, instance_id).await {
        Ok((hub, _)) => hub,
        Err(e) => {
            eprintln!("Không mở được hub: {e}");
            return ExitCode::from(1);
        }
    };
    let overrides = Arc::new(overrides);
    let adjust = overrides.clone();
    hub.serve_admin(AdminSource::File {
        file: ConfigFile::new(file.clone()),
        adjust: Box::new(move |cfg| adjust.apply(cfg)),
    })
    .await;
    if json_log {
        println!("{{\"event\":\"listening\",\"port\":{}}}", hub.port());
    }
    tokio::select! {
        _ = watch(&file, read_at, &overrides, &hub) => {}
        _ = wait_for_stop(stop_on_stdin_close) => {}
    }
    hub.stop().await;
    ExitCode::SUCCESS
}

fn stamp(file: &Path) -> Option<(SystemTime, u64)> {
    let m = std::fs::metadata(file).ok()?;
    Some((m.modified().ok()?, m.len()))
}

/// Polls the file's time and size; once they have stayed put for `DEBOUNCE` after a change, re-applies
/// the file.
async fn watch(file: &Path, read_at: Option<(SystemTime, u64)>, overrides: &Overrides, hub: &Hub) {
    let mut last = read_at;
    let mut changed: Option<Instant> = None;
    loop {
        tokio::time::sleep(WATCH_EVERY).await;
        let now = stamp(file);
        if now != last {
            last = now;
            changed = Some(Instant::now());
            continue;
        }
        if !changed.is_some_and(|t| t.elapsed() >= DEBOUNCE) {
            continue;
        }
        changed = None;
        match config::load(file) {
            Ok(cfg) => {
                let report = hub.apply(overrides.apply(cfg)).await;
                if report.events.is_empty() {
                    logs::log_in(None, "Đã đọc lại cấu hình: không có gì thay đổi");
                }
            }
            Err(e) => logs::log_in(
                None,
                &format!("[LỖI] Cấu hình không hợp lệ, hub vẫn chạy theo cấu hình trước: {e}"),
            ),
        }
    }
}

/// Ctrl+C, Ctrl+Break, closing the console, Windows sign-out or shutdown, SIGTERM, or (with
/// `--stop-on-stdin-close`) the end of stdin.
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
        // Tokio's handler holds the console event until this process exits, so the files are written before
        // Windows ends it (5 seconds after a close, the session timeout at sign-out or shutdown).
        let (mut brk, mut close) = (windows::ctrl_break().ok(), windows::ctrl_close().ok());
        let (mut logoff, mut shutdown) =
            (windows::ctrl_logoff().ok(), windows::ctrl_shutdown().ok());
        tokio::select! {
            _ = ctrl_c => {}
            _ = rx.recv() => {}
            _ = service::STOP.notified() => {}
            Some(_) = async { match brk.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
            Some(_) = async { match close.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
            Some(_) = async { match logoff.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
            Some(_) = async { match shutdown.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
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
