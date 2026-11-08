//! Remote hubs: headless `lanhub-cli` hubs this app manages over the admin channel. The list (address,
//! port, certificate fingerprint) lives in `remote-hubs.json` next to `lanhub.toml`; each admin token lives
//! in the Windows Credential Manager, never in a file. One hub is selected at a time, this machine's own by
//! default, and every screen works against the selected one.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use lanhub_core::admin_remote::{self, AdminFailure, Probe, RemoteAdmin, RemoteTarget};
use lanhub_core::logs::log_in;
use lanhub_core::util::random_hex;
use serde::{Deserialize, Serialize};

use crate::config_file::AppError;
use crate::i18n;

pub const FILE_NAME: &str = "remote-hubs.json";
/// The Credential Manager entry of a hub is `remote-admin:<id>` under this service.
pub const KEYRING_SERVICE: &str = "LanHub";
/// An unreachable hub is tried again at most this often while it is selected.
const RETRY_EVERY: Duration = Duration::from_secs(3);

/// Form fields that a remote failure may name.
const FIELDS: &[&str] = &[
    "name",
    "root",
    "bind",
    "port",
    "discoveryPort",
    "publicAddress",
    "tls",
    "host",
    "token",
    "fingerprint",
    "allow",
    "exclude",
    "idleMinutes",
    "keepDays",
    "maxMb",
];

/// A remote hub's failure as the UI shows it. A code this app has no words for becomes `remoteError`.
pub fn app_error(f: AdminFailure) -> AppError {
    let Some(code) = i18n::error_code(&f.code) else {
        log_in(
            None,
            &format!("[LỖI] LAN Hub từ xa: {} {:?}", f.code, f.params),
        );
        return AppError::new("remoteError");
    };
    let mut e = AppError::new(code);
    e.field = f
        .field
        .as_deref()
        .and_then(|name| FIELDS.iter().find(|k| **k == name).copied());
    e.params = f.params;
    e
}

