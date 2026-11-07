//! The LAN Hub server: many projects on one NDJSON-over-TCP port, at protocol 2 parity with `hub/hub.js`.
//! A `Config` (from `lanhub.toml`, or built from the single-project flags) says what runs.

pub mod admin;
pub mod allow;
pub mod chat;
pub mod config;
pub mod diagnose;
pub mod discovery;
pub mod exclude;
pub mod files;
pub mod flush;
pub mod framing;
pub mod http_diag;
pub mod identity;
pub mod invite;
pub mod logs;
pub mod paths;
pub mod presence;
pub mod project;
pub mod registry;
pub mod router;
pub mod session;
pub mod tls;
pub mod util;

use std::path::PathBuf;

use crate::admin::LocalAdmin;
use crate::config::{Config, HubSettings, ProjectConfig, TlsSettings};
use crate::registry::{ApplyReport, ProjectState, Registry};

pub const HUB_VERSION: &str = concat!("lanhub ", env!("CARGO_PKG_VERSION"));

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
    /// `--tls`, `--tls-cert`, `--tls-key`. A generated certificate goes into `<root>/.lan-collab`.
    pub tls: TlsSettings,
}

pub struct Hub {
    registry: Registry,
}

impl Hub {
    /// Binds the TCP port of `config.hub` and starts the enabled projects. Only a failed TCP bind is an
    /// error; a project that cannot start is reported failed in the registry.
    pub async fn start(config: Config, instance_id: String) -> std::io::Result<(Hub, ApplyReport)> {
        let (registry, report) = Registry::start(config, instance_id).await?;
        Ok((Hub { registry }, report))
    }

    pub fn port(&self) -> u16 {
        self.registry.port()
    }

    pub async fn apply(&self, config: Config) -> ApplyReport {
        self.registry.apply(config).await
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    pub fn admin(&self) -> LocalAdmin {
        LocalAdmin::new(self.registry.clone())
    }

    /// Writes every pending file, then stops serving.
    pub async fn stop(self) {
        self.registry.stop().await;
    }
}

/// The single-project mode of the CLI flags: a config of one project, on the folder's `hub.json`
/// instance id so it survives a restart as with the Node hub.
pub async fn start(cfg: HubConfig) -> std::io::Result<Hub> {
    std::fs::create_dir_all(&cfg.root)?;
    let root = std::path::absolute(&cfg.root)?;
    let name = cfg
        .project
        .clone()
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| {
            root.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
    let mut project = ProjectConfig::new(name, root.clone());
    project.token = cfg.token;
    project.allow_file = cfg.allow_file;
    project.history_dir = cfg
        .history
        .as_deref()
        .map(std::path::absolute)
        .transpose()?;
    project.exclude = cfg.exclude;
    project.debug.panic_path = cfg.panic_path;
    let config = Config {
        hub: HubSettings {
            name: cfg.name.filter(|n| !n.is_empty()),
            bind: if cfg.host.is_empty() {
                "0.0.0.0".to_owned()
            } else {
                cfg.host
            },
            port: cfg.port,
            discovery: cfg.discovery_port.is_some(),
            discovery_port: cfg.discovery_port.unwrap_or(discovery::DEFAULT_PORT),
            public_address: Vec::new(),
            tls: cfg.tls,
            state_dir: Some(root.join(".lan-collab")),
        },
        projects: vec![project],
    };
    let instance_id = identity::load(&root)?.instance_id;
    let (hub, _) = Hub::start(config, instance_id).await?;
    let failed = hub
        .registry
        .list_projects()
        .await
        .into_iter()
        .find(|p| p.state == ProjectState::Failed);
    if let Some(p) = failed {
        hub.stop().await;
        return Err(std::io::Error::other(p.error.unwrap_or_default()));
    }
    Ok(hub)
}
