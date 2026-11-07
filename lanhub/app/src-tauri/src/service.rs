//! The hub this app runs, and every change to it. Edits are serialized: each one re-reads `lanhub.toml`,
//! writes the validated result, then applies it to the running hub, so the file and the hub never disagree
//! for longer than one apply. Reads for the UI go through `AdminApi`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use lanhub_core::admin::{AdminApi, LocalAdmin};
use lanhub_core::config::{Config, ConfigError, HubSettings};
use lanhub_core::registry::{ProjectState, ProjectStatus, Registry};
use lanhub_core::{Hub, identity, invite, logs, tls, util};
use serde::Serialize;
use tokio::sync::Notify;

use crate::config_file::{AppError, ConfigFile, HubInput, ProjectInput};
use crate::status::Snapshot;

#[derive(Clone)]
struct Live {
    admin: LocalAdmin,
    registry: Registry,
}

#[derive(Default)]
struct Facts {
    /// The config the hub runs, or would run once its port opens.
    config: Option<Config>,
    config_error: Option<ConfigError>,
    /// The port that could not be opened.
    bind_error: Option<u16>,
}

/// What the status view is built from, taken in one go.
pub struct Inputs {
    pub config: Option<Config>,
    pub config_error: Option<ConfigError>,
    pub bind_error: Option<u16>,
    pub port: Option<u16>,
    /// `None` until the hub runs.
    pub statuses: Option<Vec<ProjectStatus>>,
}

pub struct AppCore {
    file: ConfigFile,
    instance_id: String,
    edit: tokio::sync::Mutex<()>,
    live: RwLock<Option<Live>>,
    facts: Mutex<Facts>,
    quitting: AtomicBool,
    /// Woken by project events, so the status view does not wait for its next tick.
    pub wake: Arc<Notify>,
    pub latest: Mutex<Option<Snapshot>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubSettingsView {
    pub name: String,
    /// What the hub calls itself while `name` is empty.
    pub hostname: String,
    pub bind: String,
    pub port: u16,
    pub discovery: bool,
    pub discovery_port: u16,
    pub tls: bool,
    pub tls_cert: String,
    pub tls_key: String,
    pub public_address: Vec<String>,
    /// SHA-256 of the certificate the hub serves; `None` while TLS is off.
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct InviteView {
    pub name: String,
    pub code: String,
}

/// Refuses settings that the running hub would only log and skip: a port it cannot open, a certificate it
/// cannot load. `running` is the `[hub]` the hub runs now; unchanged parts are not checked again.
fn check_hub(new: &HubSettings, running: Option<&HubSettings>) -> Result<(), AppError> {
    let moved = running.is_none_or(|r| r.bind != new.bind || r.port != new.port);
    if moved && let Err(e) = std::net::TcpListener::bind((new.bind.as_str(), new.port)) {
        logs::log_in(
            None,
            &format!("[LỖI] Không mở được {}:{}: {e}", new.bind, new.port),
        );
        return Err(AppError::field("portBusy", "port").param("port", new.port.to_string()));
    }
    let tls_changed = running.is_none_or(|r| r.tls != new.tls || r.state_dir != new.state_dir);
    if new.tls.enabled
        && tls_changed
        && let Err(e) = tls::load_or_create(&new.tls, new.state_dir.as_deref())
    {
        logs::log_in(None, &format!("[LỖI] Không bật được TLS: {e}"));
        return Err(AppError::field("tlsFailed", "tls"));
    }
    Ok(())
}

/// `--config <file>`, then `LANHUB_CONFIG`, then the platform default of the hub.
pub fn config_path(args: &[String]) -> Option<PathBuf> {
    let flag = args
        .iter()
        .position(|a| a == "--config")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from);
    flag.or_else(|| {
        std::env::var_os("LANHUB_CONFIG")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    })
    .or_else(lanhub_core::config::default_path)
    .map(|p| std::path::absolute(&p).unwrap_or(p))
}

impl AppCore {
    pub fn new(path: PathBuf) -> AppCore {
        let dir = path.parent().map(PathBuf::from).unwrap_or_default();
        let instance_id = identity::load_instance(&dir).unwrap_or_else(|e| {
            logs::log_in(
                None,
                &format!(
                    "[LỖI] Không ghi được {}: {e}. Mã mời đổi sau mỗi lần khởi động.",
                    dir.join("instance.json").display()
                ),
            );
            util::random_uuid()
        });
        AppCore {
            file: ConfigFile::new(path),
            instance_id,
            edit: tokio::sync::Mutex::new(()),
            live: RwLock::new(None),
            facts: Mutex::new(Facts::default()),
            quitting: AtomicBool::new(false),
            wake: Arc::new(Notify::new()),
            latest: Mutex::new(None),
        }
    }

