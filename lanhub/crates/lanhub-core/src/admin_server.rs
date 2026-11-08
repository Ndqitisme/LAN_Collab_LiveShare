//! The hub side of the admin channel (docs/protocol.md section 13.3). A connection whose first message is
//! `admin_hello` with the `[hub.admin]` token becomes an admin session: it carries the `AdminApi` calls and
//! the config edits of the app as `admin_call` and `admin_result` messages with ids. Edits are written to
//! the hub's own `lanhub.toml` with the same checks the app runs locally, then applied.
//!
//! The channel is refused over plain TCP from any address but loopback, and five wrong tokens from one
//! address within a minute block that address for five minutes.

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lanhub_protocol::{AdminClientMessage, AdminFailure, AdminHubMessage, AdminRefusal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::watch;

use crate::admin::scan_legacy;
use crate::config::Config;
use crate::config_file::{
    AppError, ConfigFile, HistoryInput, HubInput, HubSettingsView, ImportInput, InviteView,
    ProjectInput, ProjectSettings, check_hub, exclude_preview, project_config,
};
use crate::framing::{LineDecoder, Tail};
use crate::project::Line;
use crate::registry::{AdminError, ProjectState, Registry};
use crate::router::Router;
use crate::session::Conn;
use crate::util::{log, random_hex};
use crate::{HUB_VERSION, logs};

/// Wrong tokens from one address that block it, counted over `STRIKE_WINDOW`.
pub const MAX_STRIKES: usize = 5;
pub const STRIKE_WINDOW: Duration = Duration::from_secs(60);
pub const BLOCK_FOR: Duration = Duration::from_secs(5 * 60);
/// A wrong token is answered after this, so one connection tries at most one token a second.
pub const WRONG_TOKEN_DELAY: Duration = Duration::from_secs(1);
/// Lines of an admin session; an `apply_config` with many projects stays far below it.
const ADMIN_MAX_LINE: usize = 1024 * 1024;
/// The most log records one `logs` call returns.
const LOGS_MAX: usize = 2000;

pub fn token_hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// Equal in time that does not depend on where the first difference is.
fn same_hash(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// What the router hands an `admin_hello`: the token to check and who answers the calls.
pub struct AdminDoor {
    pub token_sha256: [u8; 32],
    pub host: Arc<HubAdmin>,
}

#[derive(Default)]
struct Strikes {
    wrong: VecDeque<Instant>,
    blocked_until: Option<Instant>,
}

/// Wrong admin tokens per address, for one hub.
#[derive(Default)]
pub struct Limiter {
    by_ip: Mutex<HashMap<IpAddr, Strikes>>,
}

enum Verdict {
    Accepted,
    /// The address is blocked; the token was not looked at.
    Blocked(Duration),
    /// A wrong token; `true` when this one started a block.
    Wrong(bool),
}

impl Limiter {
    /// Checks the block, then the token, then counts a failure, under one lock: parallel connections from
    /// one address cannot try more tokens than the limit allows.
    fn attempt(&self, ip: IpAddr, given: &[u8; 32], expected: &[u8; 32]) -> Verdict {
        let now = Instant::now();
        let mut map = self.by_ip.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, s| {
            s.blocked_until.is_some_and(|t| t > now)
                || s.wrong
                    .back()
                    .is_some_and(|t| now.duration_since(*t) < STRIKE_WINDOW)
        });
        let s = map.entry(ip).or_default();
        if let Some(until) = s.blocked_until.filter(|t| *t > now) {
            return Verdict::Blocked(until - now);
        }
        if same_hash(given, expected) {
            map.remove(&ip);
            return Verdict::Accepted;
        }
        while s
            .wrong
            .front()
            .is_some_and(|t| now.duration_since(*t) >= STRIKE_WINDOW)
        {
            s.wrong.pop_front();
        }
        s.wrong.push_back(now);
        if s.wrong.len() >= MAX_STRIKES {
            s.wrong.clear();
            s.blocked_until = Some(now + BLOCK_FOR);
            return Verdict::Wrong(true);
        }
        Verdict::Wrong(false)
    }
}

fn is_loopback(ip: IpAddr) -> bool {
    ip.to_canonical().is_loopback()
}

/// An `admin_call`, by its `method` and `params`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "snake_case")]
pub enum AdminRequest {
    ListProjects {},
    ProjectStatus {
        name: String,
    },
    ApplyConfig {
        config: Config,
    },
    RotateToken {
        name: String,
    },
    Clients {
        name: String,
    },
    Logs {
        after: u64,
        limit: usize,
    },
    AddProject {
        input: ProjectInput,
    },
    UpdateProject {
        original: String,
        input: ProjectInput,
    },
    SetProjectEnabled {
        name: String,
        enabled: bool,
    },
    RemoveProject {
        name: String,
    },
    HubSettings {},
    UpdateHub {
        input: HubInput,
    },
    /// The invite code of every running project.
    AllInviteCodes {},
    InviteCode {
        name: String,
    },
    InviteCodes {
        name: String,
    },
    HistoryUsage {
        name: String,
    },
    RunRetention {
        name: String,
    },
    ImportLegacy {
        dir: String,
    },
    ProjectSettings {
        name: String,
    },
    SetAllow {
        name: String,
        lines: Vec<String>,
    },
    SetExclude {
        name: String,
        lines: Vec<String>,
    },
    PreviewExclude {
        name: String,
        lines: Vec<String>,
    },
    SetHistory {
        name: String,
        history: HistoryInput,
    },
    ImportProjects {
        items: Vec<ImportInput>,
    },
}

pub fn failure(e: &AppError) -> AdminFailure {
    AdminFailure {
        code: e.code.to_owned(),
        field: e.field.map(str::to_owned),
        params: e.params.clone(),
    }
}

pub fn admin_failure(e: &AdminError) -> AdminFailure {
    let (code, name) = match e {
        AdminError::UnknownProject(n) => ("unknownProject", n),
        AdminError::NotRunning(n) => ("notRunning", n),
        AdminError::Remote(f) => return f.clone(),
    };
    AdminFailure {
        code: code.to_owned(),
        field: None,
        params: [("name".to_owned(), name.clone())].into(),
    }
}

/// Where the hub's config comes from, and so whether edits can be written.
pub enum AdminSource {
    /// `lanhub-cli --config`: edits go to the file; `adjust` adds the command-line overrides before each
    /// apply, as the file watcher does.
    File {
        file: ConfigFile,
        adjust: Box<dyn Fn(Config) -> Config + Send + Sync>,
    },
    /// The single-project flags: nothing to write, edits are refused.
    Fixed(Config),
}

/// Answers the calls of admin sessions for one hub.
pub struct HubAdmin {
    registry: Registry,
    source: AdminSource,
    edit: tokio::sync::Mutex<()>,
}

type Reply = Result<serde_json::Value, AdminFailure>;

fn value<T: Serialize>(v: T) -> Reply {
    serde_json::to_value(v).map_err(|e| AdminFailure {
        code: "generic".to_owned(),
        field: None,
        params: [("detail".to_owned(), e.to_string())].into(),
    })
}

impl HubAdmin {
    pub fn new(registry: Registry, source: AdminSource) -> HubAdmin {
        HubAdmin {
            registry,
            source,
            edit: tokio::sync::Mutex::new(()),
        }
    }

    pub fn config_path(&self) -> Option<&std::path::Path> {
        match &self.source {
            AdminSource::File { file, .. } => Some(file.path()),
            AdminSource::Fixed(_) => None,
        }
    }

    /// The config the hub runs: the file with the overrides, or the fixed one.
    fn current(&self) -> Result<Config, AppError> {
        match &self.source {
            AdminSource::File { file, adjust } => file.load().map(adjust).map_err(|e| {
                logs::log_in(None, &format!("[LỖI] Cấu hình không hợp lệ: {e}"));
                AppError::new("configInvalid")
            }),
            AdminSource::Fixed(c) => Ok(c.clone()),
        }
    }

    /// Runs one file edit with the others held off, then applies the written config.
    async fn edit<T>(
        &self,
        change: impl FnOnce(&ConfigFile) -> Result<(Config, T), AppError>,
    ) -> Result<T, AppError> {
        let AdminSource::File { file, adjust } = &self.source else {
            return Err(AppError::new("configReadOnly"));
        };
        let _edit = self.edit.lock().await;
        let (cfg, out) = change(file)?;
        self.registry.apply(adjust(cfg)).await;
        Ok(out)
    }

    async fn invite_code(&self, name: &str) -> Result<String, AdminFailure> {
        self.registry
            .invite_codes(name)
            .await
            .map_err(|e| admin_failure(&e))?
            .code
            .ok_or_else(|| failure(&AppError::new("noAddress")))
    }

    pub async fn call(&self, req: AdminRequest) -> Reply {
        let app = |e: AppError| failure(&e);
        let admin = |e: AdminError| admin_failure(&e);
        match req {
            AdminRequest::ListProjects {} => value(self.registry.list_projects().await),
            AdminRequest::ProjectStatus { name } => {
                value(self.registry.project_status(&name).await)
            }
            AdminRequest::ApplyConfig { mut config } => {
                // The admin settings and the state folder are the hub's own; a config sent over the
                // channel carries neither, and must not switch the channel off by leaving them out.
                // The command-line overrides win, as at every apply of the file.
                let current = self.current().map_err(app)?;
                config.hub.admin = current.hub.admin;
                config.hub.state_dir = current.hub.state_dir;
                if let AdminSource::File { adjust, .. } = &self.source {
                    config = adjust(config);
                }
                value(self.registry.apply(config).await)
            }
            AdminRequest::RotateToken { name } => match &self.source {
                AdminSource::File { .. } => {
                    let token = random_hex::<16>();
                    self.edit(|f| f.set_token(&name, &token).map(|c| (c, token.clone())))
                        .await
                        .map_err(app)
                        .and_then(value)
                }
                AdminSource::Fixed(_) => self
                    .registry
                    .rotate_token(&name)
                    .await
                    .map_err(admin)
                    .and_then(value),
            },
            AdminRequest::Clients { name } => self
                .registry
                .clients(&name)
                .await
                .map_err(admin)
                .and_then(value),
            AdminRequest::Logs { after, limit } => value(logs::since(after, limit.min(LOGS_MAX))),
            AdminRequest::AddProject { input } => self
                .edit(|f| f.add_project(&input).map(|c| (c, ())))
                .await
                .map_err(app)
                .and_then(value),
            AdminRequest::UpdateProject { original, input } => self
                .edit(|f| f.update_project(&original, &input).map(|c| (c, ())))
                .await
                .map_err(app)
                .and_then(value),
            AdminRequest::SetProjectEnabled { name, enabled } => self
                .edit(|f| f.set_enabled(&name, enabled).map(|c| (c, ())))
                .await
                .map_err(app)
                .and_then(value),
            AdminRequest::RemoveProject { name } => self
                .edit(|f| f.remove_project(&name).map(|c| (c, ())))
                .await
                .map_err(app)
                .and_then(value),
            AdminRequest::HubSettings {} => {
                let cfg = self.current().map_err(app)?;
                value(HubSettingsView::new(
                    &cfg.hub,
                    self.registry.tls_fingerprint().await,
                ))
            }
            AdminRequest::UpdateHub { input } => {
                let running = self.current().map_err(app)?.hub;
                let AdminSource::File { adjust, .. } = &self.source else {
                    return Err(app(AppError::new("configReadOnly")));
                };
                self.edit(|f| {
                    f.update_hub(&input, |cfg| {
                        check_hub(&adjust(cfg.clone()).hub, Some(&running))
                    })
                    .map(|c| (c, ()))
                })
                .await
                .map_err(app)?;
                let cfg = self.current().map_err(app)?;
                value(HubSettingsView::new(
                    &cfg.hub,
                    self.registry.tls_fingerprint().await,
                ))
            }
            AdminRequest::AllInviteCodes {} => {
                let mut out = Vec::new();
                for p in self.registry.list_projects().await {
                    if p.state == ProjectState::Running {
                        let code = self.invite_code(&p.name).await?;
                        out.push(InviteView { name: p.name, code });
                    }
                }
                value(out)
            }
            AdminRequest::InviteCode { name } => self.invite_code(&name).await.and_then(value),
            AdminRequest::InviteCodes { name } => self
                .registry
                .invite_codes(&name)
                .await
                .map_err(admin)
                .and_then(value),
            AdminRequest::HistoryUsage { name } => self
                .registry
                .history_usage(&name)
                .await
                .map_err(admin)
                .and_then(value),
            AdminRequest::RunRetention { name } => {
                match self.registry.run_retention(&name).await.map_err(admin)? {
                    Some(Ok(report)) => value(report),
                    Some(Err(detail)) => {
                        Err(app(AppError::new("retentionFailed").param("detail", detail)))
                    }
                    None => Err(app(AppError::new("historyOff"))),
                }
            }
            AdminRequest::ImportLegacy { dir } => {
                let existing: Vec<String> = self
                    .registry
                    .list_projects()
                    .await
                    .into_iter()
                    .map(|p| p.name)
                    .collect();
                let path = std::path::PathBuf::from(&dir);
                let scanned = tokio::task::spawn_blocking(move || scan_legacy(&path, &existing))
                    .await
                    .unwrap_or_else(|e| Err(std::io::Error::other(e)));
                match scanned {
                    Ok(found) => value(found),
                    Err(e) => {
                        logs::log_in(None, &format!("[LỖI] Không đọc được thư mục {dir}: {e}"));
                        Err(app(AppError::new("legacyUnreadable").param("path", dir)))
                    }
                }
            }
            AdminRequest::ProjectSettings { name } => {
                let cfg = self.current().map_err(app)?;
                ProjectSettings::of(&cfg, &name)
                    .map_err(app)
                    .and_then(value)
            }
            AdminRequest::SetAllow { name, lines } => self
                .edit(|f| f.set_allow(&name, &lines).map(|c| (c, ())))
                .await
                .map_err(app)
                .and_then(value),
            AdminRequest::SetExclude { name, lines } => self
                .edit(|f| f.set_exclude(&name, &lines).map(|c| (c, ())))
                .await
                .map_err(app)
                .and_then(value),
            AdminRequest::PreviewExclude { name, lines } => {
                let cfg = self.current().map_err(app)?;
                let root = project_config(&cfg, &name).map_err(app)?.root.clone();
                tokio::task::spawn_blocking(move || exclude_preview(&root, &lines))
                    .await
                    .map_err(|_| app(AppError::new("generic")))?
                    .map_err(app)
                    .and_then(value)
            }
            AdminRequest::SetHistory { name, history } => self
                .edit(|f| f.set_history(&name, &history).map(|c| (c, ())))
                .await
                .map_err(app)
                .and_then(value),
            AdminRequest::ImportProjects { items } => self
                .edit(|f| f.import_projects(&items))
                .await
                .map_err(app)
                .and_then(value),
        }
    }
}

fn admin_line(msg: &AdminHubMessage) -> Line {
    let mut v = serde_json::to_vec(msg).expect("admin messages serialize");
    v.push(b'\n');
    v.into()
}

fn refuse(conn: &Conn, code: AdminRefusal, retry_after: Option<Duration>) {
    conn.send(admin_line(&AdminHubMessage::AdminRefused {
        code,
        retry_after_ms: retry_after.map(|d| d.as_millis() as u64),
    }));
}

async fn closed(rx: &mut watch::Receiver<bool>) {
    let _ = rx.wait_for(|c| *c).await;
}

/// The admin session of a connection whose first line, `hello`, is an `admin_hello`. `rest` holds the
/// lines that arrived with it. Returns when the connection ends.
#[allow(clippy::too_many_arguments)]
pub async fn serve<R: AsyncRead + Unpin>(
    mut rd: R,
    mut dec: LineDecoder,
    hello: &[u8],
    rest: Vec<Vec<u8>>,
    conn: Conn,
    mut close_rx: watch::Receiver<bool>,
    addr: SocketAddr,
    router: Arc<Router>,
    tls: bool,
) {
    let ip = addr.ip();
    let Ok(AdminClientMessage::AdminHello { token }) = serde_json::from_slice(hello) else {
        conn.close();
        return;
    };
    let table = router.table();
    let Some(door) = table.admin.clone() else {
        log(format!(
            "Từ chối quản trị từ {ip}: LAN Hub chưa bật quản trị từ xa"
        ));
        refuse(&conn, AdminRefusal::Disabled, None);
        return;
    };
    if !tls && !is_loopback(ip) {
        log(format!(
            "Từ chối quản trị từ {ip}: kết nối không mã hoá, cần bật TLS"
        ));
        refuse(&conn, AdminRefusal::TlsRequired, None);
        return;
    }
    match router
        .admin_strikes
        .attempt(ip, &token_hash(&token), &door.token_sha256)
    {
        Verdict::Accepted => {}
        Verdict::Blocked(left) => {
            log(format!(
                "Từ chối quản trị từ {ip}: địa chỉ đang bị chặn vì sai token quá nhiều lần, còn {} giây",
                left.as_secs()
            ));
            refuse(&conn, AdminRefusal::RateLimited, Some(left));
            return;
        }
        Verdict::Wrong(blocked) => {
            log(format!("Từ chối quản trị từ {ip}: sai token quản trị"));
            if blocked {
                log(format!(
                    "[CẢNH BÁO] Chặn quản trị từ {ip} trong {} phút: sai token {MAX_STRIKES} lần trong {} giây",
                    BLOCK_FOR.as_secs() / 60,
                    STRIKE_WINDOW.as_secs()
                ));
            }
            tokio::select! {
                _ = tokio::time::sleep(WRONG_TOKEN_DELAY) => {}
                _ = closed(&mut close_rx) => return,
            }
            refuse(&conn, AdminRefusal::TokenInvalid, None);
            return;
        }
    }
    let host = door.host.clone();
    log(format!("Phiên quản trị từ {ip} đã mở"));
    conn.send(admin_line(&AdminHubMessage::AdminWelcome {
        hub_name: table.hub_name.clone(),
        hub_version: HUB_VERSION.to_owned(),
        instance_id: table.instance_id.clone(),
        config_path: host.config_path().map(|p| p.to_string_lossy().into_owned()),
    }));
    drop(table);
    dec.limit = ADMIN_MAX_LINE;
    let token_sha256 = door.token_sha256;
    drop(door);
    let mut pending = rest;
    let mut buf = vec![0u8; 64 * 1024];
    'session: loop {
        for raw in pending.drain(..) {
            // A token changed or a channel turned off at apply ends the sessions it let in.
            if !router
                .table()
                .admin
                .as_ref()
                .is_some_and(|d| same_hash(&d.token_sha256, &token_sha256))
            {
                log(format!(
                    "Đóng phiên quản trị từ {ip}: cài đặt quản trị từ xa đã đổi"
                ));
                conn.close();
                break 'session;
            }
            let Ok(AdminClientMessage::AdminCall { id, method, params }) =
                serde_json::from_slice::<AdminClientMessage>(&raw)
            else {
                continue;
            };
            let params = if params.is_null() {
                serde_json::json!({})
            } else {
                params
            };
            let request = serde_json::from_value::<AdminRequest>(
                serde_json::json!({ "method": method, "params": params }),
            );
            let (host, conn) = (host.clone(), conn.clone());
            tokio::spawn(async move {
                let reply = match request {
                    Ok(req) => host.call(req).await,
                    Err(e) => Err(AdminFailure {
                        code: "badRequest".to_owned(),
                        field: None,
                        params: [("detail".to_owned(), e.to_string())].into(),
                    }),
                };
                let msg = match reply {
                    Ok(value) => AdminHubMessage::AdminResult {
                        id,
                        ok: true,
                        value,
                        error: None,
                    },
                    Err(e) => AdminHubMessage::AdminResult {
                        id,
                        ok: false,
                        value: serde_json::Value::Null,
                        error: Some(e),
                    },
                };
                conn.send(admin_line(&msg));
            });
        }
        if matches!(dec.tail(), Tail::Overflow) {
            log(format!(
                "[CẢNH BÁO] {ip}: dòng quản trị dài quá {ADMIN_MAX_LINE} ký tự, đóng kết nối"
            ));
            conn.close();
            break;
        }
        let n = tokio::select! {
            biased;
            _ = closed(&mut close_rx) => break,
            r = rd.read(&mut buf) => match r {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            },
        };
        pending = dec.push(&buf[..n]);
    }
    log(format!("Phiên quản trị từ {ip} đã đóng"));
}
