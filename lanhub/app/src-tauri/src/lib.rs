//! The logic of the LAN Hub app that needs no window: the config file, the firewall helper, the hub service,
//! the remote hubs and the status view. `main.rs` wires it to Tauri.

pub use lanhub_core::config_file;
pub mod firewall;
pub mod i18n;
pub mod remote;
pub mod service;
pub mod status;
