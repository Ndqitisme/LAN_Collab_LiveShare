//! The Tauri commands the UI calls. Each one is a thin wrapper over `AppCore`, which holds the logic and is
//! what the tests drive, or over the selected remote hub (`hubs`).

use std::path::PathBuf;
use std::sync::Arc;

use lanhub_app::config_file::{AppError, HistoryInput, ImportInput, ProjectInput};
use lanhub_app::remote::app_error;
use lanhub_app::service::{
    AppCore, ExcludePreview, ProjectSettings, admin_error, legacy_result, retention_result,
};
use lanhub_app::status::{Sampler, Snapshot};
use lanhub_core::admin::{AdminApi, LegacyProject};
use lanhub_core::history::{HistoryUsage, RetentionReport};
use lanhub_core::logs::LogRecord;
use lanhub_core::project::ClientInfo;
use lanhub_core::registry::InviteCodes;
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

// Project administration screens (A8). Each one acts on the selected hub, like the commands above.

#[tauri::command]
pub async fn project_settings(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
) -> Result<ProjectSettings, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote.project_settings(&name).await.map_err(app_error);
    }
    core.project_settings(&name)
}

/// A new token, in force for the next join; a remote hub writes it to its own `lanhub.toml`.
#[tauri::command]
pub async fn rotate_token(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
) -> Result<String, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        let token = remote.rotate_token(&name).await.map_err(admin_error)?;
        core.wake.notify_one();
        return Ok(token);
    }
    core.rotate_token(&name).await
}

#[tauri::command]
pub async fn set_allow(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
    lines: Vec<String>,
) -> Result<(), AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        remote.set_allow(&name, &lines).await.map_err(app_error)?;
        core.wake.notify_one();
        return Ok(());
    }
    core.set_allow(&name, &lines).await
}

#[tauri::command]
pub async fn set_exclude(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
    lines: Vec<String>,
) -> Result<(), AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        remote.set_exclude(&name, &lines).await.map_err(app_error)?;
        core.wake.notify_one();
        return Ok(());
    }
    core.set_exclude(&name, &lines).await
}

/// For a remote hub, the files are those of the project folder on its machine.
#[tauri::command]
pub async fn preview_exclude(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
    lines: Vec<String>,
) -> Result<ExcludePreview, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote
            .preview_exclude(&name, &lines)
            .await
            .map_err(app_error);
    }
    core.preview_exclude(&name, lines).await
}

#[tauri::command]
pub async fn set_history(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
    history: HistoryInput,
) -> Result<(), AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        remote
            .set_history(&name, &history)
            .await
            .map_err(app_error)?;
        core.wake.notify_one();
        return Ok(());
    }
    core.set_history(&name, &history).await
}

#[tauri::command]
pub async fn history_usage(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
) -> Result<Option<HistoryUsage>, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote.history_usage(&name).await.map_err(admin_error);
    }
    core.history_usage(&name).await
}

#[tauri::command]
pub async fn run_retention(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
) -> Result<RetentionReport, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return retention_result(remote.run_retention(&name).await.map_err(admin_error)?);
    }
    core.run_retention(&name).await
}

#[tauri::command]
pub async fn invite_codes(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
) -> Result<InviteCodes, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote.invite_codes(&name).await.map_err(admin_error);
    }
    core.invite_codes(&name).await
}

#[tauri::command]
pub async fn project_clients(
    core: Core<'_>,
    hubs: Hubs<'_>,
    name: String,
) -> Result<Vec<ClientInfo>, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote.clients(&name).await.map_err(admin_error);
    }
    core.clients(&name).await
}

/// The log records of the selected hub; a remote hub answers at most 2000 per call.
#[tauri::command]
pub async fn get_logs(
    core: Core<'_>,
    hubs: Hubs<'_>,
    after: u64,
    limit: usize,
) -> Result<Vec<LogRecord>, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote.logs(after, limit).await.map_err(admin_error);
    }
    Ok(core.logs(after, limit))
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

/// Reads a 0.1 hub folder. For a remote hub, `dir` is a folder on its machine, where a 0.1 hub ran.
#[tauri::command]
pub async fn scan_legacy(
    core: Core<'_>,
    hubs: Hubs<'_>,
    dir: String,
) -> Result<Vec<LegacyProject>, AppError> {
    let dir = std::path::Path::new(&dir);
    if let Some(remote) = hubs.selected_admin().await? {
        return legacy_result(dir, remote.import_legacy(dir).await.map_err(admin_error)?);
    }
    core.scan_legacy(dir).await
}

#[tauri::command]
pub async fn import_legacy(
    core: Core<'_>,
    hubs: Hubs<'_>,
    items: Vec<ImportInput>,
) -> Result<Vec<String>, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        let added = remote.import_projects(&items).await.map_err(app_error)?;
        core.wake.notify_one();
        return Ok(added);
    }
    core.import_legacy(&items).await
}
