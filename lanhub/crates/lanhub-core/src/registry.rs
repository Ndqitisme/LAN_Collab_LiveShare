//! The running set of projects and the hub-level sockets, driven to match a `Config`. `apply` compares the
//! desired config with what runs and touches only what differs: a changed root or history folder restarts
//! that project, any other project setting reaches the running actor and the router, and a project whose
//! settings did not change keeps its actor and its members. Applying the same config again does nothing,
//! except that it restarts a project that failed.
//!
//! Each actor runs in its own task under a supervisor task. A panic that escapes the actor ends only that
//! task: the supervisor marks the project failed and takes it out of the router.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, AtomicUsize, Ordering};
use std::sync::{Arc, Weak};

use lanhub_protocol::AdminFailure;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast, mpsc, oneshot, watch};
use tokio::task::JoinHandle;

use crate::admin_server::{AdminDoor, HubAdmin};
use crate::config::{AdminSettings, Config, HubSettings, ProjectConfig, TlsSettings};
use crate::exclude::{DEFAULT_EXCLUDE, Excluder};
use crate::files::{is_text, uniform_eol, walk};
use crate::history::{HistoryUsage, RetentionReport};
use crate::logs::log_in;
use crate::project::{ActorMsg, ClientInfo, LoadedFile, Project, ProjectInfo, ProjectStats};
use crate::router::{self, Router, Table};
use crate::session::ProjectHandle;
use crate::tls::{CertSource, TlsIdentity};
use crate::util::{self, log, now_ms, random_hex, sha1_hex};
use crate::{HUB_VERSION, allow, chat, discovery, identity, invite, tls};

/// Messages waiting for an actor before readers are made to wait (TCP backpressure).
const INBOX: usize = 1024;
const EVENTS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Started,
    Stopped,
    Reconfigured,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectEvent {
    pub project: String,
    pub kind: EventKind,
    /// Why a project failed.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplyReport {
    pub events: Vec<ProjectEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectState {
    Running,
    Disabled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    pub name: String,
    pub root: PathBuf,
    pub state: ProjectState,
    pub error: Option<String>,
    pub hub_id: Option<String>,
    pub files: Option<usize>,
    pub clients: usize,
    /// Operations applied since the project started; a reader samples it for a rate.
    pub ops: u64,
    /// Milliseconds since the epoch of the last edit or member activity.
    pub last_activity: Option<u64>,
    pub advertise: bool,
    pub token: String,
    pub started_at: Option<u64>,
}

/// The invite codes of one project (`Registry::invite_codes`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCodes {
    /// The `LC3-` code; `None` when the hub knows no address to put in it.
    pub code: Option<String>,
    /// The addresses inside `code`, in the order a client tries them.
    pub hosts: Vec<String>,
    pub port: u16,
    pub tls: bool,
    /// One `LC-` code per IPv4 address, for 0.1 clients; empty with TLS on.
    pub legacy: Vec<LegacyInvite>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyInvite {
    pub host: String,
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdminError {
    UnknownProject(String),
    NotRunning(String),
    /// A remote hub could not be reached or refused the call (`admin_remote`).
    Remote(AdminFailure),
}

impl std::fmt::Display for AdminError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AdminError::UnknownProject(p) => write!(f, "no project named \"{p}\""),
            AdminError::NotRunning(p) => write!(f, "project \"{p}\" is not running"),
            AdminError::Remote(e) => write!(f, "remote hub: {}", e.code),
        }
    }
}

impl std::error::Error for AdminError {}

struct Running {
    handle: ProjectHandle,
    generation: u64,
    files: usize,
    members: Arc<AtomicUsize>,
    stats: Arc<ProjectStats>,
    started_at: u64,
}

enum Run {
    Running(Running),
    Disabled,
    Failed(String),
}

struct Entry {
    key: String,
    cfg: ProjectConfig,
    run: Run,
}

