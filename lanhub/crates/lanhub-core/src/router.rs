//! One TCP listener for every project. A session reads `hello.project` and looks it up in the current
//! table before any other check, because the token belongs to the project. The registry swaps the table
//! whenever a project starts, stops or changes; sessions already joined keep the handle they took.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::admin_server::{AdminDoor, Limiter};
use crate::session::{self, ProjectHandle};
use crate::tls::TlsIdentity;
use crate::util::log;

/// Projects are found by name ignoring case.
pub fn key(name: &str) -> String {
    name.to_lowercase()
}

#[derive(Default)]
pub struct Table {
    pub projects: HashMap<String, ProjectHandle>,
    /// Names of the served projects with `advertise = true`, in config order.
    pub advertised: Vec<String>,
    pub hub_name: String,
    pub instance_id: String,
    /// When TLS is on, every connection must open with a TLS handshake.
    pub tls: Option<Arc<TlsIdentity>>,
    /// When the hub started (`now_ms`), for the diagnosis page.
    pub started_at: u64,
    /// Set while `[hub.admin] remote` is on and the hub serves the admin channel.
    pub admin: Option<Arc<AdminDoor>>,
}

impl Table {
    pub fn resolve(&self, project: &str) -> Option<&ProjectHandle> {
        self.projects.get(&key(project))
    }
}

#[derive(Default)]
pub struct Router {
    table: RwLock<Arc<Table>>,
    /// Wrong admin tokens per address, kept across table swaps.
    pub admin_strikes: Limiter,
}

impl Router {
    pub fn table(&self) -> Arc<Table> {
        self.table.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set(&self, table: Table) {
        *self.table.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(table);
    }
}

/// Accepts connections until aborted; each one becomes a session task.
pub fn accept(listener: TcpListener, router: Arc<Router>) -> JoinHandle<()> {
    tokio::spawn(async move {
        static NEXT_KEY: AtomicU64 = AtomicU64::new(1);
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed);
                    tokio::spawn(session::accept(stream, addr, router.clone(), key));
                }
                Err(e) => {
                    log(format!("[LỖI] không nhận được kết nối: {e}"));
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    })
}
