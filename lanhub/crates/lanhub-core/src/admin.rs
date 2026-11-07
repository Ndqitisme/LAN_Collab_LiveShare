//! `AdminApi`, the one surface a user interface manages a hub through (plan README section 5.2). The
//! desktop app (A7) calls `LocalAdmin` in the same process; the remote client of A10 implements the same
//! trait over the admin channel.

use std::future::Future;

use crate::config::Config;
use crate::logs::{self, LogRecord};
use crate::project::ClientInfo;
use crate::registry::{AdminError, ApplyReport, ProjectStatus, Registry};

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
}