struct Listener {
    bind: String,
    /// As configured (0 picks a free port), so re-applying `--port 0` never rebinds.
    port_cfg: u16,
    port: u16,
    accept: JoinHandle<()>,
}

struct Discovery {
    port: u16,
    /// `None` when the port could not be bound.
    task: Option<JoinHandle<()>>,
}

/// The TLS settings in force and what they loaded; kept so an apply with the same settings loads nothing.
struct Tls {
    settings: TlsSettings,
    state_dir: Option<PathBuf>,
    identity: Option<Arc<TlsIdentity>>,
}

#[derive(Default)]
struct State {
    listener: Option<Listener>,
    discovery: Option<Discovery>,
    tls: Option<Tls>,
    public_address: Vec<String>,
    hub_name: String,
    features: Vec<String>,
    admin: AdminSettings,
    admin_host: Option<Arc<HubAdmin>>,
    projects: Vec<Entry>,
    next_gen: u64,
}

struct Inner {
    router: Arc<Router>,
    instance_id: String,
    state: Mutex<State>,
    events: broadcast::Sender<ProjectEvent>,
    reply: watch::Sender<Arc<[u8]>>,
    port: AtomicU16,
    started_at: u64,
}

#[derive(Clone)]
pub struct Registry {
    inner: Arc<Inner>,
}

/// A restart is needed when the actor's files or folders change; everything else is applied live.
fn needs_restart(old: &ProjectConfig, new: &ProjectConfig) -> bool {
    old.root != new.root
        || old.history_dir != new.history_dir
        || old.history.enabled != new.history.enabled
        || old.debug != new.debug
}

fn exclude_patterns(cfg: &ProjectConfig) -> Vec<String> {
    DEFAULT_EXCLUDE
        .iter()
        .map(|s| (*s).to_owned())
        .chain(cfg.exclude.iter().cloned())
        .collect()
}

fn panic_text(p: Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic".to_owned())
}

impl Registry {
    /// Binds the TCP port of `config.hub`, then starts its projects. Only a TCP bind failure is an error;
    /// a project that cannot start is marked failed.
    pub async fn start(config: Config, instance_id: String) -> io::Result<(Registry, ApplyReport)> {
        let registry = Registry {
            inner: Arc::new(Inner {
                router: Arc::default(),
                instance_id,
                state: Mutex::new(State::default()),
                events: broadcast::channel(EVENTS).0,
                reply: watch::channel(Arc::from(Vec::new())).0,
                port: AtomicU16::new(0),
                started_at: now_ms(),
            }),
        };
        let report = registry.apply_inner(config, true).await?;
        Ok((registry, report))
    }

    /// The bound TCP port.
    pub fn port(&self) -> u16 {
        self.inner.port.load(Ordering::Relaxed)
    }

    pub fn instance_id(&self) -> &str {
        &self.inner.instance_id
    }

    /// The SHA-256 fingerprint of the certificate when TLS is on.
    pub async fn tls_fingerprint(&self) -> Option<String> {
        let st = self.inner.state.lock().await;
        tls_identity(&st).map(|t| t.fingerprint.clone())
    }

    /// Lets `admin_hello` in when `[hub.admin] remote` is on, answered by `host`. Without a host the channel
    /// stays refused whatever the config says: only `lanhub-cli` serves it.
    pub async fn set_admin_host(&self, host: HubAdmin) {
        let mut st = self.inner.state.lock().await;
        st.admin_host = Some(Arc::new(host));
        if st.admin.remote {
            log_in(None, "Đã bật quản trị từ xa");
        }
        self.publish(&st);
    }

    /// Project starts, stops, changes and failures as they happen, for a live status view.
    pub fn subscribe(&self) -> broadcast::Receiver<ProjectEvent> {
        self.inner.events.subscribe()
    }

    /// Runs to completion even when the caller stops waiting: `apply_inner` holds the projects outside the
    /// state while it stops and starts actors, and dropping it there would lose their handles unflushed.
    pub async fn apply(&self, config: Config) -> ApplyReport {
        let this = self.clone();
        tokio::spawn(async move { this.apply_inner(config, false).await })
            .await
            .expect("an apply does not panic")
            .expect("only the first apply fails on a bind error")
    }

