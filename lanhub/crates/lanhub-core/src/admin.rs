//! `AdminApi`, the one surface a user interface manages a hub through (plan README section 5.2). The
//! desktop app (A7) calls `LocalAdmin` in the same process; the remote client of A10 implements the same
//! trait over the admin channel.

use std::future::Future;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::allow;
use crate::config::Config;
use crate::history::{HistoryUsage, RetentionReport};
use crate::logs::{self, LogRecord};
use crate::project::ClientInfo;
use crate::registry::{AdminError, ApplyReport, InviteCodes, ProjectStatus, Registry};

pub trait AdminApi {
    /// Every configured project, disabled and failed ones included, in config order.
    fn list_projects(&self) -> impl Future<Output = Vec<ProjectStatus>> + Send;
    /// The project with this name, ignoring case.
    fn project_status(&self, name: &str) -> impl Future<Output = Option<ProjectStatus>> + Send;
    /// Makes the hub match `config`, touching only what differs (see `registry`).
    fn apply_config(&self, config: Config) -> impl Future<Output = ApplyReport> + Send;
    /// A new random token for the project, in force for the next join. The caller saves it to the
    /// config file.
    fn rotate_token(&self, name: &str) -> impl Future<Output = Result<String, AdminError>> + Send;
    /// The members connected to the project.
    fn clients(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<Vec<ClientInfo>, AdminError>> + Send;
    /// Up to `limit` log records written after record `after` (0 for the oldest kept), oldest first.
    fn logs(&self, after: u64, limit: usize) -> impl Future<Output = Vec<LogRecord>> + Send;
    /// Disk use of the project's history; `None` when the project runs without history.
    fn history_usage(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<Option<HistoryUsage>, AdminError>> + Send;
    /// A retention pass now; `None` when the project runs without history, `Err` inside when the pass
    /// failed (the reason is in the log).
    fn run_retention(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<Option<Result<RetentionReport, String>>, AdminError>> + Send;
    /// The codes members join the project with.
    fn invite_codes(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<InviteCodes, AdminError>> + Send;
    /// The projects a 0.1 hub folder configures, each marked when a project of that name exists.
    fn import_legacy(
        &self,
        dir: &Path,
    ) -> impl Future<Output = std::io::Result<Vec<LegacyProject>>> + Send;
}

/// A project of a 0.1 hub folder: `token-<name>.txt`, and `allowed-accounts-<name>.txt` when present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProject {
    pub name: String,
    pub token: String,
    /// Entries of the allow file without comments, lowercased; empty when the file is missing.
    pub allow: Vec<String>,
    /// `ROOT` of a `.bat` launcher in the folder whose `PROJECT` is this name.
    pub root: Option<PathBuf>,
    /// A project of this name (ignoring case) is configured already, so importing it adds nothing.
    pub exists: bool,
}

/// `set "KEY=value"` lines of a 0.1 `start-hub.bat`.
fn bat_value(text: &str, key: &str) -> Option<String> {
    let prefix = format!("set \"{key}=");
    text.lines().find_map(|l| {
        let l = l.trim();
        l.get(..prefix.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(&prefix))
            .then(|| l[prefix.len()..].trim_end_matches('"').to_owned())
    })
}

/// Reads a 0.1 hub folder. `existing` are the configured project names.
pub fn scan_legacy(dir: &Path, existing: &[String]) -> std::io::Result<Vec<LegacyProject>> {
    let mut roots = Vec::new();
    let mut tokens = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let Some(file) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let lower = file.to_lowercase();
        if let Some(name) = file
            .strip_prefix("token-")
            .and_then(|f| f.strip_suffix(".txt"))
            .filter(|n| !n.trim().is_empty())
        {
            tokens.push((name.to_owned(), entry.path()));
        } else if lower.ends_with(".bat")
            && let Ok(text) = std::fs::read_to_string(entry.path())
            && let (Some(project), Some(root)) =
                (bat_value(&text, "PROJECT"), bat_value(&text, "ROOT"))
        {
            roots.push((project, PathBuf::from(root)));
        }
    }
    tokens.sort();
    let mut out = Vec::new();
    for (name, path) in tokens {
        let token = std::fs::read_to_string(&path)?.trim().to_owned();
        if token.is_empty() {
            continue;
        }
        let allow = match std::fs::read_to_string(dir.join(format!("allowed-accounts-{name}.txt")))
        {
            Ok(text) => allow::entries(&text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e),
        };
        let key = name.to_lowercase();
        out.push(LegacyProject {
            root: roots
                .iter()
                .find(|(p, _)| p.to_lowercase() == key)
                .map(|(_, r)| r.clone()),
            exists: existing.iter().any(|e| e.to_lowercase() == key),
            name,
            token,
            allow,
        });
    }
    Ok(out)
}

/// Calls the registry of a hub running in this process.
#[derive(Clone)]
pub struct LocalAdmin {
    registry: Registry,
}

impl LocalAdmin {
    pub fn new(registry: Registry) -> LocalAdmin {
        LocalAdmin { registry }
    }
}

impl AdminApi for LocalAdmin {
    async fn list_projects(&self) -> Vec<ProjectStatus> {
        self.registry.list_projects().await
    }

    async fn project_status(&self, name: &str) -> Option<ProjectStatus> {
        self.registry.project_status(name).await
    }

    async fn apply_config(&self, config: Config) -> ApplyReport {
        self.registry.apply(config).await
    }

    async fn rotate_token(&self, name: &str) -> Result<String, AdminError> {
        self.registry.rotate_token(name).await
    }

    async fn clients(&self, name: &str) -> Result<Vec<ClientInfo>, AdminError> {
        self.registry.clients(name).await
    }

    async fn logs(&self, after: u64, limit: usize) -> Vec<LogRecord> {
        logs::since(after, limit)
    }

    async fn history_usage(&self, name: &str) -> Result<Option<HistoryUsage>, AdminError> {
        self.registry.history_usage(name).await
    }

    async fn run_retention(
        &self,
        name: &str,
    ) -> Result<Option<Result<RetentionReport, String>>, AdminError> {
        self.registry.run_retention(name).await
    }

    async fn invite_codes(&self, name: &str) -> Result<InviteCodes, AdminError> {
        self.registry.invite_codes(name).await
    }

    async fn import_legacy(&self, dir: &Path) -> std::io::Result<Vec<LegacyProject>> {
        let existing: Vec<String> = self
            .registry
            .list_projects()
            .await
            .into_iter()
            .map(|p| p.name)
            .collect();
        let dir = dir.to_owned();
        tokio::task::spawn_blocking(move || scan_legacy(&dir, &existing))
            .await
            .map_err(std::io::Error::other)?
    }
}
