//! The LAN Hub server: one project served over NDJSON on TCP, at protocol 2 parity with `hub/hub.js`.

pub mod allow;
pub mod chat;
pub mod discovery;
pub mod exclude;
pub mod files;
pub mod flush;
pub mod framing;
pub mod identity;
pub mod invite;
pub mod paths;
pub mod presence;
pub mod project;
pub mod session;
pub mod util;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::exclude::{DEFAULT_EXCLUDE, Excluder};
use crate::files::{is_text, uniform_eol, walk};
use crate::project::{ActorMsg, LoadedFile, Project, ProjectInfo};
use crate::session::ProjectHandle;
use crate::util::{log, sha1_hex};

pub const HUB_VERSION: &str = concat!("lanhub ", env!("CARGO_PKG_VERSION"));
/// Messages waiting for the actor before readers are made to wait (TCP backpressure).
const INBOX: usize = 1024;

/// Single-project settings, as the Node hub's CLI flags give them.
#[derive(Debug, Clone, Default)]
pub struct HubConfig {
    pub root: PathBuf,
    pub port: u16,
    pub host: String,
    pub project: Option<String>,
    pub token: String,
    pub allow_file: Option<PathBuf>,
    pub history: Option<PathBuf>,
    pub exclude: Vec<String>,
    pub name: Option<String>,
    /// UDP discovery port; `None` binds no UDP socket (`--no-discovery`).
    pub discovery_port: Option<u16>,
    /// Debug builds only: a message about this path panics inside its handler (tests of the recovery).
    pub panic_path: Option<String>,
}

pub struct Hub {
    pub port: u16,
    inbox: mpsc::Sender<ActorMsg>,
    accept: JoinHandle<()>,
    actor: JoinHandle<()>,
    discovery: Option<JoinHandle<()>>,
}

impl Hub {
    /// Writes every pending file, then stops serving.
    pub async fn stop(self) {
        self.accept.abort();
        if let Some(d) = &self.discovery {
            d.abort();
        }
        let (done, wait) = oneshot::channel();
        if self.inbox.send(ActorMsg::Shutdown { done }).await.is_ok() {
            let _ = wait.await;
        }
        let _ = self.actor.await;
    }
}

/// Earlier versions kept history next to the project folder; it moves into `.lan-collab` once.
fn move_legacy_history(root: &Path, history: &Path) {
    let mut legacy = root.as_os_str().to_owned();
    legacy.push(".history");
    let legacy = PathBuf::from(legacy);
    if !legacy.exists() || history.exists() {
        return;
    }
    let moved = history
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|_| std::fs::rename(&legacy, history));
    match moved {
        Ok(()) => log(format!(
            "Đã dời lịch sử {} → {}",
            legacy.display(),
            history.display()
        )),
        Err(e) => log(format!(
            "[CẢNH BÁO] không dời được {} vào {}: {e} (vẫn dùng thư mục mới)",
            legacy.display(),
            history.display()
        )),
    }
}

fn load_files(root: &Path, excluder: &Excluder) -> Vec<LoadedFile> {
    let mut out = Vec::new();
    for (rel, abs) in walk(root, excluder) {
        let bytes = match std::fs::read(&abs) {
            Ok(b) => b,
            Err(e) => {
                log(format!("[LỖI] không đọc được {rel}: {e}"));
                continue;
            }
        };
        if is_text(&bytes, &rel) {
            let raw: Vec<u16> = std::str::from_utf8(&bytes)
                .expect("is_text checked UTF-8")
                .encode_utf16()
                .collect();
            let text = uniform_eol(&raw);
            out.push(LoadedFile {
                rewrite: text != raw,
                rel,
                text: Some(text),
                blob_hash: None,
            });
        } else {
            out.push(LoadedFile {
                rel,
                text: None,
                blob_hash: Some(sha1_hex(&bytes)),
                rewrite: false,
            });
        }
    }
    out
}

