//! The Tauri commands the UI calls. Each one is a thin wrapper over `AppCore`, which holds the logic and is
//! what the tests drive.

use std::path::PathBuf;
use std::sync::Arc;

use lanhub_app::config_file::{AppError, HistoryInput, ImportInput, ProjectInput};
use lanhub_app::service::{AppCore, ExcludePreview, ProjectSettings};
use lanhub_app::status::{Sampler, Snapshot};
use lanhub_core::admin::LegacyProject;
use lanhub_core::history::{HistoryUsage, RetentionReport};
use lanhub_core::logs::LogRecord;
use lanhub_core::project::ClientInfo;
use lanhub_core::registry::InviteCodes;
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

// Project administration screens (A8).

#[tauri::command]
pub fn project_settings(core: Core<'_>, name: String) -> Result<ProjectSettings, AppError> {
    core.project_settings(&name)
}

#[tauri::command]
pub async fn rotate_token(core: Core<'_>, name: String) -> Result<String, AppError> {
    core.rotate_token(&name).await
}

#[tauri::command]
pub async fn set_allow(core: Core<'_>, name: String, lines: Vec<String>) -> Result<(), AppError> {
    core.set_allow(&name, &lines).await
}

#[tauri::command]
pub async fn set_exclude(core: Core<'_>, name: String, lines: Vec<String>) -> Result<(), AppError> {
    core.set_exclude(&name, &lines).await
}

#[tauri::command]
pub async fn preview_exclude(
    core: Core<'_>,
    name: String,
    lines: Vec<String>,
) -> Result<ExcludePreview, AppError> {
    core.preview_exclude(&name, lines).await
}

#[tauri::command]
pub async fn set_history(
    core: Core<'_>,
    name: String,
    history: HistoryInput,
) -> Result<(), AppError> {
    core.set_history(&name, &history).await
}

#[tauri::command]
pub async fn history_usage(core: Core<'_>, name: String) -> Result<Option<HistoryUsage>, AppError> {
    core.history_usage(&name).await
}

#[tauri::command]
pub async fn run_retention(core: Core<'_>, name: String) -> Result<RetentionReport, AppError> {
    core.run_retention(&name).await
}

#[tauri::command]
pub async fn invite_codes(core: Core<'_>, name: String) -> Result<InviteCodes, AppError> {
    core.invite_codes(&name).await
}

#[tauri::command]
pub async fn project_clients(core: Core<'_>, name: String) -> Result<Vec<ClientInfo>, AppError> {
    core.clients(&name).await
}

#[tauri::command]
pub fn get_logs(core: Core<'_>, after: u64, limit: usize) -> Vec<LogRecord> {
    core.logs(after, limit)
}

/// Asks where to save `text` and writes it there. Resolves to the path, or `None` when cancelled.
#[tauri::command]
pub async fn export_logs(
    app: AppHandle,
    title: String,
    filter: String,
    file_name: String,
    text: String,
) -> Result<Option<String>, AppError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .set_file_name(file_name)
        .add_filter(filter, &["log"]);
    if let Some(w) = tauri::Manager::get_webview_window(&app, "main") {
        dialog = dialog.set_parent(&w);
    }
    dialog.save_file(move |p| {
        let _ = tx.send(p.and_then(|p| p.into_path().ok()));
    });
    let Some(path) = rx.await.ok().flatten() else {
        return Ok(None);
    };
    lanhub_core::flush::write_file_atomic(&path, text.as_bytes()).map_err(|e| {
        lanhub_core::logs::log_in(
            None,
            &format!("[LỖI] Không ghi được {}: {e}", path.display()),
        );
        AppError::new("exportFailed").param("path", path.display().to_string())
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn scan_legacy(core: Core<'_>, dir: String) -> Result<Vec<LegacyProject>, AppError> {
    core.scan_legacy(std::path::Path::new(&dir)).await
}

#[tauri::command]
pub async fn import_legacy(
    core: Core<'_>,
    items: Vec<ImportInput>,
) -> Result<Vec<String>, AppError> {
    core.import_legacy(&items).await
}
