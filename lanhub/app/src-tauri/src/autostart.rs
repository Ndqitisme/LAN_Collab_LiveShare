//! Start at Windows sign-in through `tauri-plugin-autostart`: a value under the user's `Run` key that starts
//! the app with `--hidden`, so it comes up in the tray without opening its window.

use lanhub_app::config_file::AppError;
use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

pub const HIDDEN_FLAG: &str = "--hidden";

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_autostart::Builder::new()
        .args([HIDDEN_FLAG])
        .build()
}

fn failed(e: impl std::fmt::Display) -> AppError {
    lanhub_core::logs::log_in(
        None,
        &format!("[LỖI] Không đổi được chế độ chạy khi đăng nhập: {e}"),
    );
    AppError::new("autostartFailed")
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, AppError> {
    app.autolaunch().is_enabled().map_err(failed)
}

/// Turns it on or off and answers with the state read back.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, AppError> {
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable().map_err(failed)?;
    } else {
        launcher.disable().map_err(failed)?;
    }
    launcher.is_enabled().map_err(failed)
}