/// Failures that a retry without the user fixing something would only repeat, or that would count toward
/// the hub's block on wrong tokens.
fn needs_user(f: &AdminFailure) -> bool {
    matches!(
        f.code.as_str(),
        "remoteTokenInvalid"
            | "remoteRateLimited"
            | "remoteFingerprint"
            | "remoteTlsRequired"
            | "remoteTlsOn"
            | "remoteDisabled"
            | "remoteNoToken"
            | "fingerprintInvalid"
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    /// `None` for a plain TCP hub on loopback.
    pub fingerprint: Option<String>,
}

impl RemoteEntry {
    fn target(&self) -> RemoteTarget {
        RemoteTarget {
            host: self.host.clone(),
            port: self.port,
            fingerprint: self.fingerprint.clone(),
        }
    }
}

/// The add-remote form.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInput {
    pub label: String,
    pub host: String,
    pub port: u32,
    pub token: String,
    /// The fingerprint the user typed or confirmed; empty for a plain TCP hub on loopback.
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteView {
    pub id: String,
    pub label: String,
    pub address: String,
    pub fingerprint: Option<String>,
    /// `None` until the app has tried to connect.
    pub online: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubsView {
    /// `None` is this machine's hub.
    pub selected: Option<String>,
    pub remotes: Vec<RemoteView>,
}

#[derive(Default)]
struct Link {
    admin: Option<RemoteAdmin>,
    error: Option<AdminFailure>,
    tried: Option<Instant>,
}

pub struct Remotes {
    path: PathBuf,
    entries: Mutex<Vec<RemoteEntry>>,
    selected: Mutex<Option<String>>,
    links: tokio::sync::Mutex<HashMap<String, Link>>,
}

fn keyring_entry(id: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("remote-admin:{id}"))
}

fn write_list(path: &Path, entries: &[RemoteEntry]) -> Result<(), AppError> {
    let text = serde_json::to_vec_pretty(entries).expect("the list serializes");
    lanhub_core::flush::write_file_atomic(path, &text).map_err(|e| {
        log_in(
            None,
            &format!("[LỖI] Không ghi được {}: {e}", path.display()),
        );
        AppError::new("writeFailed").param("path", path.display().to_string())
    })
}

impl Remotes {
    /// Reads the list next to `config_path`; an unreadable list is logged and starts empty.
    pub fn new(config_path: &Path) -> Remotes {
        let path = config_path
            .parent()
            .map(|d| d.join(FILE_NAME))
            .unwrap_or_else(|| PathBuf::from(FILE_NAME));
        let entries = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
                log_in(
                    None,
                    &format!("[LỖI] Không đọc được {}: {e}", path.display()),
                );
                Vec::new()
            }),
            Err(_) => Vec::new(),
        };
        Remotes {
            path,
            entries: Mutex::new(entries),
            selected: Mutex::new(None),
            links: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    fn entries(&self) -> std::sync::MutexGuard<'_, Vec<RemoteEntry>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn entry(&self, id: &str) -> Option<RemoteEntry> {
        self.entries().iter().find(|e| e.id == id).cloned()
    }

    pub fn selected(&self) -> Option<String> {
        self.selected
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Selects a remote hub by id, or this machine's hub with `None`.
    pub fn select(&self, id: Option<String>) -> Result<(), AppError> {
        if let Some(id) = &id
            && self.entry(id).is_none()
        {
            return Err(AppError::new("remoteUnknown"));
        }
        *self.selected.lock().unwrap_or_else(|e| e.into_inner()) = id;
        Ok(())
    }

    pub async fn view(&self) -> HubsView {
        let links = self.links.lock().await;
        let remotes = self
            .entries()
            .iter()
            .map(|e| RemoteView {
                id: e.id.clone(),
                label: e.label.clone(),
                address: admin_remote::address(&e.host, e.port),
                fingerprint: e.fingerprint.clone(),
                online: links.get(&e.id).and_then(|l| {
                    if l.admin.as_ref().is_some_and(|a| !a.is_closed()) {
                        Some(true)
                    } else {
                        l.error.as_ref().map(|_| false)
                    }
                }),
            })
            .collect();
        HubsView {
            selected: self.selected(),
            remotes,
        }
    }

    /// Reads the certificate of a hub without sending a token, for the user to confirm.
    pub async fn probe(&self, host: &str, port: u32) -> Result<Probe, AppError> {
        let (host, port) = check_address(host, port)?;
        admin_remote::probe(&host, port).await.map_err(app_error)
    }

    /// Connects with the given token and pin; only a hub that lets the session in is saved.
    pub async fn add(&self, input: &RemoteInput) -> Result<String, AppError> {
        let (host, port) = check_address(&input.host, input.port)?;
        let token = input.token.trim();
        if token.is_empty() {
            return Err(AppError::field("remoteTokenEmpty", "token"));
        }
        let fingerprint = match input.fingerprint.trim() {
            "" => None,
            fp => Some(
                admin_remote::normalize_fingerprint(fp)
                    .ok_or_else(|| AppError::field("fingerprintInvalid", "fingerprint"))?,
            ),
        };
        let entry = RemoteEntry {
            id: random_hex::<8>(),
            label: match input.label.trim() {
                "" => host.clone(),
                l => l.to_owned(),
            },
            host,
            port,
            fingerprint,
        };
        let admin = RemoteAdmin::connect(&entry.target(), token)
            .await
            .map_err(app_error)?;
        keyring_entry(&entry.id)
            .and_then(|k| k.set_password(token))
            .map_err(|e| {
                log_in(
                    None,
                    &format!("[LỖI] Không lưu được token vào Credential Manager: {e}"),
                );
                AppError::new("secretFailed")
            })?;
        let mut list = self.entries().clone();
        list.push(entry.clone());
        if let Err(e) = write_list(&self.path, &list) {
            let _ = keyring_entry(&entry.id).and_then(|k| k.delete_credential());
            return Err(e);
        }
        *self.entries() = list;
        log_in(
            None,
            &format!(
                "Đã thêm LAN Hub từ xa {} ({})",
                entry.label,
                admin.address()
            ),
        );
        self.links.lock().await.insert(
            entry.id.clone(),
            Link {
                admin: Some(admin),
                error: None,
                tried: Some(Instant::now()),
            },
        );
        Ok(entry.id)
    }

    /// Forgets the hub and deletes its token from the Credential Manager.
    pub async fn remove(&self, id: &str) -> Result<(), AppError> {
        let list: Vec<RemoteEntry> = self
            .entries()
            .iter()
            .filter(|e| e.id != id)
            .cloned()
            .collect();
        write_list(&self.path, &list)?;
        *self.entries() = list;
        self.links.lock().await.remove(id);
        match keyring_entry(id).and_then(|k| k.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => log_in(
                None,
                &format!("[LỖI] Không xoá được token khỏi Credential Manager: {e}"),
            ),
        }
        let mut selected = self.selected.lock().unwrap_or_else(|e| e.into_inner());
        if selected.as_deref() == Some(id) {
            *selected = None;
        }
        Ok(())
    }

    /// The open session with hub `id`, connecting when there is none. `user` is an explicit request (a
    /// command or the retry button): it connects again even after a failure the user had to fix. The
    /// status poll passes `false`, so it never repeats a wrong token or hammers an unreachable hub.
    pub async fn admin(&self, id: &str, user: bool) -> Result<RemoteAdmin, AdminFailure> {
        let entry = self.entry(id).ok_or_else(|| AdminFailure {
            code: "remoteUnknown".to_owned(),
            field: None,
            params: Default::default(),
        })?;
        let mut links = self.links.lock().await;
        let link = links.entry(id.to_owned()).or_default();
        if let Some(a) = link.admin.as_ref().filter(|a| !a.is_closed()) {
            return Ok(a.clone());
        }
        if !user && let Some(e) = &link.error {
            let recent = link.tried.is_some_and(|t| t.elapsed() < RETRY_EVERY);
            if needs_user(e) || recent {
                return Err(e.clone());
            }
        }
        link.tried = Some(Instant::now());
        let token = keyring_entry(id)
            .and_then(|k| k.get_password())
            .map_err(|e| {
                log_in(
                    None,
                    &format!(
                        "[LỖI] Không đọc được token của {} trong Credential Manager: {e}",
                        entry.label
                    ),
                );
                AdminFailure {
                    code: "remoteNoToken".to_owned(),
                    field: None,
                    params: Default::default(),
                }
            });
        let result = match token {
            Ok(token) => RemoteAdmin::connect(&entry.target(), &token).await,
            Err(e) => Err(e),
        };
        match result {
            Ok(a) => {
                link.admin = Some(a.clone());
                link.error = None;
                Ok(a)
            }
            Err(e) => {
                link.admin = None;
                link.error = Some(e.clone());
                Err(e)
            }
        }
    }

    /// The session with the selected remote hub; `Ok(None)` while this machine's hub is selected.
    pub async fn selected_admin(&self) -> Result<Option<RemoteAdmin>, AppError> {
        match self.selected() {
            None => Ok(None),
            Some(id) => self.admin(&id, true).await.map(Some).map_err(app_error),
        }
    }

    /// Records a call that failed because the connection dropped, so the status shows it at once.
    pub async fn note(&self, id: &str, failure: &AdminFailure) {
        if let Some(link) = self.links.lock().await.get_mut(id) {
            link.error = Some(failure.clone());
        }
    }
}

fn check_address(host: &str, port: u32) -> Result<(String, u16), AppError> {
    let host = host
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    if host.is_empty() || host.contains(char::is_whitespace) || host.contains('/') {
        return Err(AppError::field("remoteHostInvalid", "host"));
    }
    let port = u16::try_from(port)
        .ok()
        .filter(|&p| p > 0)
        .ok_or_else(|| AppError::field("portInvalid", "port"))?;
    Ok((host, port))
}
