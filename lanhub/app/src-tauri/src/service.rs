//! The hub this app runs, and every change to it. Edits are serialized: each one re-reads `lanhub.toml`,
//! writes the validated result, then applies it to the running hub, so the file and the hub never disagree
//! for longer than one apply. Reads for the UI go through `AdminApi`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use lanhub_core::admin::{AdminApi, LocalAdmin};
use lanhub_core::config::{Config, ConfigError};
use lanhub_core::registry::{ProjectStatus, Registry};
use lanhub_core::{Hub, identity, invite, logs, util};
use tokio::sync::Notify;

use crate::config_file::{AppError, ConfigFile, ProjectInput};
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
