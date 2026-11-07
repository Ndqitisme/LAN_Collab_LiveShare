//! The Tauri commands the UI calls. Each one is a thin wrapper over `AppCore`, which holds the logic and is
//! what the tests drive, or over the selected remote hub (`hubs`).

use std::path::PathBuf;
use std::sync::Arc;

use lanhub_app::config_file::{AppError, ProjectInput};
use lanhub_app::remote::app_error;
use lanhub_app::service::AppCore;
use lanhub_app::status::{Sampler, Snapshot};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::core;
use crate::hubs::{Hubs, View, refreshed};

type Core<'a> = State<'a, Arc<AppCore>>;

/// The last snapshot pushed for the selected hub, or a fresh one before the first push.
#[tauri::command]
pub async fn get_status(
    app: AppHandle,
    core: Core<'_>,
    hubs: Hubs<'_>,
    view: State<'_, View>,
) -> Result<Snapshot, AppError> {
    if hubs.selected().is_some() {
        return Ok(refreshed(&app).await);
    }
    let latest = view.get().or_else(|| {
        core.latest
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    });
    match latest {
        Some(s) => Ok(s),
        None => Ok(Sampler::default().snapshot(core.inputs().await, core.config_path().to_owned())),
    }
}

/// The first view is on screen: show the window that started hidden.
#[tauri::command]
pub fn ui_ready(app: AppHandle) {
    crate::show_first(&app);
}

#[tauri::command]
pub async fn add_project(
    core: Core<'_>,
    hubs: Hubs<'_>,
    input: ProjectInput,
) -> Result<(), AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        remote.add_project(&input).await.map_err(app_error)?;
        core.wake.notify_one();
        return Ok(());
    }
    core.add_project(&input).await
}

#[tauri::command]
pub async fn update_project(
    core: Core<'_>,
    hubs: Hubs<'_>,
    original: String,
    input: ProjectInput,
) -> Result<(), AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        remote
            .update_project(&original, &input)
            .await
            .map_err(app_error)?;
        core.wake.notify_one();
        return Ok(());
    }
    core.update_project(&original, &input).await
}

#[tauri::command]
pub async fn set_project_enabled(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
    enabled: bool,
) -> Result<(), AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        remote
            .set_enabled(&name, enabled)
            .await
            .map_err(app_error)?;
        core.wake.notify_one();
        return Ok(());
    }
    core.set_enabled(&name, enabled).await
}

#[tauri::command]
pub async fn remove_project(core: Core<'_>, hubs: Hubs<'_>, name: String) -> Result<(), AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        remote.remove_project(&name).await.map_err(app_error)?;
        core.wake.notify_one();
        return Ok(());
    }
    core.remove_project(&name).await
}

/// The folder chosen in the native dialog, or `None` when it was cancelled.
#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: String, start: Option<String>) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(dir) = start.map(PathBuf::from).filter(|d| d.is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    if let Some(w) = tauri::Manager::get_webview_window(&app, "main") {
        dialog = dialog.set_parent(&w);
    }
    dialog.pick_folder(move |p| {
        let _ = tx.send(p.and_then(|p| p.into_path().ok()));
    });
    rx.await
        .ok()
        .flatten()
        .map(|p| p.to_string_lossy().into_owned())
}

pub async fn copy_invite_inner(app: &AppHandle, name: &str) -> Result<(), AppError> {
    let code = core(app).invite_code(name).await?;
    crate::copy_text(app, code)
}

#[tauri::command]
pub async fn copy_invite(app: AppHandle, hubs: Hubs<'_>, name: String) -> Result<(), AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        let code = remote.invite_code(&name).await.map_err(app_error)?;
        return crate::copy_text(&app, code);
    }
    copy_invite_inner(&app, &name).await
}

#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> Result<(), AppError> {
    crate::copy_text(&app, text)
}

/// Opens the folder in Explorer.
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), AppError> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(AppError::field("rootMissing", "root"));
    }
    std::process::Command::new(if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    })
    .arg(dir)
    .spawn()
    .map(drop)
    .map_err(|e| {
        lanhub_core::logs::log_in(None, &format!("[LỖI] Không mở được {path}: {e}"));
        AppError::new("generic")
    })
}

/// Debug builds only: runs a tray menu item by id, for live tests that cannot click the native menu.
#[tauri::command]
pub fn tray_action(app: AppHandle, id: String) {
    if cfg!(debug_assertions) {
        crate::tray::act(&app, &id);
    }
}

/// Reads `lanhub.toml` again and applies it; the retry after a config or port error. For a remote hub, the
/// retry after it went offline: connects again now.
#[tauri::command]
pub async fn reload_config(app: AppHandle, core: Core<'_>, hubs: Hubs<'_>) -> Result<(), AppError> {
    if hubs.selected().is_some() {
        refreshed(&app).await;
        return Ok(());
    }
    core.reload().await;
    Ok(())
}