    async fn apply_inner(&self, config: Config, first: bool) -> io::Result<ApplyReport> {
        let mut st = self.inner.state.lock().await;
        let st = &mut *st;
        let mut report = ApplyReport::default();
        let invite_before = invite_facts(st, self.port());
        Self::apply_tls(st, &config.hub, first).await?;
        self.apply_listener(st, &config.hub, first).await?;
        self.apply_discovery(st, &config.hub).await;
        st.public_address = config.hub.public_address.clone();
        if config.hub.admin.remote != st.admin.remote && st.admin_host.is_some() {
            log_in(
                None,
                if config.hub.admin.remote {
                    "Đã bật quản trị từ xa"
                } else {
                    "Đã tắt quản trị từ xa"
                },
            );
        }
        st.admin = config.hub.admin.clone();
        let hub_name = config.hub.name.clone().unwrap_or_else(util::hostname);
        let mut features = vec![
            "chat-image".to_owned(),
            "multi-project".to_owned(),
            "http-diag".to_owned(),
            "admin".to_owned(),
        ];
        if st.discovery.as_ref().is_some_and(|d| d.task.is_some()) {
            features.push("discovery".to_owned());
        }
        // Every connection on a TLS port is a TLS connection: a plain one is refused before its hello.
        if tls_identity(st).is_some() {
            features.push("tls".to_owned());
        }
        let facts_changed = hub_name != st.hub_name || features != st.features;
        st.hub_name = hub_name;
        st.features = features;
        let invites_changed = !first && invite_facts(st, self.port()) != invite_before;
        // The listener already accepts: publish the TLS identity before the projects load, or a TLS hub
        // would treat its first connections as plain.
        if first {
            self.publish(st);
        }
        let mut started: Vec<String> = Vec::new();

        let desired: Vec<(String, ProjectConfig)> = config
            .projects
            .into_iter()
            .map(|p| (router::key(&p.name), p))
            .collect();
        let mut old: HashMap<String, Entry> =
            st.projects.drain(..).map(|e| (e.key.clone(), e)).collect();

        // Every stop comes before any start, so a folder moved from one project to another is never served
        // twice.
        for (key, entry) in &mut old {
            let keep = desired
                .iter()
                .find(|(k, _)| k == key)
                .is_some_and(|(_, cfg)| cfg.enabled && !needs_restart(&entry.cfg, cfg));
            if keep {
                continue;
            }
            if let Run::Running(r) = std::mem::replace(&mut entry.run, Run::Disabled) {
                stop_actor(&r.handle).await;
                self.event(
                    &mut report,
                    &entry.cfg.name,
                    EventKind::Stopped,
                    None,
                    &format!("Dự án \"{}\" đã dừng", entry.cfg.name),
                );
            }
        }

        for (key, cfg) in desired {
            let prev = old.remove(&key);
            let run = match prev.map(|e| (e.cfg, e.run)) {
                Some((old_cfg, Run::Running(mut r))) => {
                    if old_cfg != cfg || facts_changed {
                        self.reconfigure(st, &mut r, &cfg).await;
                        self.event(
                            &mut report,
                            &cfg.name,
                            EventKind::Reconfigured,
                            None,
                            &format!("Dự án \"{}\": đã áp cấu hình mới", cfg.name),
                        );
                    }
                    Run::Running(r)
                }
                _ if !cfg.enabled => Run::Disabled,
                _ => {
                    started.push(key.clone());
                    self.start_project(st, &key, &cfg, &mut report).await
                }
            };
            st.projects.push(Entry { key, cfg, run });
        }
        if invites_changed {
            for e in &st.projects {
                if matches!(e.run, Run::Running(_)) && !started.contains(&e.key) {
                    self.log_invites(st, &e.cfg);
                }
            }
        }
        self.publish(st);
        Ok(report)
    }

