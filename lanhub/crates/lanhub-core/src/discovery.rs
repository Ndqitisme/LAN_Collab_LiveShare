//! LAN discovery (docs/protocol.md section 10): answers `lanhub_discover` on UDP with `lanhub_here`, so a
//! client finds the hub again after its address changed. The socket is bound on every interface whatever
//! address the TCP side uses, because broadcasts reach only a socket bound to every interface.

use std::collections::HashMap;
use std::net::IpAddr;

use lanhub_protocol::json::{self, Json};
use serde::Serialize;
use tokio::net::UdpSocket;
use tokio::task::JoinHandle;

use crate::util::now_ms;

pub const DEFAULT_PORT: u16 = 8201;
const MAX_REQUEST: usize = 512;
/// Per source address, so the responder cannot be used to flood a third party with spoofed requests.
const REPLIES_PER_SEC: u32 = 20;

#[derive(Serialize)]
pub struct Here<'a> {
    pub t: &'static str,
    pub v: u32,
    #[serde(rename = "instanceId")]
    pub instance_id: &'a str,
    #[serde(rename = "hubName")]
    pub hub_name: &'a str,
    pub port: u16,
    pub tls: bool,
    pub projects: &'a [String],
}

/// Counts replies per source address within the current wall-clock second, as the Node responder does.
#[derive(Default)]
pub struct RateLimit {
    second: u64,
    sent: HashMap<IpAddr, u32>,
}

impl RateLimit {
    /// Whether one more reply to `ip` fits in the second `now_ms` falls in.
    pub fn allow(&mut self, ip: IpAddr, now_ms: u64) -> bool {
        let second = now_ms / 1000;
        if second != self.second {
            self.second = second;
            self.sent.clear();
        }
        let n = self.sent.entry(ip).or_insert(0);
        *n += 1;
        *n <= REPLIES_PER_SEC
    }
}

pub fn is_request(datagram: &[u8]) -> bool {
    datagram.len() <= MAX_REQUEST
        && json::parse(datagram)
            .is_ok_and(|m| m.get("t").and_then(Json::as_str) == Some("lanhub_discover"))
}

pub async fn bind(port: u16) -> std::io::Result<UdpSocket> {
    UdpSocket::bind(("0.0.0.0", port)).await
}

/// Answers every request on `sock` with `reply` until the task is aborted.
pub fn serve(sock: UdpSocket, reply: Vec<u8>) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Large enough for any datagram, so an oversized one is measured and dropped rather than truncated.
        let mut buf = vec![0u8; 65_536];
        let mut limit = RateLimit::default();
        loop {
            let (n, from) = match sock.recv_from(&mut buf).await {
                Ok(r) => r,
                // On Windows a reply to a closed port makes the next receive fail with WSAECONNRESET; the
                // socket is still fine.
                Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => continue,
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    continue;
                }
            };
            if is_request(&buf[..n]) && limit.allow(from.ip(), now_ms()) {
                let _ = sock.send_to(&reply, from).await;
            }
        }
    })
}
