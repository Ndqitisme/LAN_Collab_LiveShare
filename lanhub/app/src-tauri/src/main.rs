// A release build has no console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! LAN Hub, the desktop app: it runs the hub in this process, keeps `lanhub.toml` in step with the UI, and
//! stays in the tray when its window closes. The Tauri side lives in this binary; the logic it calls is the
//! `lanhub_app` library, which does not link Tauri so its tests run without the app manifest.

mod autostart;
mod commands;
mod settings;
mod tray;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;

use lanhub_app::config_file::AppError;
use lanhub_app::service::{self, AppCore};
use lanhub_app::status::{self, Sampler};

pub const STATUS_EVENT: &str = "hub-status";
pub const NOTICE_EVENT: &str = "notice";

/// A result of a tray action, shown by the window as a toast.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub code: String,
    pub params: std::collections::BTreeMap<String, String>,
    pub error: bool,
}

pub struct Quitting(AtomicBool);

/// Set once the window has been shown at start, by `ui_ready` or by the fallback.
pub struct Shown(AtomicBool);

/// Shows the window the first time only, so a window already closed to the tray stays there.
pub fn show_first(app: &AppHandle) {
    if !app.state::<Shown>().0.swap(true, Ordering::SeqCst) {
        show_main(app);
    }
}

pub fn core(app: &AppHandle) -> Arc<AppCore> {
    app.state::<Arc<AppCore>>().inner().clone()
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Hides the window at once, writes every pending file of every project, then exits.
pub fn quit(app: AppHandle) {
    if app.state::<Quitting>().0.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    tauri::async_runtime::spawn(async move {
        core(&app).shutdown().await;
        app.exit(0);
    });
}

fn notice(app: &AppHandle, code: &str, params: &[(&str, &str)], error: bool) {
    let _ = app.emit(
        NOTICE_EVENT,
        Notice {
            code: code.to_owned(),
            params: params
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
            error,
        },
    );
}

fn notice_error(app: &AppHandle, e: &AppError) {
    let params: Vec<(&str, &str)> = e
        .params
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    notice(app, &format!("errors.{}", e.code), &params, true);
}

pub fn spawn_set_enabled(app: AppHandle, name: String, enabled: bool) {
    tauri::async_runtime::spawn(async move {
        match core(&app).set_enabled(&name, enabled).await {
            Ok(()) => {
                let code = if enabled {
                    "toast.resumed"
                } else {
                    "toast.paused"
                };
                notice(&app, code, &[("name", &name)], false);
            }
            Err(e) => notice_error(&app, &e),
        }
    });
}

pub fn spawn_copy_invite(app: AppHandle, name: String) {
    tauri::async_runtime::spawn(async move {
        match commands::copy_invite_inner(&app, &name).await {
            Ok(()) => notice(&app, "toast.inviteCopied", &[], false),
            Err(e) => notice_error(&app, &e),
        }
    });
}

fn copy_text(app: &AppHandle, text: String) -> Result<(), AppError> {
    app.clipboard().write_text(text).map_err(|e| {
        lanhub_core::logs::log_in(None, &format!("[LỖI] Không ghi được bộ nhớ tạm: {e}"));
        AppError::new("generic")
    })
}

/// Samples the hub every `status::EVERY`, or sooner after a project event but never twice within that
/// interval, and pushes the snapshot to the window and the tray when it changed.
async fn status_loop(app: AppHandle) {
    let core = core(&app);
    let mut sampler = Sampler::default();
    let mut tick = tokio::time::interval(status::EVERY);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_sample = tokio::time::Instant::now() - status::EVERY;
    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = core.wake.notified() => {
                tokio::time::sleep_until(last_sample + status::EVERY).await;
            }
        }
        last_sample = tokio::time::Instant::now();
        let snap = sampler.snapshot(core.inputs().await, core.config_path().to_owned());
        let changed = {
            let mut latest = core.latest.lock().unwrap_or_else(|e| e.into_inner());
            let changed = latest.as_ref() != Some(&snap);
            if changed {
                *latest = Some(snap.clone());
            }
            changed
        };
        if changed {
            let _ = app.emit(STATUS_EVENT, &snap);
            tray::update(&app, &snap);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(path) = service::config_path(&args) else {
        eprintln!("LAN Hub: APPDATA is not set and no --config was given");
        std::process::exit(1);
    };
    lanhub_core::logs::prefix_project(true);
    let core = Arc::new(AppCore::new(path));
    // Started at sign-in: the window stays in the tray, as if it had been shown and closed.
    let hidden = args.iter().any(|a| a == autostart::HIDDEN_FLAG);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(autostart::plugin())
        .manage(core.clone())
        .manage(Quitting(AtomicBool::new(false)))
        .manage(Shown(AtomicBool::new(hidden)))
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::ui_ready,
            commands::add_project,
            commands::update_project,
            commands::set_project_enabled,
            commands::remove_project,
            commands::pick_folder,
            commands::copy_invite,
            commands::copy_text,
            commands::open_folder,
            commands::reload_config,
            commands::tray_action,
            settings::get_hub_settings,
            settings::update_hub,
            settings::invite_codes,
            settings::pick_file,
            settings::firewall_status,
            settings::open_firewall,
            autostart::get_autostart,
            autostart::set_autostart,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let tray = tray::create(&handle)?;
            app.manage(tray);
            tauri::async_runtime::spawn(async move { core.reload().await });
            tauri::async_runtime::spawn(status_loop(handle.clone()));
            // The window starts hidden so it never flashes an unstyled page; `ui_ready` shows it once
            // the first view is mounted. This is the fallback if the page fails to load.
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                show_first(&handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("the LAN Hub window opens");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            // `quit` exits once every file is written; any other exit request goes through it first.
            if !app.state::<Quitting>().0.load(Ordering::SeqCst) {
                api.prevent_exit();
                quit(app.clone());
            }
        }
        // Also the only event when Windows ends the session (WM_ENDSESSION): the process is killed once this
        // returns, so every file is written here, before returning. After `quit` it finds nothing left to do.
        RunEvent::Exit => tauri::async_runtime::block_on(crate::core(app).shutdown()),
        _ => {}
    });
}