    /// Loads the certificate when `[hub.tls]` changed. A first apply that cannot load it fails, so the
    /// hub never serves plain TCP when TLS was asked; a later one logs the error and keeps what runs.
    async fn apply_tls(st: &mut State, hub: &HubSettings, first: bool) -> io::Result<()> {
        if st
            .tls
            .as_ref()
            .is_some_and(|t| t.settings == hub.tls && t.state_dir == hub.state_dir)
        {
            return Ok(());
        }
        let identity = if hub.tls.enabled {
            let (settings, dir) = (hub.tls.clone(), hub.state_dir.clone());
            let loaded =
                tokio::task::spawn_blocking(move || tls::load_or_create(&settings, dir.as_deref()))
                    .await
                    .map_err(io::Error::other)?;
            match loaded {
                Ok(id) => {
                    let from = match &id.source {
                        CertSource::Generated(p) => format!("Chứng chỉ TLS tự ký: {}", p.display()),
                        CertSource::Provided(p) => format!("Chứng chỉ TLS: {}", p.display()),
                    };
                    log(from);
                    log(format!("TLS fingerprint SHA256 {}", id.fingerprint));
                    Some(Arc::new(id))
                }
                Err(e) if first => return Err(io::Error::other(format!("TLS: {e}"))),
                Err(e) => {
                    log(format!(
                        "[LỖI] không bật được TLS: {e}. Hub vẫn chạy như trước."
                    ));
                    return Ok(());
                }
            }
        } else {
            if tls_identity(st).is_some() {
                log("Đã tắt TLS: kết nối mới không mã hoá");
            }
            None
        };
        st.tls = Some(Tls {
            settings: hub.tls.clone(),
            state_dir: hub.state_dir.clone(),
            identity,
        });
        Ok(())
    }

    /// The codes members join `cfg` with: one legacy `LC-` code per address for 0.1.1 extensions, then one
    /// `LC3-` code with the public addresses first and every interface address after them. The legacy codes
    /// are left out with TLS on, which 0.1 clients cannot speak. A machine with no address has no `LC3-` code.
    fn invite_set(&self, st: &State, cfg: &ProjectConfig) -> InviteCodes {
        let port = self.port();
        let ips = util::ipv4_addresses();
        let identity = tls_identity(st);
        let legacy = if identity.is_none() {
            ips.iter()
                .map(|ip| LegacyInvite {
                    host: ip.to_string(),
                    code: invite::encode_v1(*ip, port, &cfg.name, &cfg.token),
                })
                .collect()
        } else {
            Vec::new()
        };
        let mut hosts = st.public_address.clone();
        for ip in &ips {
            let ip = ip.to_string();
            if !hosts.contains(&ip) {
                hosts.push(ip);
            }
        }
        let code = (!hosts.is_empty()).then(|| {
            invite::encode_v3(
                &self.inner.instance_id,
                &hosts,
                port,
                &cfg.name,
                &cfg.token,
                identity.map(|t| t.fingerprint.as_str()),
            )
        });
        InviteCodes {
            code,
            hosts,
            port,
            tls: identity.is_some(),
            legacy,
        }
    }

    /// The invite lines of the Node hub.
    fn log_invites(&self, st: &State, cfg: &ProjectConfig) {
        let codes = self.invite_set(st, cfg);
        for l in &codes.legacy {
            log_in(Some(&cfg.name), &format!("Mã mời ({}): {}", l.host, l.code));
        }
        if let Some(code) = &codes.code {
            log_in(Some(&cfg.name), &format!("Mã mời: {code}"));
        }
    }

