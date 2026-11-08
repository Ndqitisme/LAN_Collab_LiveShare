//! The tray icon: its tooltip and icon follow the hub state, its menu opens the window, pauses or resumes a
//! project, copies an invite code, and quits.

use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use lanhub_app::i18n::t;
use lanhub_app::status::{HubState, Snapshot, ViewState};

const ICON: &[u8] = include_bytes!("../icons/32x32.png");

pub struct Tray {
    icon: TrayIcon,
    normal: Image<'static>,
    idle: Image<'static>,
    shown: Mutex<Shown>,
}

#[derive(Default, PartialEq)]
struct Shown {
    menu: Vec<(String, bool)>,
    tooltip: String,
    active: Option<bool>,
}

/// The same icon in gray at lower opacity, for a hub that serves nothing.
fn idle_variant(img: &Image<'_>) -> Image<'static> {
    let mut rgba = img.rgba().to_vec();
    for px in rgba.as_chunks_mut::<4>().0 {
        let gray =
            (0.3 * f32::from(px[0]) + 0.59 * f32::from(px[1]) + 0.11 * f32::from(px[2])) as u8;
        px[0] = gray;
        px[1] = gray;
        px[2] = gray;
        px[3] = (u16::from(px[3]) * 3 / 5) as u8;
    }
    Image::new_owned(rgba, img.width(), img.height())
}

pub fn create(app: &AppHandle) -> tauri::Result<Tray> {
    let normal = Image::from_bytes(ICON)?.to_owned();
    let idle = idle_variant(&normal);
    let icon = TrayIconBuilder::with_id("main")
        .icon(idle.clone())
        .tooltip(t("app.name", &[]))
        .menu(&build_menu(app, &[])?)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = e
            {
                crate::show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(Tray {
        icon,
        normal,
        idle,
        shown: Mutex::new(Shown::default()),
    })
}

fn build_menu(app: &AppHandle, projects: &[(String, bool)]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "open",
        t("tray.open", &[]),
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if projects.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            "none",
            t("tray.noProjects", &[]),
            false,
            None::<&str>,
        )?)?;
    }
    for (name, enabled) in projects {
        let label = if *enabled {
            name.clone()
        } else {
            t("tray.disabledSuffix", &[("name", name)])
        };
        let sub = Submenu::new(app, label, true)?;
        let (id, text) = if *enabled {
            (format!("pause:{name}"), t("tray.pause", &[]))
        } else {
            (format!("resume:{name}"), t("tray.resume", &[]))
        };
        sub.append(&MenuItem::with_id(app, id, text, true, None::<&str>)?)?;
        sub.append(&MenuItem::with_id(
            app,
            format!("invite:{name}"),
            t("tray.copyInvite", &[]),
            *enabled,
            None::<&str>,
        )?)?;
        menu.append(&sub)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        t("tray.quit", &[]),
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

fn on_menu(app: &AppHandle, e: MenuEvent) {
    act(app, e.id().as_ref());
}

/// Runs the menu item with this id.
pub fn act(app: &AppHandle, id: &str) {
    match id.split_once(':') {
        None if id == "open" => crate::show_main(app),
        None if id == "quit" => crate::quit(app.clone()),
        Some(("pause", name)) => crate::spawn_set_enabled(app.clone(), name.to_owned(), false),
        Some(("resume", name)) => crate::spawn_set_enabled(app.clone(), name.to_owned(), true),
        Some(("invite", name)) => crate::spawn_copy_invite(app.clone(), name.to_owned()),
        _ => {}
    }
}

impl Tray {
    /// Brings the tray in line with `snap`, touching only the parts that changed.
    pub fn update(&self, app: &AppHandle, snap: &Snapshot) {
        let running = snap
            .projects
            .iter()
            .filter(|p| p.state == ViewState::Running)
            .count();
        let clients: usize = snap.projects.iter().map(|p| p.clients).sum();
        let tooltip = match snap.hub.state {
            HubState::BindError => t("tray.tooltipError", &[("port", &snap.hub.port.to_string())]),
            _ => t(
                "tray.tooltip",
                &[
                    ("running", &running.to_string()),
                    ("clients", &clients.to_string()),
                ],
            ),
        };
        let menu: Vec<(String, bool)> = snap
            .projects
            .iter()
            .map(|p| (p.name.clone(), p.enabled))
            .collect();
        let active = snap.hub.state == HubState::Running && running > 0;
        let mut shown = self.shown.lock().unwrap_or_else(|e| e.into_inner());
        if shown.menu != menu || shown.active.is_none() {
            match build_menu(app, &menu) {
                Ok(m) => {
                    let _ = self.icon.set_menu(Some(m));
                }
                Err(e) => lanhub_core::logs::log_in(
                    None,
                    &format!("[LỖI] Không dựng được menu khay: {e}"),
                ),
            }
            shown.menu = menu;
        }
        if shown.tooltip != tooltip {
            let _ = self.icon.set_tooltip(Some(&tooltip));
            shown.tooltip = tooltip;
        }
        if shown.active != Some(active) {
            let img = if active { &self.normal } else { &self.idle };
            let _ = self.icon.set_icon(Some(img.clone()));
            shown.active = Some(active);
        }
    }
}

pub fn update(app: &AppHandle, snap: &Snapshot) {
    if let Some(tray) = app.try_state::<Tray>() {
        tray.update(app, snap);
    }
}