pub async fn start(cfg: HubConfig) -> std::io::Result<Hub> {
    std::fs::create_dir_all(&cfg.root)?;
    let root = std::path::absolute(&cfg.root)?;
    let history = match &cfg.history {
        Some(h) => std::path::absolute(h)?,
        None => root.join(".lan-collab").join("history"),
    };
    if cfg.history.is_none() {
        move_legacy_history(&root, &history);
    }
    let name = cfg
        .project
        .clone()
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| {
            root.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
    let mut patterns: Vec<String> = DEFAULT_EXCLUDE.iter().map(|s| (*s).to_owned()).collect();
    patterns.extend(cfg.exclude.iter().cloned());
    let excluder = Excluder::new(&patterns);
    let id = identity::load(&root)?;
    let hub_name = cfg
        .name
        .clone()
        .filter(|n| !n.is_empty())
        .unwrap_or_else(util::hostname);
    let loaded = load_files(&root, &excluder);
    let count = loaded.len();
    let chat = chat::load(&chat::log_path(&history));

    let host = if cfg.host.is_empty() {
        "0.0.0.0"
    } else {
        cfg.host.as_str()
    };
    let listener = TcpListener::bind((host, cfg.port)).await?;
    let port = listener.local_addr()?.port();
    log(format!(
        "LAN Collab hub — dự án \"{name}\" — thư mục {} — cổng {port} — {count} file",
        root.display()
    ));
    if let Some(f) = &cfg.allow_file {
        log(format!(
            "Danh sách tài khoản được vào: {} (trống hoặc không có file = ai có token cũng vào được)",
            f.display()
        ));
    }
    log_invites(&id.instance_id, port, &name, &cfg.token);

    let projects = vec![name.clone()];
    let discovery = match cfg.discovery_port {
        None => None,
        Some(udp) => match discovery::bind(udp).await {
            Ok(sock) => {
                log(format!("Cho máy khác tự tìm hub: UDP cổng {udp}"));
                let reply = serde_json::to_vec(&discovery::Here {
                    t: "lanhub_here",
                    v: 2,
                    instance_id: &id.instance_id,
                    hub_name: &hub_name,
                    port,
                    tls: false,
                    projects: &projects,
                })
                .expect("the reply serializes");
                Some(discovery::serve(sock, reply))
            }
            Err(e) => {
                log(format!(
                    "[CẢNH BÁO] không mở được cổng UDP {udp} để máy khác tự tìm thấy hub: {e}. Hub vẫn chạy; máy khác vào bằng mã mời."
                ));
                None
            }
        },
    };
    let mut features = vec!["chat-image".to_owned()];
    if discovery.is_some() {
        features.push("discovery".to_owned());
    }
    let info = Arc::new(ProjectInfo {
        name,
        token: cfg.token.clone(),
        hub_id: id.hub_id,
        instance_id: id.instance_id,
        hub_name,
        hub_version: HUB_VERSION.to_owned(),
        exclude: patterns,
        features,
        allow_file: cfg.allow_file.clone(),
    });

    let (inbox, rx) = mpsc::channel(INBOX);
    let project = Project::new(
        info.clone(),
        root,
        excluder,
        loaded,
        history,
        chat,
        cfg.panic_path.clone(),
    );
    let actor = tokio::spawn(project.run(rx));
    let handle = ProjectHandle {
        info,
        inbox: inbox.clone(),
    };
    let accept = tokio::spawn(async move {
        let next_key = AtomicU64::new(1);
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    let key = next_key.fetch_add(1, Ordering::Relaxed);
                    tokio::spawn(session::serve(stream, addr, handle.clone(), key));
                }
                Err(e) => {
                    log(format!("[LỖI] không nhận được kết nối: {e}"));
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
    });
    Ok(Hub {
        port,
        inbox,
        accept,
        actor,
        discovery,
    })
}

/// The invite lines of the Node hub: one legacy `LC-` code per address for 0.1.1 extensions, then one
/// `LC3-` code with every address. A machine with no LAN address prints none.
fn log_invites(instance_id: &str, port: u16, project: &str, token: &str) {
    let ips = util::ipv4_addresses();
    for ip in &ips {
        log(format!(
            "Mã mời ({ip}): {}",
            invite::encode_v1(*ip, port, project, token)
        ));
    }
    if !ips.is_empty() {
        let hosts: Vec<String> = ips.iter().map(ToString::to_string).collect();
        log(format!(
            "Mã mời: {}",
            invite::encode_v3(instance_id, &hosts, port, project, token)
        ));
    }
}