    async fn apply_listener(
        &self,
        st: &mut State,
        hub: &HubSettings,
        first: bool,
    ) -> io::Result<()> {
        if st
            .listener
            .as_ref()
            .is_some_and(|l| l.bind == hub.bind && l.port_cfg == hub.port)
        {
            return Ok(());
        }
        let listener = match TcpListener::bind((hub.bind.as_str(), hub.port)).await {
            Ok(l) => l,
            Err(e) if first => return Err(e),
            Err(e) => {
                log(format!(
                    "[LỖI] không mở được {}:{}: {e}. Hub vẫn nhận kết nối như trước.",
                    hub.bind, hub.port
                ));
                return Ok(());
            }
        };
        let port = listener.local_addr()?.port();
        if let Some(old) = st.listener.take() {
            old.accept.abort();
            log(format!(
                "Hub chuyển sang {}:{port}; kết nối đang có vẫn giữ",
                hub.bind
            ));
        }
        self.inner.port.store(port, Ordering::Relaxed);
        st.listener = Some(Listener {
            bind: hub.bind.clone(),
            port_cfg: hub.port,
            port,
            accept: router::accept(listener, self.inner.router.clone()),
        });
        Ok(())
    }

    /// A port that could not be bound is tried again only when the configured port or switch changes.
    async fn apply_discovery(&self, st: &mut State, hub: &HubSettings) {
        let want = hub.discovery.then_some(hub.discovery_port);
        if st.discovery.as_ref().map(|d| d.port) == want {
            return;
        }
        if let Some(task) = st.discovery.take().and_then(|d| d.task) {
            task.abort();
        }
        let Some(udp) = want else { return };
        let task = match discovery::bind(udp).await {
            Ok(sock) => {
                log(format!("Cho máy khác tự tìm hub: UDP cổng {udp}"));
                Some(discovery::serve(sock, self.inner.reply.subscribe()))
            }
            Err(e) => {
                log(format!(
                    "[CẢNH BÁO] không mở được cổng UDP {udp} để máy khác tự tìm thấy hub: {e}. Hub vẫn chạy; máy khác vào bằng mã mời."
                ));
                None
            }
        };
        st.discovery = Some(Discovery { port: udp, task });
    }

    fn info_for(
        &self,
        st: &State,
        cfg: &ProjectConfig,
        hub_id: String,
        exclude: Vec<String>,
    ) -> ProjectInfo {
        ProjectInfo {
            name: cfg.name.clone(),
            token: cfg.token.clone(),
            hub_id,
            instance_id: self.inner.instance_id.clone(),
            hub_name: st.hub_name.clone(),
            hub_version: HUB_VERSION.to_owned(),
            exclude,
            features: st.features.clone(),
            allow: allow::entries(&cfg.allow.join("\n")),
            allow_file: cfg.allow_file.clone(),
            advertise: cfg.advertise,
            history: cfg.history.clone(),
        }
    }

    async fn reconfigure(&self, st: &State, r: &mut Running, cfg: &ProjectConfig) {
        let exclude = exclude_patterns(cfg);
        let excluder = Excluder::new(&exclude);
        let info = Arc::new(self.info_for(st, cfg, r.handle.info.hub_id.clone(), exclude));
        // A dead actor is about to be reported by its supervisor.
        let _ = r
            .handle
            .inbox
            .send(ActorMsg::Reconfigure {
                info: info.clone(),
                excluder,
            })
            .await;
        r.handle.info = info;
    }

    async fn start_project(
        &self,
        st: &mut State,
        key: &str,
        cfg: &ProjectConfig,
        report: &mut ApplyReport,
    ) -> Run {
        match self.spawn_project(st, key, cfg).await {
            Ok(r) => {
                let port = self.port();
                self.event(
                    report,
                    &cfg.name,
                    EventKind::Started,
                    None,
                    &format!(
                        "LAN Collab hub — dự án \"{}\" — thư mục {} — cổng {port} — {} file",
                        cfg.name,
                        cfg.root.display(),
                        r.files
                    ),
                );
                if let Some(f) = &cfg.allow_file {
                    log_in(
                        Some(&cfg.name),
                        &format!(
                            "Danh sách tài khoản được vào: {} (trống hoặc không có file = ai có token cũng vào được)",
                            f.display()
                        ),
                    );
                }
                self.log_invites(st, cfg);
                Run::Running(r)
            }
            Err(e) => {
                self.event(
                    report,
                    &cfg.name,
                    EventKind::Failed,
                    Some(e.clone()),
                    &format!("[LỖI] Dự án \"{}\" không chạy được: {e}", cfg.name),
                );
                Run::Failed(e)
            }
        }
    }