    pub fn config_path(&self) -> &std::path::Path {
        self.file.path()
    }

    fn live(&self) -> Option<Live> {
        self.live.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn facts(&self) -> std::sync::MutexGuard<'_, Facts> {
        self.facts.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reads the file and makes the hub match it. Also the retry after a config or port error.
    pub async fn reload(&self) {
        let _edit = self.edit.lock().await;
        if self.quitting.load(Ordering::Relaxed) {
            return;
        }
        match self.file.load() {
            Ok(cfg) => {
                self.facts().config_error = None;
                self.run(cfg).await;
            }
            Err(e) => {
                logs::log_in(None, &format!("[LỖI] Cấu hình không hợp lệ: {e}"));
                self.facts().config_error = Some(e);
                self.wake.notify_one();
            }
        }
    }

    /// Applies `cfg` to the running hub, or starts the hub when it is not running yet. Called with the edit
    /// lock held.
    async fn run(&self, cfg: Config) {
        let port = cfg.hub.port;
        self.facts().config = Some(cfg.clone());
        match self.live() {
            Some(live) => {
                live.admin.apply_config(cfg).await;
            }
            None => match Hub::start(cfg, self.instance_id.clone()).await {
                Ok((hub, _)) => {
                    let registry = hub.registry().clone();
                    let mut events = registry.subscribe();
                    let wake = self.wake.clone();
                    tokio::spawn(async move {
                        use tokio::sync::broadcast::error::RecvError;
                        while !matches!(events.recv().await, Err(RecvError::Closed)) {
                            wake.notify_one();
                        }
                    });
                    *self.live.write().unwrap_or_else(|e| e.into_inner()) = Some(Live {
                        admin: hub.admin(),
                        registry,
                    });
                    self.facts().bind_error = None;
                }
                Err(e) => {
                    logs::log_in(None, &format!("[LỖI] Không mở được cổng {port}: {e}"));
                    self.facts().bind_error = Some(port);
                }
            },
        }
        self.wake.notify_one();
    }

    async fn edit_with(
        &self,
        change: impl FnOnce(&ConfigFile) -> Result<Config, AppError>,
    ) -> Result<(), AppError> {
        let _edit = self.edit.lock().await;
        if self.quitting.load(Ordering::Relaxed) {
            return Err(AppError::new("hubDown"));
        }
        let cfg = change(&self.file)?;
        self.facts().config_error = None;
        self.run(cfg).await;
        Ok(())
    }

    pub async fn add_project(&self, input: &ProjectInput) -> Result<(), AppError> {
        self.edit_with(|f| f.add_project(input)).await
    }

    pub async fn update_project(
        &self,
        original: &str,
        input: &ProjectInput,
    ) -> Result<(), AppError> {
        self.edit_with(|f| f.update_project(original, input)).await
    }

    pub async fn set_enabled(&self, name: &str, enabled: bool) -> Result<(), AppError> {
        self.edit_with(|f| f.set_enabled(name, enabled)).await
    }

    pub async fn remove_project(&self, name: &str) -> Result<(), AppError> {
        self.edit_with(|f| f.remove_project(name)).await
    }

    /// Writes and applies the `[hub]` settings. A new port is opened once before the file is written and a
    /// TLS certificate is loaded (generated the first time), so a failure names its field and changes nothing.
    pub async fn update_hub(&self, input: &HubInput) -> Result<(), AppError> {
        let running = self.facts().config.as_ref().map(|c| c.hub.clone());
        self.edit_with(|f| f.update_hub(input, |cfg| check_hub(&cfg.hub, running.as_ref())))
            .await
    }

    /// The `[hub]` settings the hub runs, with the fingerprint of the certificate it serves.
    pub async fn hub_settings(&self) -> Result<HubSettingsView, AppError> {
        let hub = self
            .facts()
            .config
            .as_ref()
            .map(|c| c.hub.clone())
            .ok_or_else(|| AppError::new("configInvalid"))?;
        let fingerprint = match self.live() {
            Some(l) => l.registry.tls_fingerprint().await,
            None => None,
        };
        let path = |p: &Option<PathBuf>| {
            p.as_ref()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        Ok(HubSettingsView {
            name: hub.name.clone().unwrap_or_default(),
            hostname: util::hostname(),
            bind: hub.bind.clone(),
            port: hub.port,
            discovery: hub.discovery,
            discovery_port: hub.discovery_port,
            tls: hub.tls.enabled,
            tls_cert: path(&hub.tls.cert),
            tls_key: path(&hub.tls.key),
            public_address: hub.public_address.clone(),
            fingerprint,
        })
    }

    /// The TCP port the hub listens on (the configured one until it runs) and the discovery port while
    /// discovery is on: what the firewall has to let in.
    pub fn ports(&self) -> Option<(u16, Option<u16>)> {
        let live = self.live().map(|l| l.registry.port());
        let f = self.facts();
        let hub = &f.config.as_ref()?.hub;
        Some((
            live.unwrap_or(hub.port),
            hub.discovery.then_some(hub.discovery_port),
        ))
    }

    /// The invite code of every running project, in config order.
    pub async fn invite_codes(&self) -> Result<Vec<InviteView>, AppError> {
        let live = self.live().ok_or_else(|| AppError::new("hubDown"))?;
        let mut out = Vec::new();
        for p in live.admin.list_projects().await {
            if p.state == ProjectState::Running {
                let code = self.invite_code(&p.name).await?;
                out.push(InviteView { name: p.name, code });
            }
        }
        Ok(out)
    }

    pub async fn inputs(&self) -> Inputs {
        let live = self.live();
        let statuses = match &live {
            Some(l) => Some(l.admin.list_projects().await),
            None => None,
        };
        let f = self.facts();
        Inputs {
            config: f.config.clone(),
            config_error: f.config_error.clone(),
            bind_error: f.bind_error,
            port: live.map(|l| l.registry.port()),
            statuses,
        }
    }

    /// The `LC3-` code of the project: the configured public addresses first, then every IPv4 address of
    /// this machine.
    pub async fn invite_code(&self, name: &str) -> Result<String, AppError> {
        let live = self.live().ok_or_else(|| AppError::new("hubDown"))?;
        let status = live
            .admin
            .project_status(name)
            .await
            .ok_or_else(|| AppError::new("unknownProject").param("name", name))?;
        let public = self
            .facts()
            .config
            .as_ref()
            .map(|c| c.hub.public_address.clone())
            .unwrap_or_default();
        let hosts: Vec<String> = public
            .into_iter()
            .chain(util::ipv4_addresses().iter().map(ToString::to_string))
            .collect();
        if hosts.is_empty() {
            return Err(AppError::new("noAddress"));
        }
        let fingerprint = live.registry.tls_fingerprint().await;
        Ok(invite::encode_v3(
            &self.instance_id,
            &hosts,
            live.registry.port(),
            &status.name,
            &status.token,
            fingerprint.as_deref(),
        ))
    }

    /// Refuses further edits, waits for one in progress, then writes every pending file and stops serving.
    pub async fn shutdown(&self) {
        self.quitting.store(true, Ordering::Relaxed);
        let _edit = self.edit.lock().await;
        let live = self.live.write().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(live) = live {
            live.registry.stop().await;
            logs::log_in(None, "Đã ghi mọi file và dừng LAN Hub");
        }
    }
}
