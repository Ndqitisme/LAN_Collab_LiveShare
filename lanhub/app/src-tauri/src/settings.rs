//! The commands of the hub settings screen: the `[hub]` settings, the invite codes they produce, and the
//! Windows Firewall helper.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use lanhub_app::config_file::{AppError, HubInput};
use lanhub_app::firewall::{self, Elevation, Protocol, Report};
use lanhub_app::remote::app_error;
use lanhub_app::service::{AppCore, HubSettingsView, InviteView};
use lanhub_core::logs::log_in;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::hubs::Hubs;

type Core<'a> = State<'a, Arc<AppCore>>;

#[tauri::command]
pub async fn get_hub_settings(core: Core<'_>, hubs: Hubs<'_>) -> Result<HubSettingsView, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote.hub_settings().await.map_err(app_error);
    }
    core.hub_settings().await
}

#[tauri::command]
pub async fn update_hub(
    core: Core<'_>,
    hubs: Hubs<'_>,
    input: HubInput,
) -> Result<HubSettingsView, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote.update_hub(&input).await.map_err(app_error);
    }
    core.update_hub(&input).await?;
    core.hub_settings().await
}

#[tauri::command]
pub async fn invite_codes(core: Core<'_>, hubs: Hubs<'_>) -> Result<Vec<InviteView>, AppError> {
    if let Some(remote) = hubs.selected_admin().await? {
        return remote.invite_codes().await.map_err(app_error);
    }
    core.invite_codes().await
}

/// The file chosen in the native dialog, or `None` when it was cancelled.
#[tauri::command]
pub async fn pick_file(app: AppHandle, title: String, start: Option<String>) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter("PEM", &["pem", "crt", "cer", "key"]);
    if let Some(dir) = start
        .map(PathBuf::from)
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .filter(|d| d.is_dir())
    {
        dialog = dialog.set_directory(dir);
    }
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    dialog.pick_file(move |p| {
        let _ = tx.send(p.and_then(|p| p.into_path().ok()));
    });
    rx.await
        .ok()
        .flatten()
        .map(|p| p.to_string_lossy().into_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// Every rule was already there: no UAC prompt.
    Nothing,
    /// The batch ran and the rules are there now.
    Done,
    /// The UAC prompt was refused.
    Declined,
    /// The batch ran (or could not start) and something is still missing.
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct FirewallResult {
    pub report: Report,
    pub outcome: Outcome,
}

fn wants(core: &AppCore) -> Result<Vec<(Protocol, u16)>, AppError> {
    let (tcp, udp) = core.ports().ok_or_else(|| AppError::new("configInvalid"))?;
    let mut out = vec![(Protocol::Tcp, tcp)];
    out.extend(udp.map(|p| (Protocol::Udp, p)));
    Ok(out)
}

async fn check(wants: Vec<(Protocol, u16)>) -> Result<Report, AppError> {
    let exe = std::env::current_exe().unwrap_or_default();
    tauri::async_runtime::spawn_blocking(firewall::read_rules)
        .await
        .map_err(|_| AppError::new("generic"))?
        .map(|text| firewall::judge(&text, &wants, &exe))
        .map_err(|e| {
            log_in(
                None,
                &format!("[LỖI] Không đọc được quy tắc tường lửa: {e}"),
            );
            AppError::new("firewallUnreadable")
        })
}

/// Reads the rules for the hub's ports. Read-only, no prompt.
#[tauri::command]
pub async fn firewall_status(core: Core<'_>) -> Result<Report, AppError> {
    check(wants(&core)?).await
}

/// Checks first; when something is missing, runs every fixing command in one elevated `netsh` (one UAC
/// prompt), then reads the rules again.
#[tauri::command]
pub async fn open_firewall(app: AppHandle, core: Core<'_>) -> Result<FirewallResult, AppError> {
    let wants = wants(&core)?;
    let before = check(wants.clone()).await?;
    if before.commands.is_empty() {
        return Ok(FirewallResult {
            report: before,
            outcome: Outcome::Nothing,
        });
    }
    let text = firewall::script(&before.commands);
    // Debug builds only: writes the batch to this file and answers as if the UAC prompt were refused, so live
    // tests walk the flow up to the prompt without changing the firewall.
    let dry_run = std::env::var_os("LANHUB_FIREWALL_DRY_RUN")
        .filter(|_| cfg!(debug_assertions))
        .map(PathBuf::from);
    let elevation = match dry_run {
        Some(file) => std::fs::write(&file, &text)
            .map(|()| Elevation::Declined)
            .map_err(|e| e.to_string()),
        None => run_batch(&app, text).await,
    };
    let outcome = match elevation {
        Ok(Elevation::Declined) => {
            log_in(
                None,
                "Tường lửa: lời nhắc UAC bị từ chối, chưa đổi quy tắc nào",
            );
            Outcome::Declined
        }
        Ok(Elevation::Ran(code)) => {
            log_in(
                None,
                &format!("Tường lửa: netsh chạy với quyền quản trị, mã thoát {code}"),
            );
            Outcome::Done
        }
        Err(e) => {
            log_in(
                None,
                &format!("[LỖI] Không chạy được netsh với quyền quản trị: {e}"),
            );
            Outcome::Failed
        }
    };
    let after = check(wants).await?;
    let outcome = match outcome {
        Outcome::Done if !after.commands.is_empty() => Outcome::Failed,
        o => o,
    };
    Ok(FirewallResult {
        report: after,
        outcome,
    })
}

async fn run_batch(app: &AppHandle, text: String) -> Result<Elevation, String> {
    let script = std::env::temp_dir().join(format!(
        "lanhub-firewall-{}.txt",
        lanhub_core::util::random_hex::<6>()
    ));
    std::fs::write(&script, text).map_err(|e| format!("{}: {e}", script.display()))?;
    let parent = parent_window(app);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let path = script.clone();
    // A thread of its own: it initializes COM for ShellExecuteEx and waits as long as the UAC prompt is open.
    std::thread::spawn(move || {
        let _ = tx.send(firewall::run_elevated(&path, parent));
    });
    let result = rx
        .await
        .unwrap_or_else(|_| Err("elevation thread ended".to_owned()));
    let _ = std::fs::remove_file(&script);
    result
}

#[cfg(windows)]
fn parent_window(app: &AppHandle) -> Option<isize> {
    let w = app.get_webview_window("main")?;
    w.hwnd().ok().map(|h| h.0 as isize)
}

#[cfg(not(windows))]
fn parent_window(_app: &AppHandle) -> Option<isize> {
    None
}
