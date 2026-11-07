//! The Tauri commands the UI calls. Each one is a thin wrapper over `AppCore`, which holds the logic and is
//! what the tests drive.

use std::path::PathBuf;
use std::sync::Arc;

use lanhub_app::config_file::{AppError, ProjectInput};
use lanhub_app::service::AppCore;
use lanhub_app::status::{Sampler, Snapshot};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::core;

type Core<'a> = State<'a, Arc<AppCore>>;

/// The last snapshot pushed, or a fresh one before the first push.
#[tauri::command]
pub async fn get_status(core: Core<'_>) -> Result<Snapshot, AppError> {
    let latest = core
        .latest
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
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
pub async fn add_project(core: Core<'_>, input: ProjectInput) -> Result<(), AppError> {
    core.add_project(&input).await
}

#[tauri::command]
pub async fn update_project(
    core: Core<'_>,
    original: String,
    input: ProjectInput,
) -> Result<(), AppError> {
    core.update_project(&original, &input).await
}

#[tauri::command]
pub async fn set_project_enabled(
    core: Core<'_>,
    name: String,
    enabled: bool,
) -> Result<(), AppError> {
    core.set_enabled(&name, enabled).await
}

#[tauri::command]
pub async fn remove_project(core: Core<'_>, name: String) -> Result<(), AppError> {
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
pub async fn copy_invite(app: AppHandle, name: String) -> Result<(), AppError> {
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

/// Reads `lanhub.toml` again and applies it; the retry after a config or port error.
#[tauri::command]
pub async fn reload_config(core: Core<'_>) -> Result<(), AppError> {
    core.reload().await;
    Ok(())
}