    async fn spawn_project(
        &self,
        st: &mut State,
        key: &str,
        cfg: &ProjectConfig,
    ) -> Result<Running, String> {
        let root = cfg.root.clone();
        if !root.is_dir() {
            return Err(format!("không có thư mục {}", root.display()));
        }
        let history = cfg
            .history_dir
            .clone()
            .unwrap_or_else(|| root.join(".lan-collab").join("history"));
        let exclude = exclude_patterns(cfg);
        let excluder = Excluder::new(&exclude);
        let legacy = cfg.history_dir.is_none();
        let keep_history = cfg.history.enabled;
        let (id, loaded, chat, excluder, store) = tokio::task::spawn_blocking({
            let (root, history, name) = (root.clone(), history.clone(), cfg.name.clone());
            move || -> io::Result<_> {
                if legacy {
                    move_legacy_history(&root, &history);
                }
                let id = identity::load(&root)?;
                let loaded = load_files(&root, &excluder);
                let chat = chat::load(&chat::log_path(&history));
                let store = if keep_history {
                    match crate::history::open(&history, &loaded) {
                        Ok((s, ended)) => {
                            if ended > 0 {
                                log_in(
                                    Some(&name),
                                    &format!("Lịch sử: đã đóng {ended} lượt còn mở từ lần chạy trước"),
                                );
                            }
                            Some(s)
                        }
                        Err(e) => {
                            log_in(
                                Some(&name),
                                &format!(
                                    "[CẢNH BÁO] không mở được lịch sử chỉnh sửa ở {}: {e}. Dự án vẫn chạy nhưng không ghi lịch sử.",
                                    history.display()
                                ),
                            );
                            None
                        }
                    }
                } else {
                    None
                };
                Ok((id, loaded, chat, excluder, store))
            }
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        let files = loaded.len();
        let info = Arc::new(self.info_for(st, cfg, id.hub_id, exclude));
        let (inbox, rx) = mpsc::channel(INBOX);
        let project = Project::new(
            info.clone(),
            root,
            excluder,
            loaded,
            history,
            chat,
            store,
            cfg.debug.clone(),
        );
        let members = project.member_count();
        let stats = project.stats();
        st.next_gen += 1;
        let generation = st.next_gen;
        let actor = tokio::spawn(crate::logs::in_project(cfg.name.clone(), project.run(rx)));
        let weak: Weak<Inner> = Arc::downgrade(&self.inner);
        let key = key.to_owned();
        tokio::spawn(async move {
            if let Err(e) = actor.await
                && e.is_panic()
                && let Some(inner) = weak.upgrade()
            {
                Registry { inner }
                    .on_crash(&key, generation, panic_text(e.into_panic()))
                    .await;
            }
        });
        Ok(Running {
            handle: ProjectHandle { info, inbox },
            generation,
            files,
            members,
            stats,
            started_at: now_ms(),
        })
    }

    async fn on_crash(&self, key: &str, generation: u64, reason: String) {
        let mut st = self.inner.state.lock().await;
        let Some(entry) = st.projects.iter_mut().find(|e| {
            e.key == key && matches!(&e.run, Run::Running(r) if r.generation == generation)
        }) else {
            return;
        };
        entry.run = Run::Failed(reason.clone());
        let name = entry.cfg.name.clone();
        self.event(
            &mut ApplyReport::default(),
            &name,
            EventKind::Failed,
            Some(reason.clone()),
            &format!("[LỖI] Dự án \"{name}\" dừng vì lỗi: {reason}. Các dự án khác vẫn chạy."),
        );
        self.publish(&st);
    }

    fn event(
        &self,
        report: &mut ApplyReport,
        project: &str,
        kind: EventKind,
        detail: Option<String>,
        line: &str,
    ) {
        log_in(Some(project), line);
        let e = ProjectEvent {
            project: project.to_owned(),
            kind,
            detail,
        };
        let _ = self.inner.events.send(e.clone());
        report.events.push(e);
    }

    /// Hands the router and the discovery responder the projects that serve right now.
    fn publish(&self, st: &State) {
        let mut table = Table {
            hub_name: st.hub_name.clone(),
            instance_id: self.inner.instance_id.clone(),
            tls: tls_identity(st).cloned(),
            started_at: self.inner.started_at,
            admin: match (&st.admin, &st.admin_host) {
                (
                    AdminSettings {
                        remote: true,
                        token_sha256: Some(hash),
                    },
                    Some(host),
                ) => Some(Arc::new(AdminDoor {
                    token_sha256: *hash,
                    host: host.clone(),
                })),
                _ => None,
            },
            ..Table::default()
        };
        for e in &st.projects {
            if let Run::Running(r) = &e.run {
                table.projects.insert(e.key.clone(), r.handle.clone());
                if e.cfg.advertise {
                    table.advertised.push(e.cfg.name.clone());
                }
            }
        }
        let reply = serde_json::to_vec(&discovery::Here {
            t: "lanhub_here",
            v: 2,
            instance_id: &self.inner.instance_id,
            hub_name: &st.hub_name,
            port: st.listener.as_ref().map_or(0, |l| l.port),
            tls: tls_identity(st).is_some(),
            projects: &table.advertised,
        })
        .expect("the reply serializes");
        self.inner.reply.send_replace(reply.into());
        self.inner.router.set(table);
    }

    fn status(e: &Entry) -> ProjectStatus {
        let (state, error, running) = match &e.run {
            Run::Running(r) => (ProjectState::Running, None, Some(r)),
            Run::Disabled => (ProjectState::Disabled, None, None),
            Run::Failed(why) => (ProjectState::Failed, Some(why.clone()), None),
        };
        ProjectStatus {
            name: e.cfg.name.clone(),
            root: e.cfg.root.clone(),
            state,
            error,
            hub_id: running.map(|r| r.handle.info.hub_id.clone()),
            files: running.map(|r| r.stats.files.load(Ordering::Relaxed)),
            clients: running.map_or(0, |r| r.members.load(Ordering::Relaxed)),
            ops: running.map_or(0, |r| r.stats.ops.load(Ordering::Relaxed)),
            last_activity: running
                .map(|r| r.stats.last_activity.load(Ordering::Relaxed))
                .filter(|&t| t > 0),
            advertise: e.cfg.advertise,
            token: e.cfg.token.clone(),
            started_at: running.map(|r| r.started_at),
        }
    }

    pub async fn list_projects(&self) -> Vec<ProjectStatus> {
        let st = self.inner.state.lock().await;
        st.projects.iter().map(Self::status).collect()
    }

    pub async fn project_status(&self, name: &str) -> Option<ProjectStatus> {
        let key = router::key(name);
        let st = self.inner.state.lock().await;
        st.projects.iter().find(|e| e.key == key).map(Self::status)
    }

    /// Gives the project a new random token at once. New joins need it; members already in stay. The
    /// config file is not written: the caller saves the returned token, or the next apply of the file
    /// brings the old one back.
    pub async fn rotate_token(&self, name: &str) -> Result<String, AdminError> {
        let (this, name) = (self.clone(), name.to_owned());
        tokio::spawn(async move { this.rotate_inner(&name).await })
            .await
            .expect("a rotation does not panic")
    }

    async fn rotate_inner(&self, name: &str) -> Result<String, AdminError> {
        let key = router::key(name);
        let mut st = self.inner.state.lock().await;
        let st = &mut *st;
        let at = st
            .projects
            .iter()
            .position(|e| e.key == key)
            .ok_or_else(|| AdminError::UnknownProject(name.to_owned()))?;
        let token = random_hex::<16>();
        let mut entry = st.projects.remove(at);
        entry.cfg.token = token.clone();
        if let Run::Running(r) = &mut entry.run {
            self.reconfigure(st, r, &entry.cfg).await;
            self.event(
                &mut ApplyReport::default(),
                &entry.cfg.name,
                EventKind::Reconfigured,
                None,
                &format!("Dự án \"{}\": đã đổi token", entry.cfg.name),
            );
        }
        st.projects.insert(at, entry);
        self.publish(st);
        Ok(token)
    }

    pub async fn clients(&self, name: &str) -> Result<Vec<ClientInfo>, AdminError> {
        self.ask(name, |reply| ActorMsg::Clients { reply }).await
    }

    pub async fn invite_codes(&self, name: &str) -> Result<InviteCodes, AdminError> {
        let key = router::key(name);
        let st = self.inner.state.lock().await;
        let entry = st
            .projects
            .iter()
            .find(|e| e.key == key)
            .ok_or_else(|| AdminError::UnknownProject(name.to_owned()))?;
        Ok(self.invite_set(&st, &entry.cfg))
    }

    async fn ask<T>(
        &self,
        name: &str,
        msg: impl FnOnce(oneshot::Sender<T>) -> ActorMsg,
    ) -> Result<T, AdminError> {
        let key = router::key(name);
        let inbox = {
            let st = self.inner.state.lock().await;
            let entry = st
                .projects
                .iter()
                .find(|e| e.key == key)
                .ok_or_else(|| AdminError::UnknownProject(name.to_owned()))?;
            match &entry.run {
                Run::Running(r) => r.handle.inbox.clone(),
                _ => return Err(AdminError::NotRunning(name.to_owned())),
            }
        };
        let (reply, rx) = oneshot::channel();
        if inbox.send(msg(reply)).await.is_err() {
            return Err(AdminError::NotRunning(name.to_owned()));
        }
        rx.await
            .map_err(|_| AdminError::NotRunning(name.to_owned()))
    }

    /// Disk use of the project's history; `None` when it runs without history.
    pub async fn history_usage(&self, name: &str) -> Result<Option<HistoryUsage>, AdminError> {
        self.ask(name, |reply| ActorMsg::HistoryUsage { reply })
            .await
    }

    /// Runs retention now with the project's limits; `None` when it runs without history.
    pub async fn run_retention(
        &self,
        name: &str,
    ) -> Result<Option<Result<RetentionReport, String>>, AdminError> {
        self.ask(name, |reply| ActorMsg::RunRetention { reply })
            .await
    }

    /// Stops accepting, writes every pending file of every project and stops their actors.
    pub async fn stop(&self) {
        let mut st = self.inner.state.lock().await;
        st.admin_host = None;
        if let Some(l) = st.listener.take() {
            l.accept.abort();
        }
        if let Some(task) = st.discovery.take().and_then(|d| d.task) {
            task.abort();
        }
        for e in &mut st.projects {
            if let Run::Running(r) = std::mem::replace(&mut e.run, Run::Disabled) {
                stop_actor(&r.handle).await;
            }
        }
        self.inner.router.set(Table::default());
    }
}

async fn stop_actor(handle: &ProjectHandle) {
    let (done, wait) = oneshot::channel();
    if handle.inbox.send(ActorMsg::Shutdown { done }).await.is_ok() {
        let _ = wait.await;
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

fn tls_identity(st: &State) -> Option<&Arc<TlsIdentity>> {
    st.tls.as_ref().and_then(|t| t.identity.as_ref())
}

/// What the invite codes are made of, apart from each project's name and token.
fn invite_facts(st: &State, port: u16) -> (u16, Vec<String>, Option<String>) {
    (
        port,
        st.public_address.clone(),
        tls_identity(st).map(|t| t.fingerprint.clone()),
    )
}
