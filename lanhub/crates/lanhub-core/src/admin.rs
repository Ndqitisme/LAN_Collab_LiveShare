//! `AdminApi`, the one surface a user interface manages a hub through (plan README section 5.2). The
//! desktop app calls `LocalAdmin` for the hub in its own process and `RemoteAdmin` (`admin_remote`) for a
//! headless hub over the admin channel; `AnyAdmin` holds either, because a trait of async functions cannot
//! be a trait object.

use std::future::Future;

use crate::admin_remote::RemoteAdmin;
use crate::config::Config;
use crate::logs::{self, LogRecord};
use crate::project::ClientInfo;
use crate::registry::{AdminError, ApplyReport, ProjectStatus, Registry};

/// Every call can fail with `AdminError::Remote` when the hub is remote; a local hub fails only where the
/// project is unknown or not running.
pub trait AdminApi {
    /// Every configured project, disabled and failed ones included, in config order.
    fn list_projects(&self) -> impl Future<Output = Result<Vec<ProjectStatus>, AdminError>> + Send;
    /// The project with this name, ignoring case.
    fn project_status(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<Option<ProjectStatus>, AdminError>> + Send;
    /// Makes the hub match `config`, touching only what differs (see `registry`).
    fn apply_config(
        &self,
        config: Config,
    ) -> impl Future<Output = Result<ApplyReport, AdminError>> + Send;
    /// A new random token for the project, in force for the next join. The local hub leaves saving it to
    /// the caller; a remote hub writes it to its own config file.
    fn rotate_token(&self, name: &str) -> impl Future<Output = Result<String, AdminError>> + Send;
    /// The members connected to the project.
    fn clients(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<Vec<ClientInfo>, AdminError>> + Send;
    /// Up to `limit` log records written after record `after` (0 for the oldest kept), oldest first.
    fn logs(
        &self,
        after: u64,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<LogRecord>, AdminError>> + Send;
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
    async fn list_projects(&self) -> Result<Vec<ProjectStatus>, AdminError> {
        Ok(self.registry.list_projects().await)
    }

    async fn project_status(&self, name: &str) -> Result<Option<ProjectStatus>, AdminError> {
        Ok(self.registry.project_status(name).await)
    }

    async fn apply_config(&self, config: Config) -> Result<ApplyReport, AdminError> {
        Ok(self.registry.apply(config).await)
    }

    async fn rotate_token(&self, name: &str) -> Result<String, AdminError> {
        self.registry.rotate_token(name).await
    }

    async fn clients(&self, name: &str) -> Result<Vec<ClientInfo>, AdminError> {
        self.registry.clients(name).await
    }

    async fn logs(&self, after: u64, limit: usize) -> Result<Vec<LogRecord>, AdminError> {
        Ok(logs::since(after, limit))
    }
}

/// The hub a screen shows: this process's own, or a remote one.
#[derive(Clone)]
pub enum AnyAdmin {
    Local(LocalAdmin),
    Remote(RemoteAdmin),
}

impl AdminApi for AnyAdmin {
    async fn list_projects(&self) -> Result<Vec<ProjectStatus>, AdminError> {
        match self {
            AnyAdmin::Local(a) => a.list_projects().await,
            AnyAdmin::Remote(a) => a.list_projects().await,
        }
    }

    async fn project_status(&self, name: &str) -> Result<Option<ProjectStatus>, AdminError> {
        match self {
            AnyAdmin::Local(a) => a.project_status(name).await,
            AnyAdmin::Remote(a) => a.project_status(name).await,
        }
    }

    async fn apply_config(&self, config: Config) -> Result<ApplyReport, AdminError> {
        match self {
            AnyAdmin::Local(a) => a.apply_config(config).await,
            AnyAdmin::Remote(a) => a.apply_config(config).await,
        }
    }

    async fn rotate_token(&self, name: &str) -> Result<String, AdminError> {
        match self {
            AnyAdmin::Local(a) => a.rotate_token(name).await,
            AnyAdmin::Remote(a) => a.rotate_token(name).await,
        }
    }

    async fn clients(&self, name: &str) -> Result<Vec<ClientInfo>, AdminError> {
        match self {
            AnyAdmin::Local(a) => a.clients(name).await,
            AnyAdmin::Remote(a) => a.clients(name).await,
        }
    }

    async fn logs(&self, after: u64, limit: usize) -> Result<Vec<LogRecord>, AdminError> {
        match self {
            AnyAdmin::Local(a) => a.logs(after, limit).await,
            AnyAdmin::Remote(a) => a.logs(after, limit).await,
        }
    }
}
