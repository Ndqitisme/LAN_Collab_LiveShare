//! The hub switcher: the commands that list, add, remove and select remote hubs, and the snapshot of the
//! selected hub that the window shows. The tray always shows this machine's hub.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use lanhub_app::config_file::AppError;
use lanhub_app::remote::{HubsView, RemoteInput, Remotes, app_error};
use lanhub_app::status::{Sampler, Snapshot};
use lanhub_core::admin::AdminApi;
use lanhub_core::admin_remote::Probe;
use lanhub_core::registry::AdminError;
use tauri::{AppHandle, Emitter, Manager, State};

pub type Hubs<'a> = State<'a, Arc<Remotes>>;

/// The snapshot the window shows, and the sampler of the remote hub it is of.
#[derive(Default)]
pub struct View {
    shown: Mutex<Option<Snapshot>>,
    remote: tokio::sync::Mutex<(Option<String>, Sampler)>,
}

impl View {
    pub fn get(&self) -> Option<Snapshot> {
        self.shown.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Stores `snap`; `true` when it differs from the one shown.
    pub fn set(&self, snap: &Snapshot) -> bool {
        let mut shown = self.shown.lock().unwrap_or_else(|e| e.into_inner());
        let changed = shown.as_ref() != Some(snap);
        if changed {
            *shown = Some(snap.clone());
        }
        changed
    }
}

pub fn remotes(app: &AppHandle) -> Arc<Remotes> {
    app.state::<Arc<Remotes>>().inner().clone()
}

/// A snapshot of remote hub `id`. `user` connects again even after a failure the user had to fix.
pub async fn remote_snapshot(app: &AppHandle, id: &str, user: bool) -> Option<Snapshot> {
    let remotes = remotes(app);
    let entry = remotes.entry(id)?;
    let view = app.state::<View>();
    let (statuses, config_path) = match remotes.admin(id, user).await {
        Ok(admin) => {
            let path = admin.info().config_path.clone().unwrap_or_default();
            let statuses = match admin.list_projects().await {
                Ok(list) => Ok(list),
                Err(AdminError::Remote(f)) => {
                    remotes.note(id, &f).await;
                    Err(app_error(f))
                }
                Err(_) => Err(AppError::new("generic")),
            };
            (statuses, PathBuf::from(path))
        }
        Err(f) => (Err(app_error(f)), PathBuf::new()),
    };
    let last = view.get();
    let mut remote = view.remote.lock().await;
    if remote.0.as_deref() != Some(id) {
        *remote = (Some(id.to_owned()), Sampler::default());
    }
    Some(remote.1.snapshot_remote(
        id,
        &entry.host,
        entry.port,
        config_path,
        statuses,
        last.as_ref(),
    ))
}

/// Shows `snap` in the window when it changed.
pub fn show(app: &AppHandle, snap: &Snapshot) {
    if app.state::<View>().set(snap) {
        let _ = app.emit(crate::STATUS_EVENT, snap);
    }
}

/// A fresh snapshot of the selected hub, connecting again to a remote one, shown at once.
pub async fn refreshed(app: &AppHandle) -> Snapshot {
    let local = || {
        crate::core(app)
            .latest
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    };
    let snap = match remotes(app).selected() {
        Some(id) => remote_snapshot(app, &id, true).await,
        None => None,
    };
    let snap = match snap.or_else(local) {
        Some(s) => s,
        None => {
            let core = crate::core(app);
            Sampler::default().snapshot(core.inputs().await, core.config_path().to_owned())
        }
    };
    show(app, &snap);
    snap
}

#[tauri::command]
pub async fn list_hubs(hubs: Hubs<'_>) -> Result<HubsView, AppError> {
    Ok(hubs.view().await)
}

/// Selects a remote hub, or this machine's with `None`, and returns its snapshot.
#[tauri::command]
pub async fn select_hub(app: AppHandle, id: Option<String>) -> Result<Snapshot, AppError> {
    remotes(&app).select(id)?;
    Ok(refreshed(&app).await)
}

/// Reads whether the hub at `host:port` runs TLS, and its certificate fingerprint. Sends no token.
#[tauri::command]
pub async fn probe_remote(hubs: Hubs<'_>, host: String, port: u32) -> Result<Probe, AppError> {
    hubs.probe(&host, port).await
}

/// Connects to the hub with the token and pin of the form; saves it and selects it once the hub lets the
/// session in.
#[tauri::command]
pub async fn add_remote(app: AppHandle, input: RemoteInput) -> Result<Snapshot, AppError> {
    let remotes = remotes(&app);
    let id = remotes.add(&input).await?;
    remotes.select(Some(id))?;
    Ok(refreshed(&app).await)
}

#[tauri::command]
pub async fn remove_remote(app: AppHandle, id: String) -> Result<HubsView, AppError> {
    let remotes = remotes(&app);
    remotes.remove(&id).await?;
    refreshed(&app).await;
    Ok(remotes.view().await)
}
