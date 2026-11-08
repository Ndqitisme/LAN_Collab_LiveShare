//! The hub this app runs, and every change to it. Edits are serialized: each one re-reads `lanhub.toml`,
//! writes the validated result, then applies it to the running hub, so the file and the hub never disagree
//! for longer than one apply. Reads for the UI go through `AdminApi`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use lanhub_core::admin::{AdminApi, LegacyProject, LocalAdmin};
use lanhub_core::config::{Config, ConfigError};
use lanhub_core::history::{HistoryUsage, RetentionReport};
use lanhub_core::logs::LogRecord;
use lanhub_core::project::ClientInfo;
use lanhub_core::registry::{AdminError, InviteCodes, ProjectState, ProjectStatus, Registry};
use lanhub_core::{Hub, identity, logs, util};
use tokio::sync::Notify;

use crate::config_file::{
    AppError, ConfigFile, HistoryInput, HubInput, ImportInput, ProjectInput, check_hub,
    exclude_preview, project_config,
};
pub use crate::config_file::{
    ExcludePreview, HubSettingsView, InviteView, PREVIEW_MAX, ProjectSettings,
};
use crate::status::Snapshot;

/// An `AdminApi` failure, of this machine's hub or a remote one, as the UI shows it.
pub fn admin_error(e: AdminError) -> AppError {
    match e {
        AdminError::UnknownProject(name) => AppError::new("unknownProject").param("name", name),
        AdminError::NotRunning(name) => AppError::new("notRunning").param("name", name),
        AdminError::Remote(f) => crate::remote::app_error(f),
    }
}

/// A retention pass as the History tab reports it.
pub fn retention_result(
    result: Option<Result<RetentionReport, String>>,
) -> Result<RetentionReport, AppError> {
    match result {
        Some(Ok(report)) => Ok(report),
        Some(Err(_)) => Err(AppError::new("retentionFailed")),
        None => Err(AppError::new("historyOff")),
    }
}

/// A scan of a 0.1 hub folder as the import screen reports it; `dir` names the folder in the message.
pub fn legacy_result(
    dir: &Path,
    result: std::io::Result<Vec<LegacyProject>>,
) -> Result<Vec<LegacyProject>, AppError> {
    result.map_err(|e| {
        logs::log_in(
            None,
            &format!("[LỖI] Không đọc được thư mục {}: {e}", dir.display()),
        );
        AppError::new("legacyUnreadable").param("path", dir.display().to_string())
    })
}

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
                let _ = live.admin.apply_config(cfg).await;
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
        self.edit_returning(|f| change(f).map(|c| (c, ()))).await
    }

    async fn edit_returning<T>(
        &self,
        change: impl FnOnce(&ConfigFile) -> Result<(Config, T), AppError>,
    ) -> Result<T, AppError> {
        let _edit = self.edit.lock().await;
        if self.quitting.load(Ordering::Relaxed) {
            return Err(AppError::new("hubDown"));
        }
        let (cfg, out) = change(&self.file)?;
        self.facts().config_error = None;
        self.run(cfg).await;
        Ok(out)
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
        Ok(HubSettingsView::new(&hub, fingerprint))
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
    pub async fn all_invite_codes(&self) -> Result<Vec<InviteView>, AppError> {
        let live = self.live().ok_or_else(|| AppError::new("hubDown"))?;
        let mut out = Vec::new();
        for p in live.admin.list_projects().await.unwrap_or_default() {
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
            Some(l) => Some(l.admin.list_projects().await.unwrap_or_default()),
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
        self.invite_codes(name)
            .await?
            .code
            .ok_or_else(|| AppError::new("noAddress"))
    }

    pub async fn invite_codes(&self, name: &str) -> Result<InviteCodes, AppError> {
        let live = self.live().ok_or_else(|| AppError::new("hubDown"))?;
        live.admin.invite_codes(name).await.map_err(admin_error)
    }

    pub fn project_settings(&self, name: &str) -> Result<ProjectSettings, AppError> {
        let f = self.facts();
        let cfg = f
            .config
            .as_ref()
            .ok_or_else(|| AppError::new("unknownProject").param("name", name))?;
        ProjectSettings::of(cfg, name)
    }

    /// A new token, written to the file and in force for the next join. Members already in stay.
    pub async fn rotate_token(&self, name: &str) -> Result<String, AppError> {
        self.edit_returning(|f| {
            let token = util::random_hex::<16>();
            f.set_token(name, &token).map(|c| (c, token))
        })
        .await
    }

    pub async fn set_allow(&self, name: &str, lines: &[String]) -> Result<(), AppError> {
        self.edit_with(|f| f.set_allow(name, lines)).await
    }

    pub async fn set_exclude(&self, name: &str, lines: &[String]) -> Result<(), AppError> {
        self.edit_with(|f| f.set_exclude(name, lines)).await
    }

    pub async fn set_history(&self, name: &str, h: &HistoryInput) -> Result<(), AppError> {
        self.edit_with(|f| f.set_history(name, h)).await
    }

    /// The files under the project root that `lines` would stop syncing, among those the default patterns
    /// leave in.
    pub async fn preview_exclude(
        &self,
        name: &str,
        lines: Vec<String>,
    ) -> Result<ExcludePreview, AppError> {
        let root = {
            let f = self.facts();
            let cfg = f
                .config
                .as_ref()
                .ok_or_else(|| AppError::new("unknownProject").param("name", name))?;
            project_config(cfg, name)?.root.clone()
        };
        tokio::task::spawn_blocking(move || exclude_preview(&root, &lines))
            .await
            .map_err(|_| AppError::new("generic"))?
    }

    pub async fn clients(&self, name: &str) -> Result<Vec<ClientInfo>, AppError> {
        let live = self.live().ok_or_else(|| AppError::new("hubDown"))?;
        live.admin.clients(name).await.map_err(admin_error)
    }

    /// `None` when the project runs without history.
    pub async fn history_usage(&self, name: &str) -> Result<Option<HistoryUsage>, AppError> {
        let live = self.live().ok_or_else(|| AppError::new("hubDown"))?;
        live.admin.history_usage(name).await.map_err(admin_error)
    }

    pub async fn run_retention(&self, name: &str) -> Result<RetentionReport, AppError> {
        let live = self.live().ok_or_else(|| AppError::new("hubDown"))?;
        retention_result(live.admin.run_retention(name).await.map_err(admin_error)?)
    }

    pub fn logs(&self, after: u64, limit: usize) -> Vec<LogRecord> {
        logs::since(after, limit)
    }

    pub async fn scan_legacy(&self, dir: &Path) -> Result<Vec<LegacyProject>, AppError> {
        let live = self.live().ok_or_else(|| AppError::new("hubDown"))?;
        legacy_result(
            dir,
            live.admin.import_legacy(dir).await.map_err(admin_error)?,
        )
    }

    /// Adds the projects whose names are new, in one write. Returns the names added.
    pub async fn import_legacy(&self, items: &[ImportInput]) -> Result<Vec<String>, AppError> {
        self.edit_returning(|f| f.import_projects(items)).await
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
